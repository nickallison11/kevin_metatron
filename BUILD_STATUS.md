# BUILD STATUS — kevin_metatron + metatron-landing

_Snapshot: 2026-05-08_

A point-in-time inventory of what's actually built, derived from reading the codebase (not from memory). Pair with `PLAN.md` for what to do next.

---

## kevin_metatron — backend

### Schema (53 migrations)

Auth + accounts: users, OAuth accounts, 2FA, password reset, user names, role profiles, admin/super-admin, suspension, prospects (+pitch deck, +signup status).

Pitches + decks: pitches (expanded + team), profile deck expiry + upload count, profile context CID, deck email sent flags.

Kevin: chat turns, chat sessions, vector memories (`kevin_memories`), text memories (`kevin_text_memories`), usage tracking.

Connector network: contacts, staging, enriched fields, dedup, archived, IPFS tiers, enrichment counter, credits, introductions/referrals, connector→investor matches.

Matches: investor matches, angel scores + kevin matches, kevin match intros.

Subscriptions: subscriptions, subscription invoices, paystack subscription codes, subscription plan, NowPayments pending, IPFS visibility.

Messaging: telegram id + link tokens, whatsapp.

### Modules

`ai`, `auth`, `cleanup` (12-month memory expiry + sub-end expiry), `compliance` (KYC/AML), `crypto`, `email` (Resend; 3 templated functions), `identity`, `ipfs_snapshot`, `memory` (pgvector + Gemini embeddings), `settings`, `state`, `main`.

### Routes (~80 endpoints across 27 files)

- **auth**: signup, login, 2FA setup/confirm/login/disable, OAuth authorize/callback, change-email, change-password, forgot-password, reset-password, account export + delete.
- **profile**: get/put own profile, set role, set whatsapp number, set ai-settings, set ipfs-visibility, pitch-deck upload.
- **pitches**: CRUD.
- **matches**: founder, investor, connector→investor with intro request/accept/pass + view-deck.
- **kevin**: chat, chat history, chat sessions, send-kevin-message (messaging widget).
- **messaging**: conversations list, conversation get + read, direct message send.
- **connector network**: list, add, batch import, CSV import, archive, export, IPFS snapshot, stage, list/clear staging, enrich staging, import from staging.
- **introductions + referrals**: request/accept/pass intro, view-deck, received-intros, referral generate + info.
- **angel score**: get own, get by id, generate.
- **investor**: pipeline list/add/update/remove, memos list/generate/delete, watchlist (route via following).
- **prospects**: CRUD.
- **connections / following**: create connection, list outgoing, list following founders.
- **admin**: list users, suspend, set pro, invite.
- **compliance**: KYC start, AML start.
- **subscriptions**: subscribe + verify (founder + connector + investor), invoices list + get, Paystack webhook, NowPayments subscribe + webhook.
- **oauth**: authorize, callback per provider.
- **telegram**: auth, confirm, link-token, unlink, kevin bot.
- **whatsapp**: webhook GET (verify) + POST.
- **inbound email** (Kevin email replies).
- **misc**: nonce, status, messaging-signup, list founders/startups/all, get-me.

---

## kevin_metatron — frontend

### Routes

- **Public**: `/`, `/login`, `/auth/*`, `/pricing`, `/messaging-signup`.
- **Founder dashboard** (`(dashboards)/startup`): home, pitches (693l), matches, calls, profile, settings, settings/subscription, settings/subscription/invoice/[id].
- **Investor dashboard** (`(dashboards)/investor`): home, matches, deal-flow (116l), watchlist (58l — stub), memos (117l), calls, profile, settings, settings/subscription, settings/subscription/invoice/[id].
- **Connector dashboard** (`(dashboards)/connector`): home, network (2017l), introductions, referrals, profile, settings, settings/subscription, settings/subscription/invoice/[id].
- **Admin**: `app/admin`.

### Components

`KevinChat` (661l), `MessagingWidget` (730l), 3 role shells (Startup/Investor/Connector), `AngelScoreCard`, `FounderCard`, `KevinMatchFeed`, `ConnectorUpgradeGate`, `Subscription{Pricing,Settings,Invoice}` views, `WalletProvider` (legacy Solana — likely removable), aceternity-style UI primitives in `components/ui/`.

---

## metatron-landing

Single-page Next.js. Sections: hero + ecosystem grid + pricing (toggle, paid tiers blurred) + waitlist (Resend) + privacy + terms. Light/dark theme toggle, mobile hamburger nav, brand logos. MTN token section hidden. Polished but static.

---

## Cleanup debt

- Finder copies tracked in git: `backend/src/routes/admin 2.rs`, `backend/src/routes/whatsapp 2.rs`, `backend/src/ipfs_snapshot 2.rs`, `frontend/app/(dashboards)/connector/network/page 2.tsx` (1,181 lines).
- Migration numbers 0035, 0037, 0041 missing — verify intentional renumbering.
- Uncommitted `frontend/app/home-client.tsx` copy tweak.
- Investor `watchlist` is 58 lines — almost certainly a stub.
- Solana/Phantom wallet code (`WalletProvider.tsx`, `ClientWalletProvider.tsx`) — legacy from Sphere Pay era, payments now use Paystack + NowPayments.

---

## Roadmap-vs-reality scorecard

| Roadmap item            | Status                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| Pitches                 | ✅ shipped (CRUD, team, expanded, expiry)                            |
| WhatsApp signup         | ✅ shipped (state machine + magic link)                              |
| Investor dashboard      | ◐ shell shipped; watchlist + deal-flow thin                          |
| Investor import         | ❌ no bulk-import endpoint for investors (connector has CSV/batch)   |
| Connector pages         | ✅ shipped (network, staging, enrich, credits, IPFS, intros, refs)   |
| Angel Score             | ✅ shipped (route, card, kevin_matches table)                        |
| Doc upload to Kevin     | ❌ deck upload exists; document → Kevin RAG context not wired        |
| Connect / Follow unify  | ❌ vocabulary fragmented across watchlist / following / request-intro |
