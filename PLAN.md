# PLAN — Pre-GTM hardening

_Drafted: 2026-05-08. Pair with `BUILD_STATUS.md` for the inventory._

GTM is weeks-to-months out. This plan is **CEO/PM-lens, not feature-lens**: every working day closes a gap that would block paying users, *not* a gap that adds features.

---

## Connect / Follow vocabulary (locked 2026-05-08)

Two primitives, **"Intro" is killed from user-facing copy entirely**:

- **Follow** — one-way, low-commitment. No notification to the followed party. Replaces `watchlist`.
- **Connect** — mutual handshake. Either party requests, the other accepts. Once connected, messaging is unlocked. Replaces `request intro` / `accept intro` / `pass intro` everywhere it appears.

**Kevin's curated warm-email magic is a feature, not a button.** When a founder hits Connect on a Kevin match, Kevin sends the warm-intro email behind the scenes — but the user just sees "Connect."

**Connectors don't get a separate verb either.** A connector facilitating a relationship between two parties also creates a Connect (on their behalf). The connector's job-to-be-done is still introducing people, but the user-facing primitive is the same: Connect.

**Words to remove from all user-facing copy and routes-as-shown-to-user:**
`request intro`, `accept intro`, `pass intro`, `Request Intro` (button), `intros`, `received intros`, `request-intro`, `Watchlist`.

Backend route names can keep `intros` for one transition release (mapped to `connections` going forward) to avoid breaking webhooks/links.

---

## The focus problem

Three roles × seven page categories × subscription gating × Kevin chat × messaging × WhatsApp/Telegram × connector enrichment is already too much surface area. The risk before GTM isn't *missing features* — it's **the core loop not playing end-to-end without intervention**.

### Core loop (everything else is optional)

