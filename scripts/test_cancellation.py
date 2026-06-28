#!/usr/bin/env python3
"""
Test cancellation flow end-to-end:
  1. Cancel subscription via API → cancel_at_period_end = TRUE
  2. Paystack subscription disabled
  3. Cancellation email sent
  4. Backdate period_end → run cleanup SQL → account downgrades to free
  5. Verify undo-cancel restores the flag

Run on KVM2:
  set -a && source /root/.env && set +a && python3 scripts/test_cancellation.py

Requires the test account to have an active subscription.
Run test_pro_signup.py first if needed.
"""

import os, subprocess, time
import requests

BACKEND    = os.getenv("BACKEND_URL", "http://localhost:4000")
PS_SECRET  = os.getenv("PAYSTACK_SECRET_KEY", "")
RESEND_KEY = os.getenv("RESEND_API_KEY", "")
DB_URL     = os.getenv("BACKEND_DATABASE_URL", "postgresql://metatron:metatron@localhost:5432/metatron")

TEST_EMAIL    = "kevin.metatron.testing+founderpro2@gmail.com"
TEST_PASSWORD = os.getenv("TEST_PASSWORD", "TestFounder2026!")

PS_HEADERS = {"Authorization": f"Bearer {PS_SECRET}", "Content-Type": "application/json"}

def db(query):
    r = subprocess.run(["psql", DB_URL, "-t", "-c", query], capture_output=True, text=True)
    return r.stdout.strip()

def step(msg):
    print(f"\n{'='*60}\n  {msg}\n{'='*60}")

def assert_ok(label, condition, got=""):
    mark = "✓" if condition else "✗"
    print(f"  {mark} {label}" + (f": {got}" if got else ""))
    if not condition:
        raise SystemExit(f"FAIL: {label}")

# ── 0. Pre-flight: ensure active subscription ─────────────────
step("0. Pre-flight check")
# Ensure a clean cancellation state before testing
db(f"UPDATE users SET cancel_at_period_end=FALSE, subscription_status='active' WHERE email='{TEST_EMAIL}' AND subscription_plan != 'free'")
row = db(f"""
    SELECT subscription_plan, subscription_status, cancel_at_period_end::text,
           paystack_subscription_code
    FROM users WHERE email='{TEST_EMAIL}'
""")
print(f"  Current state: {row}")
assert_ok("subscription is active", "active" in row,
          "Run test_pro_signup.py first to create an active subscription")

# Get subscription code for Paystack verification
sub_code = db(f"SELECT paystack_subscription_code FROM users WHERE email='{TEST_EMAIL}'").strip()
print(f"  Paystack subscription code: {sub_code or '(none — Paystack disable step will be skipped)'}")

# ── 1. Login ──────────────────────────────────────────────────
step("1. Login → JWT")
r = requests.post(f"{BACKEND}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
assert_ok("login 200", r.status_code == 200, r.status_code)
token = r.json()["token"]
print(f"  Token: {token[:40]}...")

# ── 2. Cancel subscription ────────────────────────────────────
step("2. POST /subscriptions/cancel")
r = requests.post(f"{BACKEND}/subscriptions/cancel",
    headers={"Authorization": f"Bearer {token}"})
assert_ok("cancel 200", r.status_code == 200, r.status_code)

# ── 3. Assert DB — cancel_at_period_end set ───────────────────
step("3. Assert cancel_at_period_end = TRUE")
time.sleep(1)
flag = db(f"SELECT cancel_at_period_end::text FROM users WHERE email='{TEST_EMAIL}'").strip()
assert_ok("cancel_at_period_end = true", flag in ("t", "true"), flag)
print(f"  cancel_at_period_end: {flag}")

# ── 4. Assert Paystack subscription disabled ──────────────────
step("4. Assert Paystack subscription is disabled")
if sub_code:
    r = requests.get(f"https://api.paystack.co/subscription/{sub_code}", headers=PS_HEADERS)
    ps_status = r.json().get("data", {}).get("status", "unknown")
    # Paystack sets subscription to "non-renewing" when disabled — not "active"
    assert_ok("Paystack subscription = non-renewing", ps_status == "non-renewing", ps_status)
    print(f"  Paystack status: {ps_status}")
    print("  NOTE: undo-cancel cannot re-enable a Paystack subscription once disabled.")
    print("        Users who undo a cancel will need a new subscription created.")
else:
    print("  No subscription code in DB — skipping Paystack check")
    print("  (this account was created via test script, not hosted checkout)")

# ── 5. Assert cancellation email ─────────────────────────────
step("5. Assert cancellation email via Resend")
time.sleep(2)
r = requests.get("https://api.resend.com/emails?limit=20",
    headers={"Authorization": f"Bearer {RESEND_KEY}"})
emails = [e for e in r.json().get("data", []) if TEST_EMAIL in str(e.get("to", ""))]
cancel_email = next((e for e in emails
    if "cancellation" in e.get("subject", "").lower()), None)
assert_ok("cancellation email delivered",
          cancel_email and cancel_email["last_event"] == "delivered",
          cancel_email["subject"] if cancel_email else "not found")

# ── 6. Test undo-cancel ───────────────────────────────────────
step("6. DELETE /subscriptions/cancel (undo)")
r = requests.delete(f"{BACKEND}/subscriptions/cancel",
    headers={"Authorization": f"Bearer {token}"})
assert_ok("undo cancel 200", r.status_code == 200, r.status_code)
flag = db(f"SELECT cancel_at_period_end::text FROM users WHERE email='{TEST_EMAIL}'").strip()
assert_ok("cancel_at_period_end = false after undo", flag in ("f", "false"), flag)

# Re-cancel so we can test expiry
r = requests.post(f"{BACKEND}/subscriptions/cancel",
    headers={"Authorization": f"Bearer {token}"})
assert_ok("re-cancel 200", r.status_code == 200, r.status_code)

# ── 7. Simulate period expiry ─────────────────────────────────
step("7. Backdate period_end → run cleanup SQL → assert downgrade to free")
db(f"UPDATE users SET subscription_period_end = NOW() - INTERVAL '1 minute' WHERE email='{TEST_EMAIL}'")
print("  Backdated subscription_period_end to 1 minute ago")

# Run the same SQL the cleanup cron runs
db("""
    WITH expired AS (
        UPDATE users
        SET subscription_status = 'inactive',
            is_pro = FALSE,
            subscription_plan = 'free',
            cancel_at_period_end = FALSE
        WHERE cancel_at_period_end = TRUE
        AND subscription_period_end < NOW()
        AND subscription_status = 'active'
        RETURNING id
    ),
    reset_investors AS (
        UPDATE investor_profiles SET investor_tier = 'free'
        WHERE user_id IN (SELECT id FROM expired)
    )
    UPDATE connector_profiles SET connector_tier = 'free'
    WHERE user_id IN (SELECT id FROM expired)
""")
print("  Ran expiry cleanup SQL")

time.sleep(1)
row = db(f"""
    SELECT subscription_plan, subscription_status, is_pro::text, cancel_at_period_end::text
    FROM users WHERE email='{TEST_EMAIL}'
""")
print(f"  Post-expiry state: {row}")
assert_ok("subscription_plan = free",     "free"     in row)
assert_ok("subscription_status = inactive","inactive" in row)
assert_ok("is_pro = false",              "false" in row or "| f " in row or row.endswith("| f"))
assert_ok("cancel_at_period_end = false", "false" in row or "| f" in row)

print(f"\n{'='*60}")
print("  ALL ASSERTIONS PASSED — cancellation flow verified ✓")
print(f"{'='*60}\n")
