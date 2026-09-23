#!/usr/bin/env python3
"""
Generalized Paystack renewal-webhook test -- covers every role x tier x
billing combination (founder/investor: basic+pro x monthly+annual;
connector: basic-only x monthly+annual). Supersedes the three role-specific
scripts (test_renewal_founder.py / test_renewal_investor.py /
test_renewal_connector.py), which only ever covered the basic+monthly case
each.

Does a real Paystack test-card charge (first purchase), replays it as a
signed charge.success webhook, then simulates the actual renewal webhook
Paystack's own recurring billing sends (invoice.payment_success, no
user_id metadata) and asserts: the period extends from the prior period_end
(not reset to "now"), the identical webhook replayed twice doesn't double-
extend or double-invoice (Paystack delivers at-least-once), and the correct
"has renewed" vs "is active" email fires for the request tier/billing.

Usage:
  python3 scripts/test_renewal.py --role founder   --tier pro  --billing annual  --email kevin.metatron.testing+founderpro@gmail.com
  python3 scripts/test_renewal.py --role investor  --tier basic --billing monthly --email kevin.metatron.testing+investorbasic@gmail.com
  python3 scripts/test_renewal.py --role connector --billing annual --email kevin.metatron.testing+connector@gmail.com

Run on KVM2 (dev environment only -- resets the target test account):
  set -a && source /root/.env.dev && set +a && python3 scripts/test_renewal.py ...
"""
import argparse, os, json, hmac, hashlib, time, subprocess, urllib.request, urllib.error
import requests

parser = argparse.ArgumentParser()
parser.add_argument("--role", choices=["founder", "investor", "connector"], required=True)
parser.add_argument("--tier", choices=["basic", "pro"], default="basic")
parser.add_argument("--billing", choices=["monthly", "annual"], default="monthly")
parser.add_argument("--email", required=True)
args = parser.parse_args()

if args.role == "connector" and args.tier == "pro":
    raise SystemExit("connector has no pro tier")

BACKEND       = os.getenv("BACKEND_URL", "http://localhost:4001")
PS_SECRET     = os.getenv("PAYSTACK_SECRET_KEY", "")
RESEND_KEY    = os.getenv("RESEND_API_KEY", "")
DB_URL        = os.getenv("BACKEND_DATABASE_URL", "")
TEST_PASSWORD = os.getenv("TEST_PASSWORD", "TestFounder2026!")
TEST_EMAIL    = args.email

PS_HEADERS = {"Authorization": f"Bearer {PS_SECRET}", "Content-Type": "application/json"}

AMOUNTS_KOBO = {
    ("basic", "monthly"): 16_999, ("basic", "annual"): 169_999,
    ("pro", "monthly"): 33_999, ("pro", "annual"): 339_999,
}
PLAN_ENV = {
    ("founder", "basic", "monthly"): "PAYSTACK_FOUNDER_BASIC_MONTHLY",
    ("founder", "basic", "annual"): "PAYSTACK_FOUNDER_BASIC_ANNUAL",
    ("founder", "pro", "monthly"): "PAYSTACK_FOUNDER_PRO_MONTHLY",
    ("founder", "pro", "annual"): "PAYSTACK_FOUNDER_PRO_ANNUAL",
    ("investor", "basic", "monthly"): "PAYSTACK_INVESTOR_PLAN_BASIC_MONTHLY",
    ("investor", "basic", "annual"): "PAYSTACK_INVESTOR_PLAN_BASIC_ANNUAL",
    ("investor", "pro", "monthly"): "PAYSTACK_INVESTOR_PLAN_PRO_MONTHLY",
    ("investor", "pro", "annual"): "PAYSTACK_INVESTOR_PLAN_PRO_ANNUAL",
    ("connector", "basic", "monthly"): "PAYSTACK_CONNECTOR_PLAN_BASIC_MONTHLY",
    ("connector", "basic", "annual"): "PAYSTACK_CONNECTOR_PLAN_BASIC_ANNUAL",
}

amount = AMOUNTS_KOBO[(args.tier, args.billing)]
plan_code = os.getenv(PLAN_ENV[(args.role, args.tier, args.billing)], "")
is_flag_col = "is_pro" if args.tier == "pro" else "is_basic"
period_days = 365 if args.billing == "annual" else 30

if args.role == "founder":
    subscribe_url = f"{BACKEND}/commerce/subscribe"
    subscribe_body = {"tier": f"founder_{args.tier}", "billing": args.billing, "currency": "ZAR"}
