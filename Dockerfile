# === Stage 1: build frontend (Next.js standalone) ===
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
# Render pasa las env vars como build args: el SHA queda visible en la app
ARG RENDER_GIT_COMMIT
ENV RENDER_GIT_COMMIT=$RENDER_GIT_COMMIT
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build && \
    test -f /app/frontend/.next/standalone/server.js && \
    test -d /app/frontend/.next/static

# === Stage 2: runtime (Python 3.12 + Node 20) ===
FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=production

# OCR opcional: --build-arg ENABLE_OCR=1 agrega tesseract (+~200MB)
ARG ENABLE_OCR=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpq-dev gcc curl ca-certificates gnupg dos2unix \
      # Export: pandoc (docx) + libs de WeasyPrint (pdf) + fuentes
      pandoc \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi-dev \
      libjpeg62-turbo shared-mime-info fonts-dejavu \
    && if [ "$ENABLE_OCR" = "1" ]; then \
         apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-spa poppler-utils; \
       fi \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Backend
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/backend/requirements.txt
COPY backend/ /app/backend/

# Frontend standalone
COPY --from=frontend-builder /app/frontend/public            /app/frontend/public
COPY --from=frontend-builder /app/frontend/.next/standalone  /app/frontend
COPY --from=frontend-builder /app/frontend/.next/static      /app/frontend/.next/static

COPY start.sh /app/start.sh
RUN dos2unix /app/start.sh && chmod +x /app/start.sh

# Discos persistentes (Render monta /var/data)
RUN mkdir -p /var/data/uploads /var/data/exports

ENV PORT=8080 \
    BACKEND_URL=http://127.0.0.1:8000 \
    UPLOAD_DIR=/var/data/uploads \
    EXPORT_DIR=/var/data/exports

EXPOSE 8080

CMD ["/app/start.sh"]
