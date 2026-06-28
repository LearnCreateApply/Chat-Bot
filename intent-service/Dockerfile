FROM python:3.11-slim
WORKDIR /app

# Install dependencies first (layer-cached independently of source changes)
COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://pypi.org/simple/ -r requirements.txt

# Pre-download the sentence-transformers model at build time so the
# container starts instantly rather than downloading ~80 MB on first request.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