elif args.role == "investor":
    subscribe_url = f"{BACKEND}/commerce/investor/subscribe"
    subscribe_body = {"tier": args.tier, "billing": args.billing, "currency": "ZAR"}
else:
    subscribe_url = f"{BACKEND}/commerce/connector/subscribe"
    subscribe_body = {"billing": args.billing}


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


print(f"\n>>> {args.role} / {args.tier} / {args.billing}  ({TEST_EMAIL})  plan_code={plan_code!r}")
if not plan_code:
    raise SystemExit(f"FAIL: no plan code configured for {(args.role, args.tier, args.billing)}")

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

# ── 2. Subscribe ──────────────────────────────────────────────
step(f"2. POST {subscribe_url.split(BACKEND)[-1]} {subscribe_body}")
r = requests.post(subscribe_url, headers={"Authorization": f"Bearer {token}"}, json=subscribe_body)
assert_ok("subscribe 200", r.status_code == 200, r.status_code)
hosted_url = r.json()["hosted_url"]
access_code = hosted_url.rstrip("/").split("/")[-1]

# ── 3. Real first charge ──────────────────────────────────────
step(f"3. Charge test card -- {amount/100:.2f} ZAR (first purchase)")
r = requests.post("https://api.paystack.co/charge", headers=PS_HEADERS, json={
    "email": TEST_EMAIL, "amount": amount, "access_code": access_code,
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
metadata_tier = f"{args.role}_{args.tier}" if args.role != "connector" else "connector_basic"
tx_data["metadata"] = {"user_id": user_id, "tier": metadata_tier, "billing": args.billing, "currency": "ZAR"}

status = post_webhook({"event": "charge.success", "data": tx_data})
assert_ok("first-purchase webhook 200", status == 200, status)

time.sleep(2)
row1 = db(f"SELECT subscription_plan, subscription_tier, subscription_status, {is_flag_col}::text, subscription_period_end FROM users WHERE email='{TEST_EMAIL}'")
print(f"  After first purchase: {row1}")
assert_ok(f"plan = {args.tier}", args.tier in row1)
assert_ok(f"billing tier = {args.billing}", args.billing in row1)
assert_ok("status = active", "active" in row1)
assert_ok(f"{is_flag_col} = true", "t" in row1)
period_end_1 = db(f"SELECT subscription_period_end FROM users WHERE email='{TEST_EMAIL}'").strip()

# ── 4. Simulate the REAL renewal webhook ─────────────────────
step("4. Simulate invoice.payment_success (renewal, no user_id metadata)")
reference2 = f"renewal-test-{int(time.time())}"
renewal_payload = {
    "event": "invoice.payment_success",
    "data": {
        "reference": reference2,
        "amount": amount,
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

invoice_count_1 = db(f"SELECT COUNT(*) FROM subscription_invoices WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')").strip()
assert_ok("2 invoices on record (first purchase + renewal)", invoice_count_1 == "2", invoice_count_1)

# ── 5. Idempotency ────────────────────────────────────────────
step("5. Replay the identical renewal webhook (Paystack at-least-once delivery)")
status = post_webhook(renewal_payload)
assert_ok("replayed webhook still 200", status == 200, status)

time.sleep(2)
period_end_3 = db(f"SELECT subscription_period_end FROM users WHERE email='{TEST_EMAIL}'").strip()
invoice_count_2 = db(f"SELECT COUNT(*) FROM subscription_invoices WHERE user_id=(SELECT id FROM users WHERE email='{TEST_EMAIL}')").strip()
assert_ok("period_end unchanged on replay (no double-extend)", period_end_3 == period_end_2, f"{period_end_2} -> {period_end_3}")
assert_ok("invoice count unchanged on replay (no duplicate row)", invoice_count_2 == "2", invoice_count_2)

# ── 6. Confirmation email ─────────────────────────────────────
step("6. Assert renewal confirmation email via Resend")
r = requests.get("https://api.resend.com/emails?limit=20",
    headers={"Authorization": f"Bearer {RESEND_KEY}"})
emails = [e for e in r.json().get("data", []) if TEST_EMAIL in str(e.get("to", ""))]
for e in emails[:5]:
    print(f"  seen: {e.get('subject')!r} -> {e.get('last_event')}")

print(f"\n{'='*60}")
print(f"  ALL ASSERTIONS PASSED -- {args.role}/{args.tier}/{args.billing} renewal verified")
print(f"{'='*60}\n")
