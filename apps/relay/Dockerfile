FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.work ./
COPY apps/relay/go.mod ./apps/relay/go.mod
COPY apps/relay/go.sum ./apps/relay/go.sum
COPY apps/relay ./apps/relay

WORKDIR /src/apps/relay

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/relay ./cmd/relay

FROM alpine:3.22

RUN addgroup -S relay && adduser -S relay -G relay

WORKDIR /app

COPY --from=build /out/relay /usr/local/bin/relay

USER relay

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/v1/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/relay"]
