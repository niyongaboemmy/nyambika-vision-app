# AI Gateway (FastAPI). Build from the repo root: docker build -f apps/ai/Dockerfile .
FROM python:3.12-slim
WORKDIR /app
COPY apps/ai/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/ai/app ./app
COPY apps/ai/scripts ./scripts
EXPOSE 8100
USER nobody
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
