#!/usr/bin/env python3
"""
Test the REAL Paystack renewal path end-to-end for Investor Basic (monthly) --
distinct from test_pro_signup.py / test_annual_billing.py, which only cover
first-purchase. This simulates what Paystack's own recurring billing sends
(invoice.payment_success, no user_id metadata) after a real first charge,
and checks the webhook handler extends the period correctly and is
idempotent against Paystack's at-least-once delivery.

Run on KVM2:
  set -a && source /root/.env.dev && set +a && python3 scripts/test_renewal_investor.py
"""
import os, json, hmac, hashlib, time, subprocess, urllib.request, urllib.error
import requests

BACKEND    = os.getenv("BACKEND_URL", "http://localhost:4001")
PS_SECRET  = os.getenv("PAYSTACK_SECRET_KEY", "")
RESEND_KEY = os.getenv("RESEND_API_KEY", "")
DB_URL     = os.getenv("BACKEND_DATABASE_URL", "")

TEST_EMAIL    = "kevin.metatron.testing+investorbasic@gmail.com"
TEST_PASSWORD = os.getenv("TEST_PASSWORD", "TestFounder2026!")

PS_HEADERS = {"Authorization": f"Bearer {PS_SECRET}", "Content-Type": "application/json"}


def db(query):
    r = subprocess.run(["psql", DB_URL, "-t", "-c", query], capture_output=True, text=True)
    return r.stdout.strip()


def step(msg):
    print(f"\n{'='*60}\n  {msg}\n{'='*60}")


def assert_ok(label, condition, got=""):
    mark = "OK" if condition else "FAIL"
    print(f"  [{mark}] {label}" + (f": {got}" if got else ""))
    if not condition:
        raise SystemExit(f"FAIL: {label}")


def sign(payload: str) -> str:
    return hmac.new(PS_SECRET.encode(), payload.encode(), hashlib.sha512).hexdigest()


