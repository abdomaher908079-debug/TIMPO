"""Hookcut cloud processing: transcribes an episode's audio for computers and phones too slow to do it.

The browser uploads the episode's audio only (never the video). We transcribe it with exact word
times, delete the audio as soon as that's done, and keep the transcript in memory for an hour so the
browser can collect it. Everything else (picking moments, making clips) still happens as usual.
"""

import asyncio
import itertools
import os
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx
import numpy as np
from fastapi import Depends, FastAPI, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

import limits

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
# Local testing only: no accounts, no limits, plan chosen by the request.
AUTH_DISABLED = os.environ.get("AUTH_DISABLED") == "1"
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

MAX_UPLOAD_BYTES = 300 * 1024 * 1024
MAX_QUEUED = 50
RESULT_TTL_SECONDS = 3600
# English-only Whisper, like the browser: base for Quick AI, small (more accurate) for Best AI.
MODELS = {"quick": "base.en", "best": "small.en"}
# Set (e.g. base.en) to use one model for every plan, on servers too slow for small.en.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "").strip()


@dataclass
class Job:
    id: str
    user_id: str
    workspace_id: str
    plan: str
    quality: str
    path: str
    declared_seconds: float
    period_start: datetime | None
    status: str = "queued"  # queued, running, done, error, canceled
    progress: float = 0.0
    error: str | None = None
    result: dict | None = None
    created: float = field(default_factory=time.time)
    finished: float | None = None
    cancel: bool = False


jobs: dict[str, Job] = {}
queue: asyncio.PriorityQueue[tuple[int, int, str]] = asyncio.PriorityQueue()
order = itertools.count()
models: dict[str, WhisperModel] = {}


class JobCanceled(Exception):
    pass


