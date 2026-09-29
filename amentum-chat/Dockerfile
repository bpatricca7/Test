# Amentum AI - application image (React UI + FastAPI backend).
# Model-written code runs in the separate, locked-down sandbox image (sandbox.Dockerfile).
#
#   docker build -t amentum-ai:latest .
#
# Inside the Amentum network, point these base images at your internal registry mirror
# (e.g. --build-arg NODE_IMAGE=registry.amentum.internal/node:22-alpine).
ARG NODE_IMAGE=node:22-alpine
ARG PYTHON_IMAGE=python:3.12-slim

FROM ${NODE_IMAGE} AS web
# Corporate TLS-inspection CAs (optional): any *.crt placed in deploy/certs/ is trusted at build time.
COPY deploy/certs/ /tmp/certs/
RUN cat /tmp/certs/*.crt > /tmp/extra-ca.pem 2>/dev/null || true
ENV NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ${PYTHON_IMAGE} AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DATA_DIR=/data
COPY deploy/certs/ /tmp/certs/
RUN if ls /tmp/certs/*.crt >/dev/null 2>&1; then cp /tmp/certs/*.crt /usr/local/share/ca-certificates/ && update-ca-certificates; fi \
 && rm -rf /tmp/certs
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
RUN useradd --uid 10001 --create-home amentum
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY backend/app backend/app
COPY config config
COPY mcp-servers mcp-servers
COPY --from=web /src/frontend/dist frontend/dist
RUN mkdir -p /data && chown -R amentum:amentum /data
USER amentum
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
# Single worker on purpose: MCP connections, sandbox sessions and in-flight turns live in-process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-keep-alive", "75"]
