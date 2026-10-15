FROM python:3.12-slim

# ffmpeg decodes uploaded audio.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# User 1000, as Hugging Face Spaces expect.
RUN useradd --create-home --uid 1000 hookcut
USER hookcut
# Empty = base.en and small.en by plan. Set (e.g. base.en) to use one model for every plan.
ARG WHISPER_MODEL=
ENV WHISPER_MODEL=${WHISPER_MODEL}
# Download the speech models into the image, so the first job doesn't wait for them.
RUN python -c "import os; from faster_whisper import WhisperModel; [WhisperModel(m, compute_type='int8') for m in ([os.environ['WHISPER_MODEL']] if os.environ['WHISPER_MODEL'] else ['base.en', 'small.en'])]"

COPY --chown=hookcut app.py limits.py ./
ENV PORT=8787
EXPOSE 8787
# One process: the job queue lives in memory.
CMD uvicorn app:app --host 0.0.0.0 --port "$PORT" --workers 1 --proxy-headers --forwarded-allow-ips '*'
