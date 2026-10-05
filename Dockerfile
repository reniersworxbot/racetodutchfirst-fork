# The self-hosted site: the fetch loop (racetodutchfirst.serve) with site/ as its template.
# nginx serves the published folder (/srv/www, a volume) from a separate container; see
# CLAUDE.md "Hosting". Built and published by .github/workflows/image.yml; the homelab repo
# (reniersworx/senate, apps/compose/racetodutchfirst) pins it by digest.
FROM python:3.13-slim-bookworm@sha256:5024f48ba9441d4b13a95d3945abc6365538e3a31109833367a1923523c6efed

# chromium draws og.png (scripts/og-image.sh, hourly); curl is that script's wait loop.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium curl fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY guilds.toml ./
COPY seasons ./seasons
COPY scripts ./scripts
COPY site ./site
COPY src ./src
# Editable (uv's default): serve.py finds guilds.toml, site/ and scripts/ next to src/.
RUN uv sync --locked --no-dev

# --no-sandbox: the page is this repo's own; the sandbox needs user namespaces the container
# doesn't get. --disable-dev-shm-usage: Docker's 64 MB /dev/shm is too small for a render.
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    CHROME=chromium \
    CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage" \
    RTDF_WWW=/srv/www \
    HOME=/tmp
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin rtdf \
 && mkdir -p /srv/www && chown 10001:10001 /srv/www
USER 10001
CMD ["python", "-m", "racetodutchfirst.serve"]