def model_for(quality: str) -> WhisperModel:
    if quality not in models:
        models[quality] = WhisperModel(WHISPER_MODEL or MODELS[quality], device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
    return models[quality]


SAMPLE_RATE = 16_000


def decode(path: str) -> np.ndarray:
    """Any audio file to mono 16 kHz samples, with the ffmpeg program (more robust than Python decoders)."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=False,
    )
    if out.returncode != 0 or not out.stdout:
        raise ValueError("We couldn't read this audio. Please try again.")
    return np.frombuffer(out.stdout, dtype=np.float32)


def transcribe(job: Job) -> dict:
    """Runs in a worker thread. Returns segments and exact word times for the whole episode."""
    model = model_for(job.quality)
    audio = decode(job.path)
    segments_iter, info = model.transcribe(
        audio,
        language="en",
        # Skips long silences, which is faster and stops Whisper inventing words in them.
        vad_filter=True,
        word_timestamps=True,
        beam_size=5 if job.quality == "best" and not WHISPER_MODEL else 1,
    )
    duration = info.duration or 0
    # The file decides the real length; the upload only declared one.
    if not AUTH_DISABLED and duration > job.declared_seconds + limits.GRACE_SECONDS:
        raise ValueError("The audio is longer than the episode you chose.")
    segments, words = [], []
    for seg in segments_iter:
        if job.cancel:
            raise JobCanceled()
        text = seg.text.strip()
        if text:
            segments.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
        for w in seg.words or []:
            if w.word.strip():
                words.append({"start": round(w.start, 2), "end": round(w.end, 2), "text": w.word.strip()})
        job.progress = min(0.99, seg.end / duration) if duration else 0
    return {"segments": segments, "words": words, "seconds": duration}


async def worker():
    loop = asyncio.get_running_loop()
    while True:
        _, _, job_id = await queue.get()
        job = jobs.get(job_id)
        if not job or job.status != "queued":
            continue
        job.status = "running"
        try:
            job.result = await loop.run_in_executor(None, transcribe, job)
            job.status = "done"
            job.progress = 1.0
            await record_usage(job, job.result["seconds"])
        except JobCanceled:
            job.status = "canceled"
        except Exception as err:  # noqa: BLE001 - any failure is reported to the user, details logged
            print(f"job {job.id} failed: {err!r}", flush=True)
            job.status = "error"
            job.error = str(err) if isinstance(err, ValueError) else "We couldn't process this audio. Please try again."
        finally:
            job.finished = time.time()
            # The audio is deleted as soon as it's been transcribed (or failed).
            try:
                os.remove(job.path)
            except FileNotFoundError:
                pass


async def cleanup():
    """Forgets finished jobs (and their transcripts) an hour after they finish."""
    while True:
        await asyncio.sleep(300)
        now = time.time()
        for job_id, job in list(jobs.items()):
            if job.finished and now - job.finished > RESULT_TTL_SECONDS:
                del jobs[job_id]


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [asyncio.create_task(worker()), asyncio.create_task(cleanup())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

http = httpx.AsyncClient(timeout=15)


def service_headers() -> dict:
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


@dataclass
class User:
    id: str
    # Who pays: the user, or the Studio owner whose team they're in. Plan and hours are the workspace's.
    workspace_id: str
    plan: str
    workspace: dict | None


async def current_user(authorization: str = Header(default="")) -> User:
    if AUTH_DISABLED:
        return User(id="local", workspace_id="local", plan="pro", workspace=None)
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Please sign in again.")
    res = await http.get(f"{SUPABASE_URL}/auth/v1/user", headers={"apikey": SUPABASE_ANON_KEY, "Authorization": authorization})
    if res.status_code != 200:
        raise HTTPException(401, "Please sign in again.")
    user_id = res.json()["id"]
    res = await http.post(f"{SUPABASE_URL}/rest/v1/rpc/workspace_of", json={"uid": user_id}, headers=service_headers())
    res.raise_for_status()
    rows = res.json()
    workspace = rows[0] if rows else None
    # workspace_of already returns the effective plan.
    plan = workspace["plan"] if workspace and workspace.get("plan") in limits.CLOUD else "free"
    return User(id=user_id, workspace_id=workspace["owner_id"] if workspace else user_id, plan=plan, workspace=workspace)


async def usage(user: User, period_start: datetime) -> tuple[int, float]:
    res = await http.get(
        f"{SUPABASE_URL}/rest/v1/cloud_jobs",
        params={"workspace_id": f"eq.{user.workspace_id}", "period_start": f"eq.{period_start.isoformat()}", "select": "seconds"},
        headers=service_headers(),
    )
    res.raise_for_status()
    rows = res.json()
    return len(rows), sum(float(r["seconds"]) for r in rows)


async def record_usage(job: Job, seconds: float):
    if AUTH_DISABLED or not job.period_start:
        return
    res = await http.post(
        f"{SUPABASE_URL}/rest/v1/cloud_jobs",
        json={"user_id": job.user_id, "workspace_id": job.workspace_id, "seconds": seconds, "period_start": job.period_start.isoformat()},
        headers=service_headers(),
    )
    if res.status_code >= 300:
        print(f"usage not recorded for job {job.id}: {res.status_code} {res.text}", flush=True)


def position(job: Job) -> int:
    """How many queued jobs will run before this one (including the one running now)."""
    if job.status != "queued":
        return 0
    mine = (0 if limits.CLOUD[job.plan]["priority"] else 1, job.created)
    ahead = sum(
        1
        for j in jobs.values()
        if j.status == "running"
        or (j.status == "queued" and (0 if limits.CLOUD[j.plan]["priority"] else 1, j.created) < mine)
    )
    return ahead


@app.get("/health")
async def health():
    return {"ok": True, "queued": sum(j.status == "queued" for j in jobs.values())}


@app.post("/jobs")
async def create_job(
    audio: UploadFile,
    seconds: float = Form(...),
    quality: str = Form("quick"),
    user: User = Depends(current_user),
):
    if seconds <= 0 or seconds > 12 * 3600:
        raise HTTPException(400, "Invalid episode length.")
    if any(j.user_id == user.id and j.status in ("queued", "running") for j in jobs.values()):
        raise HTTPException(429, "You already have an episode processing. Please wait for it to finish.")
    if sum(j.status == "queued" for j in jobs.values()) >= MAX_QUEUED:
        raise HTTPException(503, "Cloud processing is very busy right now. Please try again in a few minutes.")

    period_start = None
    if not AUTH_DISABLED:
        period_start = limits.current_period_start(user.plan, datetime.now(timezone.utc), user.workspace)
        jobs_used, seconds_used = await usage(user, period_start)
        problem = limits.check(user.plan, jobs_used, seconds_used, seconds)
        if problem:
            raise HTTPException(403, problem)
        quality = limits.CLOUD[user.plan]["quality"]
    elif quality not in MODELS:
        quality = "quick"

    fd, path = tempfile.mkstemp(prefix="hookcut-", suffix=os.path.splitext(audio.filename or "")[1] or ".audio")
    size = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await audio.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "This audio file is too large.")
                out.write(chunk)
    except BaseException:
        os.remove(path)
        raise

    job = Job(
        id=uuid.uuid4().hex,
        user_id=user.id,
        workspace_id=user.workspace_id,
        plan=user.plan,
        quality=quality,
        path=path,
        declared_seconds=seconds,
        period_start=period_start,
    )
    jobs[job.id] = job
    await queue.put((0 if limits.CLOUD[user.plan]["priority"] else 1, next(order), job.id))
    return {"id": job.id, "status": job.status, "position": position(job)}


def own_job(job_id: str, user: User) -> Job:
    job = jobs.get(job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(404, "This job has expired. Please start again.")
    return job


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, user: User = Depends(current_user)):
    job = own_job(job_id, user)
    body = {"id": job.id, "status": job.status, "progress": round(job.progress, 3), "position": position(job), "quality": job.quality}
    if job.status == "done":
        body["result"] = job.result
    if job.status == "error":
        body["error"] = job.error
    return body


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, user: User = Depends(current_user)):
    job = own_job(job_id, user)
    if job.status == "queued":
        job.status = "canceled"
        job.finished = time.time()
        try:
            os.remove(job.path)
        except FileNotFoundError:
            pass
    elif job.status == "running":
        job.cancel = True
    return {"id": job.id, "status": job.status}
