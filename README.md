# metatron

metatron connects founders, investors and connectors (ecosystem partners) through
AI matching and warm introductions. Its assistant, **Kevin from metatron**, works over
WhatsApp, Telegram and email, and over MCP from the user's own AI. The web platform
lives at [platform.metatron.id](https://platform.metatron.id).

## Repository

- `frontend/` – Next.js + Tailwind + TypeScript web app: onboarding, founder/investor/connector
  dashboards, public startup pages and ratings, pricing and billing. Deployed on Vercel.
- `backend/` – Rust (Axum) API: auth and sessions, profiles and decks, matching and intros,
  Kevin chat and memory, MCP server, WhatsApp webhooks, Stripe billing, email, and
  admin. PostgreSQL via sqlx; migrations in `backend/migrations/` run on startup.
- `solana/` – `metatron_core` Anchor program for pitch hashes, pool manifests and
  stablecoin commitments (devnet).
- `scripts/` – Telegram bot, e2e monitor and cron helper scripts.

## Running locally

```bash
docker compose up -d          # PostgreSQL 16 + pgvector on :5432
cd backend && cargo run       # API on :4000
cd frontend && npm run dev    # web app on :3000
```

The backend reads `BACKEND_DATABASE_URL`, `BACKEND_JWT_SECRET` and `RUST_LOG` from the
environment. The frontend calls `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4000`).

## Branches

- `development` – dev environment (dev web app, dev API, dev database)
- `main` – production

## License

Apache-2.0. See [LICENSE](LICENSE).
