FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY job_intel_tracker ./job_intel_tracker
RUN pip install --no-cache-dir . && useradd --uid 10001 --create-home tracker && mkdir /data && chown tracker /data
USER tracker
ENV APP_ENV=production DATA_DIR=/data
EXPOSE 8000
CMD ["uvicorn", "job_intel_tracker.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
