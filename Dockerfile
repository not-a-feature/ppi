FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends clamav poppler-utils ca-certificates python3 ghostscript tesseract-ocr tesseract-ocr-eng tesseract-ocr-deu \
    && uv venv --python /usr/bin/python3 /opt/ocr \
    && uv pip install --python /opt/ocr/bin/python ocrmypdf==17.13.0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/files && chown node:node /data/files
ENV NODE_ENV=production UPLOAD_DIR=/data/files PORT=3000 HOST=0.0.0.0 BODY_SIZE_LIMIT=32M PATH="/opt/ocr/bin:${PATH}" OMP_THREAD_LIMIT=1
USER node
EXPOSE 3000
CMD ["node", "build"]
