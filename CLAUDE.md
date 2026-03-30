# CLAUDE.md — kevin_metatron Project Context

## What is metatron?

metatron is a global platform connecting founders, investors, and ecosystem partners via on-chain anchored pitch data and AI-powered matching. It's built by Phoenix Eleven Limited (trading as metatron), co-founded by Nick Allison (technical lead) and Rianna (business development/investor relations). The project is venture-backed by Flori Ventures and uses Apache-2.0 licensing.

Nick has spoken to founders across Africa, Asia, India, USA, Europe, LATAM, and Australia, maintaining connections with angels and VCs across multiple regions.

## Domain & Product Structure

| Domain | Purpose |
|---|---|
| `metatrondao.io` | DAO / foundation layer (stays as-is, will become metatron foundation) |
| `metatron.id` | Consumer product / Kevin landing page. Links to Kevin on Telegram/WhatsApp/email and to the platform |
| `platform.metatron.id` | Web app (this repo replaces the legacy CRA version) |
| `agent.metatrondao.io` | OpenClaw web interface (stays as-is) |

## Repository Structure

This is a monorepo at `github.com/nickallison11/kevin_metatron`:

```
kevin_metatron/
├── frontend/          # Next.js + Tailwind CSS + TypeScript
├── backend/           # Rust / Axum API server
│   └── migrations/    # PostgreSQL migrations (sqlx)
├── solana/            # metatron_core Solana program
├── reference/         # platform-live design reference files
├── docker-compose.yml # PostgreSQL container
└── CLAUDE.md          # This file
```

### Frontend (Next.js)
- Port: 3000
- Pages: Landing/role selection, auth/signup, startup dashboard, investor dashboard, connector dashboard
- API calls go to `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4000`)

### Backend (Rust/Axum)
- Port: 4000
- Routes: auth (JWT + Argon2), pitches, pools, investments, compliance
- Database: PostgreSQL via sqlx
- Env vars: `BACKEND_DATABASE_URL`, `BACKEND_JWT_SECRET`, `RUST_LOG`

### Solana Program
- `metatron_core` — handles pitch hashes, pool manifests, stablecoin commitments
- Developed with Anchor framework

### Running locally
```bash
docker compose up -d          # Start PostgreSQL
cd backend && cargo run       # Start Rust API on :4000
cd frontend && npm run dev    # Start Next.js on :3000
```

## Design System (metatron.id)

All UI must match the metatron.id design system. **Never deviate from these tokens.**

| Token | Value |
|---|---|
| Font (body) | DM Sans (Google Fonts) |
| Font (mono/labels) | JetBrains Mono |
| Background | `#0a0a0f` |
| Card background | `#16161f` |
| Text | `#e8e8ed` |
| Muted text | `#8888a0` |
| Accent (primary) | `#6c5ce7` (purple) |
| Accent glow | `rgba(108,92,231,0.2)` |
| Borders | `rgba(255,255,255,0.06)`, 1px solid |
| Border radius | 12px |
| Nav | Sticky, `rgba(10,10,15,0.85)`, `backdrop-filter: blur(12px)`, border-bottom `rgba(255,255,255,0.06)` |
| Logo | `https://metatron.id/wp-content/uploads/2026/03/metatron-_Logo.png` at 42px height, no separate wordmark |
| Background effects | 52px grid (`grid-bg`) + purple orb glow (radial-gradient) |

The reference design files are in `reference/platform-live/` (App.js, App.css from the live CRA version on KVM2).

## User Roles

Three roles on the platform:
1. **Founder** — creates pitch profiles, uploads decks, records calls
2. **Investor** — browses founders, requests intros, manages deal flow
3. **Connector** — ecosystem partners (placeholder dashboard, to be built out)

Authentication: Connect Solana wallet (Phantom/Solflare) **OR** email/password (both options).

## Feature Roadmap (build in this order)

### ✅ Completed
- metatron.id design system applied to Next.js frontend
- Role selection (Founder/Investor/Connector) on landing page
- Signup with email/password → JWT auth
- Startup and investor dashboard shells
- Rust backend with auth, pitches, pools, investments, compliance routes
- Telegram bot (wallet_bot.py on KVM2) with /pitch, /investor, /find, /findinvestor, /intro, /approve, /reject
- IPFS profile storage via Pinata
- MTN token gating on Telegram (10k tMTN for Kevin access)

