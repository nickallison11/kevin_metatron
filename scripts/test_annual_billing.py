#!/usr/bin/env python3
"""
Test annual billing end-to-end for Founder Pro.

Run on KVM2:
  set -a && source /root/.env && set +a && python3 scripts/test_annual_billing.py
"""

import os, json, hmac, hashlib, time, subprocess, urllib.request, urllib.error
import requests

BACKEND    = os.getenv("BACKEND_URL", "http://localhost:4000")
PS_SECRET  = os.getenv("PAYSTACK_SECRET_KEY", "")
RESEND_KEY = os.getenv("RESEND_API_KEY", "")
INVITE_SEC = os.getenv("INVITE_SECRET", "")
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

# ── 0. Reset ──────────────────────────────────────────────────
step("0. Reset test account to free")
existing = db(f"SELECT subscription_plan FROM users WHERE email='{TEST_EMAIL}'").strip()
if existing:
    db(f"""UPDATE users SET subscription_plan='free', subscription_status='inactive',
           subscription_tier='monthly', is_pro=false, paystack_subscription_code=NULL,
           subscription_period_end=NULL WHERE email='{TEST_EMAIL}'""")
    db(f"DELETE FROM subscription_invoices WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')")
    print(f"  Reset from {existing} → free")
else:
    print("  No account yet — will register")

# ── 1. Register / Login ───────────────────────────────────────
step("1. Register or login")
if not existing:
    r = requests.post(f"{BACKEND}/auth/register", json={
        "email": TEST_EMAIL, "password": TEST_PASSWORD,
        "role": "founder", "invite_code": "founder",
        "invite_secret": INVITE_SEC, "email_opt_in": True,
    })
    assert_ok("register 200", r.status_code == 200, r.status_code)
else:
    print("  Account exists — logging in")

step("2. Login → JWT")
r = requests.post(f"{BACKEND}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
assert_ok("login 200", r.status_code == 200, r.status_code)
token = r.json()["token"]
print(f"  Token: {token[:40]}...")

# ── 3. Subscribe annual ───────────────────────────────────────
step("3. POST /commerce/subscribe (founder_pro / ANNUAL / ZAR)")
r = requests.post(f"{BACKEND}/commerce/subscribe",
    headers={"Authorization": f"Bearer {token}"},
    json={"tier": "founder_pro", "billing": "annual", "currency": "ZAR"})
assert_ok("subscribe 200", r.status_code == 200, r.status_code)

hosted_url  = r.json()["hosted_url"]
access_code = hosted_url.rstrip("/").split("/")[-1]
assert_ok("access_code present", bool(access_code), access_code)
print(f"  Access code: {access_code}")

# ── 4. Charge test card (annual = 339999 kobo = R3399.99) ─────
step("4. Charge test card — R3 399.99 (annual)")
r = requests.post("https://api.paystack.co/charge", headers=PS_HEADERS, json={
    "email": TEST_EMAIL, "amount": 339999, "access_code": access_code,
    "card": {"number": "4084084084084081", "cvv": "408",
             "expiry_month": "01", "expiry_year": "2029"},
})
data = r.json().get("data", {})
assert_ok("charge success", data.get("status") == "success", data.get("status"))
reference = data["reference"]
print(f"  Reference: {reference}")

# ── 5. Verify + replay webhook ────────────────────────────────
step("5. Verify + replay as signed webhook")
user_id = db(f"SELECT id FROM users WHERE email='{TEST_EMAIL}'").strip()
assert_ok("user_id in DB", bool(user_id), user_id)

time.sleep(2)
r = requests.get(f"https://api.paystack.co/transaction/verify/{reference}", headers=PS_HEADERS)
assert_ok("verify success", r.json().get("data", {}).get("status") == "success")
tx_data = r.json()["data"]

tx_data["metadata"] = {
    "user_id": user_id,
    "tier": "founder_pro",
    "billing": "annual",
    "currency": "ZAR",
}

payload = json.dumps({"event": "charge.success", "data": tx_data}, separators=(",", ":"))
sig     = hmac.new(PS_SECRET.encode(), payload.encode(), hashlib.sha512).hexdigest()
req     = urllib.request.Request(
    f"{BACKEND}/commerce/webhook", data=payload.encode(),
    headers={"Content-Type": "application/json", "x-paystack-signature": sig},
    method="POST")
try:
    with urllib.request.urlopen(req) as resp:
        assert_ok("webhook 200", resp.status == 200, resp.status)
except urllib.error.HTTPError as e:
    assert_ok("webhook 200", False, f"{e.code}: {e.read().decode()}")

# ── 6. Assert DB state ────────────────────────────────────────
step("6. Assert DB state")
time.sleep(2)
row = db(f"""
    SELECT subscription_plan, subscription_tier, subscription_status,
           is_pro::text, subscription_period_end
    FROM users WHERE email='{TEST_EMAIL}'
""")
print(f"  {row}")
assert_ok("subscription_plan = pro",      "pro"    in row)
assert_ok("subscription_tier = annual",   "annual" in row)
assert_ok("subscription_status = active", "active" in row)
assert_ok("is_pro = true",               "t"      in row)

# Period end should be ~365 days from now (allow ±2 days)
import datetime
period_end_str = db(f"SELECT subscription_period_end::date FROM users WHERE email='{TEST_EMAIL}'").strip()
period_end = datetime.date.fromisoformat(period_end_str)
days_out = (period_end - datetime.date.today()).days
assert_ok(f"period_end ~365 days out (got {days_out})", 360 <= days_out <= 370, str(period_end))

inv = db(f"""
    SELECT tier, amount::text, reference FROM subscription_invoices
    WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')
    ORDER BY created_at DESC LIMIT 1
""")
print(f"  Invoice: {inv}")
assert_ok("invoice tier = founder_pro",   "founder_pro" in inv)
assert_ok("invoice amount = 3399.99",     "3399.99"     in inv)
assert_ok("invoice reference matches",    reference     in inv)

# ── 7. Assert Resend email ────────────────────────────────────
step("7. Assert confirmation email via Resend")
r = requests.get("https://api.resend.com/emails?limit=20",
    headers={"Authorization": f"Bearer {RESEND_KEY}"})
emails = [e for e in r.json().get("data", []) if TEST_EMAIL in str(e.get("to", ""))]
sub_email = next((e for e in emails
    if "subscription is active" in e.get("subject", "").lower()), None)
assert_ok("'subscription is active' email delivered",
          sub_email and sub_email["last_event"] == "delivered",
          sub_email["subject"] if sub_email else "not found")

print(f"\n{'='*60}")
print("  ALL ASSERTIONS PASSED — annual billing verified ✓")
print(f"{'='*60}\n")
