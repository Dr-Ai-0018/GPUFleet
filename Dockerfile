FROM node:22-slim AS frontend-build

WORKDIR /app/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM ghcr.io/astral-sh/uv:0.5.31 AS uv-bin

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:/usr/local/bin:$PATH"

WORKDIR /app

COPY --from=uv-bin /uv /uvx /usr/local/bin/
COPY pyproject.toml uv.lock alembic.ini ./
COPY alembic ./alembic
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