### 🔨 To Build (priority order)
1. **Founder Profile & Pitch Deck Upload** — profile page at `/startup/profile`, pitch deck upload → backend stores on Pinata IPFS, profile data in PostgreSQL `profiles` table
2. **Kevin Chat Widget** — floating chat button on all dashboard pages, messages POST to `/api/kevin/chat` → Anthropic API (Claude) with user context (role, profile, pitches). Use `ANTHROPIC_API_KEY` env var on backend
3. **Call Intelligence** — `/startup/calls` page, upload audio recordings (.m4a/.mp3/.wav), backend sends to Whisper API Docker container on KVM2 (port 9000) for transcription, then Claude for analysis (summary, key takeaways, action items, investor sentiment). Display in card layout. Both founder and investor get tailored insights if investor opts in
4. **Investor Deal Flow** — investor dashboard shows matched startups, each card: company name, stage, sector, one-liner, "View pitch" + "Request intro" buttons
5. **Wallet Connect** — Phantom/Solflare integration, MTN token balance check, alternative to email auth
6. **Pro Tier** — $9.99/month subscription via Stripe

### Pro Tier Features (gated behind subscription)
- Private deck storage on Pinata (free tier = public IPFS only)
- Full contact card shared on intros (free = deck link only)
- `startup_name.metatron.id` — custom subdomain with own AI agent
- Choice of AI backend (Claude, GPT-4, Gemini, etc.)
- Custom system prompt and knowledge base for their agent
- Embeddable widget on founder's own website
- Call Intelligence access

### Free vs Pro Contact Sharing
| | Free Founder | Pro Founder |
|---|---|---|
| Investor sees on intro | Deck link only | Full contact card (name, email, LinkedIn, website) |
| Profile on IPFS | Summary only | Full profile |
| Deck storage | Public IPFS | Private Pinata |
| Custom subdomain | No | `startup_name.metatron.id` |

## MTN Token (Solana)

- **Token**: MTN — native governance and utility token
- **Mint address**: `2tUS8sXb1U84sE2q2NbgmoUQ47s97LRNM58EJ5a1Rhed` (Solana mainnet)
- **Supply**: 1 billion MTN
- **Mint/freeze authority**: `DXGYnw8hUK9e4upyvDQPKhgQu7x6hD9DeWQV6GgbdJ29` (Nick's wallet, managed internally)
- **Functions**: Kevin access gating (minimum MTN balance), DAO governance voting
- **Tokenised ETF mechanic**: holders gain collective exposure to vetted startups; investors receive exposure through MTN, startups receive USDC
- **Devnet**: 10k tMTN required for Kevin access via Telegram

## KVM2 Server (Production — 31.97.189.18)

The production server runs:
- `wallet_bot.py` — Telegram bot (sole Telegram handler, conversational AI + notifications, calls NadirClaw for Kevin responses)
- `wallet_webhook.py` (port 8857) — wallet registration webhook
- `nadirclaw` (port 8856) — Kevin AI backend
- `openclaw` — web interface only (Telegram disabled)
- `ipfs.py` — Pinata IPFS helper module
- Whisper API Docker container (port 9000) — audio transcription
- nginx serving platform.metatron.id (port 8080, `/var/www/platform`)
- Key data files: `/root/.metatron_profiles.json`, `/root/.metatron_investors.json`, `/root/.metatron_intros.json`
- Env: `/root/.env` (contains `PINATA_JWT`, `ANTHROPIC_API_KEY`, etc.)

## IPFS / Data Architecture

Founder data is stored on IPFS linked to wallet and (future) NFT:
1. Founder completes onboarding → profile JSON + deck uploaded to Pinata IPFS → gets CID
2. (Phase 2) Mint metatron Founder NFT on Solana with metadata URI pointing to IPFS CID
3. Founders own their data in their wallet — decentralised, verifiable on-chain

## Crossmint Integration (ON HOLD)

Crossmint was evaluated for fiat-to-USDC checkout and embedded wallet creation. Pricing received:
- $1,000 onboarding fee (one-time)
- $1,899/month (includes 10k wallets)
- 6.9% + $0.30 per checkout transaction

**Decision: Too expensive for MVP.** Exploring alternatives (MoonPay, Transak, crypto-only launch with Phantom/Solflare) or negotiating a startup tier. Contact: Fonz at Crossmint.

## Conventions

- All colours use the design system tokens above — never use emerald/green/slate from old designs
- Keep the metatron.id logo as-is (no separate wordmark text next to it)
- Sidebar nav on dashboards with links: Dashboard, Profile, Pitches, Calls (founder) / Dashboard, Deal Flow, Watchlist (investor)
- Use DM Sans everywhere, JetBrains Mono for code/labels/mono elements
- Cards: `#16161f` bg, 12px radius, `rgba(255,255,255,0.06)` border
- Buttons: `#6c5ce7` primary, hover slightly lighter, 12px radius
- All API calls from frontend go through `NEXT_PUBLIC_API_BASE_URL`
- Backend uses sqlx migrations — add new tables via `backend/migrations/`
- Solana interactions use Helius RPC (devnet for testing, mainnet for production)

## White Paper

A metatron white paper rewrite (from V1.3) is pending, targeting institutional partners, crypto-native investors, traditional investors, and founders.
