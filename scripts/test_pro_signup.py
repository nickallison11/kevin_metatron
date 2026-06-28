#!/usr/bin/env python3
"""
End-to-end test of the full Founder Pro signup flow.

Registers a new STARTUP account, subscribes via our /commerce/subscribe
endpoint (which embeds user_id + tier in Paystack metadata), charges with
the Paystack test card, replays the verified transaction as a signed webhook
(charge_authorization doesn't always auto-fire in sandbox), then asserts
DB state and Resend confirmation email.

Run on KVM2 where localhost:4000 and psql are reachable:
  python3 scripts/test_pro_signup.py

Required env vars (sourced from /root/.env on KVM2):
  PAYSTACK_SECRET_KEY, RESEND_API_KEY, INVITE_SECRET,
  BACKEND_DATABASE_URL  (or defaults to postgresql://metatron:metatron@localhost:5432/metatron)
"""

import os, json, hmac, hashlib, time, subprocess, urllib.request, urllib.error
import requests

BACKEND      = os.getenv("BACKEND_URL", "http://localhost:4000")
PS_SECRET    = os.getenv("PAYSTACK_SECRET_KEY", "")
RESEND_KEY   = os.getenv("RESEND_API_KEY", "")
INVITE_SEC   = os.getenv("INVITE_SECRET", "")
DB_URL       = os.getenv("BACKEND_DATABASE_URL", "postgresql://metatron:metatron@localhost:5432/metatron")

TEST_EMAIL    = "kevin.metatron.testing+founderpro2@gmail.com"
TEST_PASSWORD = os.getenv("TEST_PASSWORD", "TestFounder2026!")

PS_HEADERS = {
    "Authorization": f"Bearer {PS_SECRET}",
    "Content-Type": "application/json",
}

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

# ── 1. Register ───────────────────────────────────────────────
step("1. Register new Founder Pro test account")
r = requests.post(f"{BACKEND}/auth/register", json={
    "email": TEST_EMAIL, "password": TEST_PASSWORD,
    "role": "founder", "invite_code": "founder",
    "invite_secret": INVITE_SEC, "email_opt_in": True,
})
if r.status_code == 409:
    print("  Account already exists — logging in")
else:
    assert_ok("register 200", r.status_code == 200, r.status_code)

# ── 2. Login ──────────────────────────────────────────────────
step("2. Login → JWT")
r = requests.post(f"{BACKEND}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
assert_ok("login 200", r.status_code == 200, r.status_code)
token = r.json()["token"]
print(f"  Token: {token[:40]}...")

# ── 3. Subscribe via our endpoint ────────────────────────────
step("3. POST /commerce/subscribe (founder_pro / monthly / ZAR)")
r = requests.post(f"{BACKEND}/commerce/subscribe",
    headers={"Authorization": f"Bearer {token}"},
    json={"tier": "founder_pro", "billing": "monthly", "currency": "ZAR"})
assert_ok("subscribe 200", r.status_code == 200, r.status_code)

hosted_url  = r.json()["hosted_url"]
access_code = hosted_url.rstrip("/").split("/")[-1]
assert_ok("access_code present", bool(access_code), access_code)
print(f"  Access code: {access_code}")

# ── 4. Charge test card ───────────────────────────────────────
step("4. Charge test card via Paystack /charge")
r = requests.post("https://api.paystack.co/charge", headers=PS_HEADERS, json={
    "email": TEST_EMAIL, "amount": 33999, "access_code": access_code,
    "card": {"number": "4084084084084081", "cvv": "408",
             "expiry_month": "01", "expiry_year": "2029"},
})
data = r.json().get("data", {})
assert_ok("charge success", data.get("status") == "success", data.get("status"))
reference = data["reference"]
auth_code = data["authorization"]["authorization_code"]
print(f"  Reference:  {reference}")
print(f"  Auth code:  {auth_code}")

# ── 5. charge_authorization with full metadata ───────────────
step("5. charge_authorization with user_id metadata + plan")
user_id = db(f"SELECT id FROM users WHERE email='{TEST_EMAIL}'").strip()
assert_ok("user_id in DB", bool(user_id), user_id)

r = requests.post("https://api.paystack.co/transaction/charge_authorization",
    headers=PS_HEADERS, json={
        "email": TEST_EMAIL, "amount": 33999,
        "authorization_code": auth_code, "currency": "ZAR",
        "plan": os.getenv("PAYSTACK_PLAN_PRO_MONTHLY", "PLN_rh68695vinb64mr"),
        "metadata": {"user_id": user_id, "tier": "founder_pro",
                     "billing": "monthly", "currency": "ZAR"},
    })
ca_data = r.json().get("data", {})
assert_ok("charge_auth success", ca_data.get("status") == "success", ca_data.get("status"))
ca_ref = ca_data["reference"]
print(f"  Reference: {ca_ref}")

# ── 6. Verify + replay webhook ────────────────────────────────
step("6. Verify transaction + replay as signed webhook")
time.sleep(3)
r = requests.get(f"https://api.paystack.co/transaction/verify/{ca_ref}", headers=PS_HEADERS)
assert_ok("verify success", r.json().get("data", {}).get("status") == "success")
tx_data = r.json()["data"]
assert_ok("metadata.user_id present",
          tx_data.get("metadata", {}).get("user_id") == user_id)

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

# ── 7. Assert DB state ────────────────────────────────────────
step("7. Assert DB state")
time.sleep(2)
row = db(f"""
    SELECT subscription_plan, subscription_status, is_pro::text, subscription_period_end
    FROM users WHERE email='{TEST_EMAIL}'
""")
print(f"  {row}")
assert_ok("subscription_plan = pro",   "pro"    in row)
assert_ok("subscription_status = active", "active" in row)
assert_ok("is_pro = true",             "t"      in row)

inv = db(f"""
    SELECT tier, amount::text, reference FROM subscription_invoices
    WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')
    ORDER BY created_at DESC LIMIT 1
""")
print(f"  Invoice: {inv}")
assert_ok("invoice tier = founder_pro", "founder_pro" in inv)
assert_ok("invoice reference matches",  ca_ref in inv)

# ── 8. Assert Resend email ────────────────────────────────────
step("8. Assert confirmation email via Resend")
r = requests.get("https://api.resend.com/emails?limit=20",
    headers={"Authorization": f"Bearer {RESEND_KEY}"})
emails = [e for e in r.json().get("data", []) if TEST_EMAIL in str(e.get("to", ""))]
sub_email = next((e for e in emails if "subscription is active" in e.get("subject","").lower()), None)
assert_ok("'subscription is active' email delivered",
          sub_email and sub_email["last_event"] == "delivered",
          sub_email["subject"] if sub_email else "not found")

print(f"\n{'='*60}")
print("  ALL ASSERTIONS PASSED — full Pro signup flow verified ✓")
print(f"{'='*60}\n")
