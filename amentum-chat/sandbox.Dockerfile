# Amentum AI - code interpreter sandbox image.
#
# Runs model-written Python in per-conversation Jupyter kernels. Deploy it with NO network
# egress, a read-only root filesystem, dropped capabilities and CPU/memory limits
# (see docker-compose.yml). Includes LibreOffice + metric-compatible Office fonts so Word,
# Excel and PowerPoint files render to PDF faithfully for preview and printing.
#
#   docker build -f sandbox.Dockerfile -t amentum-ai-sandbox:latest .
ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SANDBOX_ROOT=/sandbox/sessions \
    HOME=/sandbox/home \
    MPLCONFIGDIR=/sandbox/home/.matplotlib

# Corporate TLS-inspection CAs (optional): any *.crt placed in deploy/certs/ is trusted.
COPY deploy/certs/ /tmp/certs/
RUN if ls /tmp/certs/*.crt >/dev/null 2>&1; then cp /tmp/certs/*.crt /usr/local/share/ca-certificates/ && update-ca-certificates; fi \
 && rm -rf /tmp/certs
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt

# Point apt at an internal mirror if deb.debian.org is not reachable from the build host:
#   --build-arg DEBIAN_MIRROR=https://artifactory.amentum.internal/debian
ARG DEBIAN_MIRROR=""
RUN if [ -n "$DEBIAN_MIRROR" ]; then sed -i "s#http://deb.debian.org/debian#$DEBIAN_MIRROR#g" /etc/apt/sources.list.d/debian.sources; fi
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 10001 --create-home --home-dir /sandbox/home sandbox
WORKDIR /opt/sandbox
COPY backend/requirements.txt requirements.txt
RUN pip install -r requirements.txt \
 && python -m ipykernel install --sys-prefix --name python3
COPY backend/app app
RUN mkdir -p /sandbox/sessions && chown -R sandbox:sandbox /sandbox
USER sandbox
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=4)"
CMD ["uvicorn", "app.sandbox.server:app", "--host", "0.0.0.0", "--port", "8100"]
