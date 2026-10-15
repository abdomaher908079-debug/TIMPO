FROM python:3.12-slim

# ffmpeg decodes uploaded audio.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home hookcut
USER hookcut
# Download both speech models into the image, so the first job doesn't wait for them.
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base.en', compute_type='int8'); WhisperModel('small.en', compute_type='int8')"

COPY --chown=hookcut app.py limits.py ./
EXPOSE 8787
# One process: the job queue lives in memory.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1", "--proxy-headers"]
