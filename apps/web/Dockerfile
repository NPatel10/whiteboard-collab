FROM oven/bun:1.2.19-alpine AS build

WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json

RUN bun install --frozen-lockfile

COPY . .

WORKDIR /workspace/apps/web

RUN bun run build

FROM oven/bun:1.2.19-alpine

RUN addgroup -S web && adduser -S web -G web

WORKDIR /workspace

COPY --from=build /workspace /workspace

USER web

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:5173 >/dev/null || exit 1

CMD ["sh", "-lc", "cd /workspace/apps/web && bun run preview -- --host 0.0.0.0 --port 5173"]
