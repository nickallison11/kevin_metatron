# Metatron Connect (Base44)

Monorepo for the Metatron Connect MVP: a global matching platform for startups,
investors, and intermediaries, with on-chain anchored pitch data, KYC/AML
orchestration, and funding pool management.

- `frontend/` – Next.js app for public marketing pages and role-based dashboards
- `backend/` – Rust (Axum) API service for auth, profiles, pitches, pools, and compliance
- `solana/` – Solana programs (e.g. `metatron_core`) for pitch hashes, pool manifests, and stablecoin commitments

See `.env.example` and `docker-compose.yml` for local development defaults.