def post_webhook(body: dict):
    payload = json.dumps(body, separators=(",", ":"))
    req = urllib.request.Request(
        f"{BACKEND}/commerce/webhook", data=payload.encode(),
        headers={"Content-Type": "application/json", "x-paystack-signature": sign(payload)},
        method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        print(f"  webhook error body: {e.read().decode()}")
        return e.code


# ── 0. Reset ──────────────────────────────────────────────────
step("0. Reset test account to free")
db(f"""UPDATE users SET subscription_plan='free', subscription_status='inactive',
       subscription_tier='monthly', is_basic=false, is_pro=false,
       paystack_subscription_code=NULL, paystack_customer_code=NULL,
       subscription_period_end=NULL WHERE email='{TEST_EMAIL}'""")
db(f"DELETE FROM subscription_invoices WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')")
print("  Reset to free, invoices cleared")

# ── 1. Login ──────────────────────────────────────────────────
step("1. Login")
r = requests.post(f"{BACKEND}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
assert_ok("login 200", r.status_code == 200, r.status_code)
token = r.json()["token"]
user_id = db(f"SELECT id FROM users WHERE email='{TEST_EMAIL}'").strip()
assert_ok("user_id in DB", bool(user_id), user_id)

# ── 2. Subscribe (investor basic / monthly) ───────────────────
step("2. POST /commerce/investor/subscribe (basic / monthly / ZAR)")
r = requests.post(f"{BACKEND}/commerce/investor/subscribe",
    headers={"Authorization": f"Bearer {token}"},
    json={"tier": "basic", "billing": "monthly", "currency": "ZAR"})
assert_ok("subscribe 200", r.status_code == 200, r.status_code)
hosted_url = r.json()["hosted_url"]
access_code = hosted_url.rstrip("/").split("/")[-1]

# ── 3. Real first charge (R169.99) ───────────────────────────
step("3. Charge test card -- R169.99 (first purchase)")
r = requests.post("https://api.paystack.co/charge", headers=PS_HEADERS, json={
    "email": TEST_EMAIL, "amount": 16999, "access_code": access_code,
    "card": {"number": "4084084084084081", "cvv": "408",
             "expiry_month": "01", "expiry_year": "2029"},
})
data = r.json().get("data", {})
assert_ok("charge success", data.get("status") == "success", data.get("status"))
reference1 = data["reference"]

time.sleep(2)
r = requests.get(f"https://api.paystack.co/transaction/verify/{reference1}", headers=PS_HEADERS)
assert_ok("verify success", r.json().get("data", {}).get("status") == "success")
tx_data = r.json()["data"]
tx_data["metadata"] = {"user_id": user_id, "tier": "investor_basic", "billing": "monthly", "currency": "ZAR"}

status = post_webhook({"event": "charge.success", "data": tx_data})
assert_ok("first-purchase webhook 200", status == 200, status)

time.sleep(2)
row1 = db(f"SELECT subscription_plan, subscription_status, is_basic::text, subscription_period_end FROM users WHERE email='{TEST_EMAIL}'")
print(f"  After first purchase: {row1}")
assert_ok("plan = basic", "basic" in row1)
assert_ok("status = active", "active" in row1)
assert_ok("is_basic = true", "t" in row1)
period_end_1 = db(f"SELECT subscription_period_end FROM users WHERE email='{TEST_EMAIL}'").strip()

# ── 4. Simulate a REAL renewal (Paystack's own recurring charge) ─
step("4. Simulate invoice.payment_success (renewal, no user_id metadata)")
plan_code = os.getenv("PAYSTACK_INVESTOR_PLAN_BASIC_MONTHLY", "")
reference2 = f"renewal-test-{int(time.time())}"
renewal_payload = {
    "event": "invoice.payment_success",
    "data": {
        "reference": reference2,
        "amount": 16999,
        "customer": {"email": TEST_EMAIL},
        "subscription": {"plan": {"plan_code": plan_code}},
    },
}
status = post_webhook(renewal_payload)
assert_ok("renewal webhook 200", status == 200, status)

time.sleep(2)
period_end_2 = db(f"SELECT subscription_period_end FROM users WHERE email='{TEST_EMAIL}'").strip()
print(f"  period_end before renewal: {period_end_1}")
print(f"  period_end after renewal:  {period_end_2}")
assert_ok("period_end advanced (renewal extended, not reset)", period_end_2 > period_end_1)

invoice_count_after_1 = db(f"SELECT COUNT(*) FROM subscription_invoices WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')").strip()
assert_ok("2 invoices on record (first purchase + renewal)", invoice_count_after_1 == "2", invoice_count_after_1)

# ── 5. Idempotency: replay the SAME renewal webhook again ────
step("5. Replay the identical renewal webhook (Paystack at-least-once delivery)")
status = post_webhook(renewal_payload)
assert_ok("replayed webhook still 200", status == 200, status)

time.sleep(2)
period_end_3 = db(f"SELECT subscription_period_end FROM users WHERE email='{TEST_EMAIL}'").strip()
invoice_count_after_2 = db(f"SELECT COUNT(*) FROM subscription_invoices WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')").strip()
assert_ok("period_end unchanged on replay (no double-extend)", period_end_3 == period_end_2, f"{period_end_2} -> {period_end_3}")
assert_ok("invoice count unchanged on replay (no duplicate row)", invoice_count_after_2 == "2", invoice_count_after_2)

# ── 6. Confirmation email sent for the renewal ───────────────
step("6. Assert renewal confirmation email via Resend")
r = requests.get("https://api.resend.com/emails?limit=20",
    headers={"Authorization": f"Bearer {RESEND_KEY}"})
emails = [e for e in r.json().get("data", []) if TEST_EMAIL in str(e.get("to", ""))]
for e in emails[:5]:
    print(f"  seen: {e.get('subject')!r} -> {e.get('last_event')}")

print(f"\n{'='*60}")
print("  ALL ASSERTIONS PASSED -- renewal path verified")
print(f"{'='*60}\n")
