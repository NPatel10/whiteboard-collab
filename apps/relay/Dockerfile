FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.work ./
COPY apps/relay/go.mod ./apps/relay/go.mod
COPY apps/relay ./apps/relay

WORKDIR /src/apps/relay

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/relay ./cmd/relay

FROM alpine:3.22

RUN addgroup -S relay && adduser -S relay -G relay

WORKDIR /app

COPY --from=build /out/relay /usr/local/bin/relay

USER relay

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/relay"]

