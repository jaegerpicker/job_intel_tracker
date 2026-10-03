FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY job_intel_tracker ./job_intel_tracker
RUN pip install --no-cache-dir . && useradd --uid 10001 --create-home tracker && mkdir /data && chown tracker /data
ENV APP_ENV=production DATA_DIR=/data
EXPOSE 8000
CMD ["python", "-m", "job_intel_tracker.serve"]
