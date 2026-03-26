FROM oven/bun:1.2.19-alpine

WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json

RUN bun install

COPY . .

EXPOSE 5173

CMD ["bun", "run", "dev:web", "--", "--host", "0.0.0.0", "--port", "5173"]
