# Stage 1 — Build
FROM rust:1.82-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY backend ./backend
RUN cargo build --release -p backend

# Stage 2 — Runtime
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/backend ./backend
EXPOSE 4000
CMD ["./backend"]
