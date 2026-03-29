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
RUN cd web && npm ci

COPY . .

RUN cd web && npm run build

ENV PROJECT_ROOT=/app
EXPOSE 3000

CMD ["npm", "--prefix", "web", "run", "start"]