1. Founder signs up → uploads deck → Angel Score generated → Kevin profiles them.
2. Investor signs up → declares thesis → Kevin matches them with founders.
3. Either side hits **Connect** (Kevin/connectors create Connects on a user's behalf — same primitive, no separate "Intro" verb).
4. On accept, messaging unlocks. Kevin sends a curated warm email behind the scenes — the user just sees the Connect succeed.
5. Subscription gates volume (Free vs Basic; no Pro yet).

Anything off this path is a side quest. Park or hide.

---

## Test methodology — test each role with the shared account

Per existing convention, **all roles are tested through `kevin.metatron.testing@gmail.com`** using Gmail `+alias` extensions, just like the 14-day autonomous test:

- `kevin.metatron.testing+founder@gmail.com` → founder role
- `kevin.metatron.testing+investor@gmail.com` → investor role
- `kevin.metatron.testing+connector@gmail.com` → connector role

Each day's PR ends with a **role-walkthrough** using these aliases. No PR ships until all three roles open the affected pages without error and the day's success criteria are met.

Test artifact per day: a short note in `tests/walkthroughs/YYYY-MM-DD.md` listing what was clicked, what worked, what broke, screenshots for any visual regression.

---

## Day 0 — Stand up dev/prod URL split ✅ COMPLETE 2026-05-08

**Goal:** establish `development` → `dev.metatron.id` and `main` → `platform.metatron.id` as separate deploy targets, both still backed by the same KVM2 stack for now. No new DB, no new backend, no env changes, no secret rotation. Block indexing everywhere until GTM.

**Current state being relabeled:** the existing Vercel app + KVM2 backend + KVM2 Postgres + all current secrets *is* the development stack. Nothing about that infra changes today.

### Steps

1. **Branch:** `git checkout -b development && git push -u origin development` from current `main`.
2. **Vercel project settings:**
   - Keep `main` as Production Branch.
   - Domains tab → `platform.metatron.id` stays on `main`.
   - Add `dev.metatron.id` and assign to branch `development`.
3. **Cloudflare DNS:**
   - CNAME `dev` → `cname.vercel-dns.com` (proxy off, DNS only — Vercel handles SSL).
4. **Block indexing on both URLs** (since both serve pre-GTM dev data). Two layers:
   - `frontend/app/robots.ts` returns `Disallow: /` for all user agents.
   - `frontend/middleware.ts` adds header `X-Robots-Tag: noindex, nofollow, noarchive` to every response.
   - When real prod is built later, remove these on the `main` branch only.
5. **KVM2 backend** stays as-is, single instance serving both Vercel deploys via the same `NEXT_PUBLIC_API_BASE_URL`. KVM2 tracks the `development` branch (it's where active commits land).
6. **Verify:**
   - Push a no-op commit to `development` → confirm Vercel deploys → load `dev.metatron.id` → log in with a test alias → confirm features work.
   - Merge `development` → `main` → confirm Vercel re-deploys → load `platform.metatron.id` → confirm same.
   - `curl -I https://dev.metatron.id` shows `X-Robots-Tag: noindex` header.
   - `curl https://dev.metatron.id/robots.txt` returns Disallow.

### Workflow going forward

- Cursor edits commit to `development`, push, view at `dev.metatron.id`.
- When happy: `git checkout main && git merge development && git push` → ships to `platform.metatron.id`.
- KVM2 pulls `development` daily (or when migrations land). Backend is shared, so changes are immediately visible at both URLs.

### Future task (NOT in this 7-day plan, parked for after GTM checklist is green)

**Build clean production stack.** Stand up `kevin_prod` Postgres on KVM2, second backend service `kevin-backend-prod` on a separate port, nginx route `api.metatron.id` → port-prod. Migrate just the founder/investor data we want from `kevin_dev`. Swap `main` branch's `NEXT_PUBLIC_API_BASE_URL` to the new prod API. Remove noindex on `main`. This is its own multi-day project — do it when GTM date is locked.

---

## 7-day plan of attack

Each day = one shippable PR. Hard rule: if a day's diff balloons past ~400 LOC changed (excluding generated/migration), stop and re-scope.

### Day 1 — Cleanup & focus debt (low risk, clears mental load)

- Delete the 4 ` 2.rs` / ` 2.tsx` Finder duplicates.
- Resolve uncommitted `home-client.tsx` diff (ship or drop).
- **Hide from nav** (don't delete code yet): `investor/watchlist`, `investor/calls`, `investor/deal-flow`, `connector/referrals`. They stay reachable via direct URL so we can revisit, but they're off the critical path for GTM.
- Remove residual Solana/Phantom wallet imports (`WalletProvider.tsx`, `ClientWalletProvider.tsx`) if no longer referenced.
- Verify migrations 0035/0037/0041 are intentionally skipped.

**Success criteria:** clean `git status`, build passes, Vercel deploys, all three test roles can still log in and reach their dashboards.

### Day 2 — Walk the core loop end-to-end with all three test roles

**Build nothing.** Test only. Use the three Gmail aliases.

Walkthrough:

1. Founder signs up via email → confirms → completes profile → uploads deck → sees Angel Score → opens Kevin chat.
2. Investor signs up → completes thesis → sees Kevin matches → opens a founder profile.
3. Connector signs up → imports a small CSV → enriches → sees connector→investor matches.
4. Investor requests intro to founder → founder receives intro email → founder accepts → messaging opens for both → both see conversation in their inbox.

Document every break point. **Fix only blockers, no polish.** Ship a PR titled `core-loop walkthrough fixes`.

**Success criteria:** screen recording of the full loop without intervention. This recording becomes Day 6's landing-page demo.

### Day 3 — Connect / Follow primitive

Refactor the fragmented vocabulary into the two clean primitives. **No "Intro" anywhere user-facing.**

- **DB**: unified `follows` table (one-way) and `connections` table (mutual, with `requested_at` / `accepted_at` / `declined_at`). Migrate `watchlist` rows → `follows`. Migrate intro records → `connections` with appropriate state. Idempotent.
- **API**: `/follow` (POST/DELETE), `/connections` (POST request, PUT accept, DELETE decline/cancel). Keep old `/intros` routes as thin aliases for one release so webhooks don't break.
- **Frontend**: every `Request Intro` / `Accept Intro` / `Pass Intro` / `Watchlist` button and label becomes `Connect` / `Accept` / `Decline` / `Follow`. This includes:
  - Founder dashboard match cards (the screenshot)
  - Investor match cards
  - Connector intro flow (still creates a Connect on the connector's behalf)
  - Email templates (deck view, accept, pass intro templates need rewording)
  - Notification copy
- **Kevin's curated warm email** is triggered by a successful Connect — not a separate button.
- **Side effect to verify:** messaging unlocks only after `accepted_at` is set on a `connection`.

**Success criteria:** zero user-visible occurrences of the word "intro" remain (except possibly in marketing copy if Nick wants it). All three roles can Follow + Connect end-to-end with the test aliases. Old `/intros` URLs still respond 200 via aliases for one release.

### Day 4 — Doc upload to Kevin (the unique-to-Kevin moat)

Wire deck/doc → text extract → embed (Gemini) → store in `kevin_text_memories` keyed to user. Make Kevin chat retrieve relevant chunks when the user asks about their deck or strategy.

Founder-only first. No multi-doc UI.

**Success criteria:** founder uploads deck → asks "what's my GTM?" → Kevin answers with content drawn from the deck. Visible in chat history.

### Day 5 — Subscription end-to-end verification (per role)

For each of the three test aliases:

- Walk the Paystack ZAR card flow on devnet.
- Walk the NowPayments fiat→crypto on-ramp for one role.
- Confirm webhook flips `is_pro`, `subscription_plan`, `subscription_period_end`.
- Cancel-at-period-end: confirm `cleanup` task expires correctly (manually advance timestamps if needed).
- Confirm invoice page renders for the new subscription.

Fix what breaks. **No new payment features.** Pricing copy must match what's actually wired (Free + Basic; no Pro).

**Success criteria:** all three roles can subscribe, see invoice, cancel, expire. Webhooks survive a kill-and-replay test.

### Day 6 — Landing page → product alignment

- Update `metatron-landing` copy to match what's live: Free + Basic only, Paystack + NOWPayments not Sphere/Solana, current ecosystem boxes.
- Hook the Resend waitlist into the platform's onboarding email if not already (so waitlisted users land in the funnel).
- Embed Day 2's screen-recording as the "see how it works" demo.
- Verify mobile hamburger nav still works after copy changes.

**Success criteria:** landing claims = product reality. No paid tier shown that doesn't exist.

### Day 7 — Pre-GTM hardening

- Verify deck-expiry email cadence fires (manually backdate a deck to trigger Day 7/13/14/expired).
- Fix Kevin role-awareness bug (memory: Kevin asks founders their role).
- Confirm `KVM2` envs separate devnet/prod (memory flagged this as deferred debt — at minimum, document the boundary).
- Account export + delete works for all three roles (POPIA).
- Run gstack `/security-review` on the loop and fix anything flagged HIGH.
- Write release notes for the GTM cohort.

**Success criteria:** GTM-readiness checklist below is fully ticked.

---

## GTM readiness checklist (CEO/PM lens)

Before paid users land, every box ticked:

### Product

- [ ] Core loop plays end-to-end for all 3 roles without intervention (Day 2)
- [ ] Connect / Follow vocabulary unified (Day 3)
- [ ] Kevin can answer questions from a founder's uploaded deck (Day 4)
- [ ] Subscription charges + grants access for all 3 roles (Day 5)
- [ ] Cancel + expire works (Day 5)
- [ ] Email cadence fires correctly (Day 7)
- [ ] Kevin behaves correctly per role (Day 7)
- [ ] No "Pro" referenced anywhere user-facing (memory rule)

### Compliance & trust

- [ ] Account export works
- [ ] Account delete works
- [ ] Privacy policy on landing page matches data practice
- [ ] Terms of service current
- [ ] POPIA-aware data handling for ZA users
- [ ] Security review passed (no HIGH findings)

### GTM mechanics

- [ ] Landing page copy = product reality (Day 6)
- [ ] Pricing on landing = pricing in code (Day 6)
- [ ] Demo recording embedded (Day 6)
- [ ] Waitlist → onboarding email pipeline live
- [ ] Support / feedback channel published (email or in-app)
- [ ] Analytics on signup funnel for each role

### Ops

- [ ] Deploy workflow documented (memory: Mac push → KVM2 pull, Vercel auto)
- [ ] Devnet/prod boundary documented even if not separated
- [ ] Backup + restore tested for the DB
- [ ] Cleanup task runs on schedule
- [ ] Test E2E account credentials documented (memory has this)

---

## Idea parking lot

Write down so you don't forget. **Don't touch until GTM checklist is green.**

- Startup credibility / eKomi peer review (parked per memory)
- Doc upload beyond decks (term sheets, MFNs)
- Connector IPFS tier logic refinement
- MTN token economics
- Investor calls + AI summary
- Founder weekly matches email v1 (gated on full founder pipeline + IPFS + Kevin extraction + role-awareness — Day 7 fixes one of those)
- Pro tier (future, when there's a feature meaningful enough to charge for)
- Investor bulk-import (table-stakes plumbing, can wait until first investor cohort asks)
- Investor watchlist UX (replaced by Follow on Day 3)

---

## Scope-protection rules

1. No new feature until Day 2's screen recording plays start-to-finish without intervention.
2. If a day's PR exceeds ~400 LOC changed (excluding migrations), stop and re-scope.
3. Anything an existing user wouldn't notice = side quest. Log in parking lot.
4. CEO/PM gut-check at end of each day: "would a paying customer notice this shipped?" If no, the day was probably wrong.
5. Re-read this file at the start of each day. Update the checkboxes. Don't drift.
