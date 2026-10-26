FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY job_intel_tracker ./job_intel_tracker
ARG TRACKER_EXTRAS=""
RUN if [ -n "$TRACKER_EXTRAS" ]; then pip install --no-cache-dir ".[${TRACKER_EXTRAS}]"; else pip install --no-cache-dir .; fi \
    && useradd --uid 10001 --create-home tracker && mkdir /data && chown tracker /data
ENV APP_ENV=production DATA_DIR=/data
EXPOSE 8000
CMD ["python", "-m", "job_intel_tracker.serve"]
