FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv poppler-utils curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev

COPY web/package.json web/package-lock.json ./web/
WORKDIR /app/web
RUN npm ci

WORKDIR /app
COPY . .

WORKDIR /app/web
RUN npm run build
RUN ls -la .next/

ENV PROJECT_ROOT=/app
WORKDIR /app/web

CMD sh -c "npx next start -H 0.0.0.0 -p ${PORT:-3000}"
