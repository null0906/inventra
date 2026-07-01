FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ ./src/
RUN bun build src/server.ts --compile --minify --bytecode --outfile dist/inventra

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -r -u 1001 -g root inventra \
  && mkdir -p /data \
  && chown inventra:root /data
WORKDIR /app
COPY --from=builder /app/dist/inventra ./inventra
RUN chown inventra /app && chmod 750 inventra
USER inventra
ENV DATA_DIR=/data PORT=9000 HOST=0.0.0.0
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:9000/healthz || exit 1
ENTRYPOINT ["./inventra"]
