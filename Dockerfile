FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY skills ./skills
COPY SOUL.md ./
COPY opencode.review.json ./

ENV SQLITE_PATH=/data/queue.db
VOLUME ["/data"]
EXPOSE 3000

# NOTE: install the chosen AI CLI (`claude`, `opencode`, or `cursor-agent`) into
# a derived image and provide its credentials via env before this server can
# review. e.g. cursor: RUN curl https://cursor.com/install -fsS | bash + CURSOR_API_KEY.
CMD ["node", "dist/index.js"]
