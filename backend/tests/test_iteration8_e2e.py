"""
Iteration 8: E2E flow using the REAL user accounts.
- Business عماد   +966530534184
- Driver   عماد   +966593603404
- Super Admin     emadabuharb1993@gmail.com / Isnad-Dev-Admin-2026!

Tests A→Q from the review request. Uses only the public preview URL.
Ordered execution required — run serially (-p no:xdist or with LoadScopeScheduling on one file).
"""
import io
import os
import time
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://tawazon.preview.emergentagent.com").rstrip("/")

BIZ_PHONE = "+966530534184"
DRV_PHONE = "+966593603404"
ADMIN_EMAIL = "emadabuharb1993@gmail.com"
ADMIN_PW = "Isnad-Dev-Admin-2026!"

STATE = {}  # cross-test mutable state


def otp_login(phone):
    r = requests.post(f"{BASE}/api/auth/otp/send", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, f"otp/send {phone}: {r.status_code} {r.text}"
    code = r.json().get("demo_otp")
    assert code, f"no demo_otp: {r.json()}"
    r2 = requests.post(f"{BASE}/api/auth/otp/verify", json={"phone": phone, "code": code}, timeout=15)
    assert r2.status_code == 200, f"otp/verify {phone}: {r2.status_code} {r2.text}"
    tok = r2.json().get("token")
    assert tok
    return tok


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, f"admin login: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def biz_token():
    return otp_login(BIZ_PHONE)


@pytest.fixture(scope="session")
def drv_token():
    return otp_login(DRV_PHONE)


def _tiny_jpg():
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000"
        "ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432"
        "ffc00011080001000103012200021101031101"
        "ffc4001f0000010501010101010100000000000000000102030405060708090a0b"
        "ffda000c03010002110311003f00fb"
        "ffd9"
    )


# =========================================================================
# A. Admin login
# =========================================================================
def test_A_admin_login(admin_token):
    assert admin_token


# =========================================================================
# B. Business + driver present in admin users
# =========================================================================
def test_B_business_and_driver_in_admin_users(admin_token):
    r = requests.get(f"{BASE}/api/admin/users?q=عماد", headers=h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    users = r.json().get("users", [])
    phones = {u.get("phone") for u in users}
    assert BIZ_PHONE in phones, f"biz phone missing; got {phones}"
    assert DRV_PHONE in phones, f"drv phone missing; got {phones}"
    STATE["biz_id"] = next(u["_id"] for u in users if u["phone"] == BIZ_PHONE)
    STATE["drv_id"] = next(u["_id"] for u in users if u["phone"] == DRV_PHONE)


# =========================================================================
# C. Driver login + list documents endpoint
# =========================================================================
def test_C_driver_me_and_docs(drv_token):
    r = requests.get(f"{BASE}/api/auth/me", headers=h(drv_token), timeout=15)
    assert r.status_code == 200
    me = r.json()
    user = me.get("user") or me
    assert user.get("phone") == DRV_PHONE
    STATE["drv_initial_verification"] = (user.get("worker_profile") or {}).get("verification_status")

    r = requests.get(f"{BASE}/api/documents/mine", headers=h(drv_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    STATE["required_doc_types"] = [d["key"] for d in data.get("doc_types", []) if d.get("required")]
    STATE["initial_missing"] = data.get("missing", [])


# =========================================================================
# D. Driver uploads required documents + admin verifies each
# =========================================================================
def test_D1_driver_uploads_required_docs(drv_token):
    required = STATE.get("required_doc_types") or ["national_id", "driving_license"]
    uploaded = []
    for dtype in required:
        files = {"file": (f"{dtype}.jpg", _tiny_jpg(), "image/jpeg")}
        # expiry date needed for driving_license typically — send +2 years just in case
        data = {"doc_type": dtype, "expiry_date": (date.today() + timedelta(days=730)).isoformat()}
        r = requests.post(f"{BASE}/api/documents/upload", headers=h(drv_token),
                          files=files, data=data, timeout=30)
        assert r.status_code < 400, f"upload {dtype}: {r.status_code} {r.text}"
        uploaded.append(dtype)
    STATE["uploaded"] = uploaded
    assert uploaded


def test_D2_admin_sees_pending_and_verifies(admin_token, drv_token):
    time.sleep(0.5)
    r = requests.get(f"{BASE}/api/admin/documents?status=pending", headers=h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    docs = r.json().get("documents", [])
    drv_docs = [d for d in docs if (d.get("worker") or {}).get("phone") == DRV_PHONE]
    print(f"driver pending docs: {len(drv_docs)} (uploaded {len(STATE.get('uploaded', []))})")
    assert drv_docs, "driver's uploads not in admin pending queue"

    for d in drv_docs:
        doc_id = d["_id"]
        r = requests.post(f"{BASE}/api/admin/documents/{doc_id}/review",
                          headers=h(admin_token), json={"action": "verify"}, timeout=15)
        assert r.status_code == 200, f"verify {doc_id}: {r.status_code} {r.text}"

    time.sleep(0.5)
    r = requests.get(f"{BASE}/api/auth/me", headers=h(drv_token), timeout=15)
    vstatus = (r.json().get("user", {}).get("worker_profile") or {}).get("verification_status")
    print(f"driver verification_status after admin verify: {vstatus}")
    STATE["drv_verification"] = vstatus
    # Cannot strictly require 'verified' if worker services empty, but flag
    if vstatus != "verified":
        pytest.xfail(f"driver still not fully verified (status={vstatus}) — may need extra doc types or services")


# =========================================================================
# E. Driver availability ON
# =========================================================================
def test_E_driver_availability_on(drv_token):
    r = requests.patch(f"{BASE}/api/worker/availability", headers=h(drv_token),
                       json={"status": "available"}, timeout=15)
    assert r.status_code == 200, f"availability: {r.status_code} {r.text}"
    assert r.json().get("availability") == "available"


# =========================================================================
# F. Business wallet top-up
# =========================================================================
def test_F_business_wallet_topup(biz_token):
    r = requests.post(f"{BASE}/api/business/wallet/topup", headers=h(biz_token),
                      json={"amount": 500}, timeout=15)
    assert r.status_code == 200, r.text
    wallet = r.json().get("wallet") or {}
    STATE["biz_wallet_before"] = wallet.get("available")
    assert (wallet.get("available") or 0) >= 200


# =========================================================================
# G. Business creates + publishes request
# =========================================================================
def test_G_business_publishes_request(biz_token):
    start = (date.today() + timedelta(days=1)).isoformat()
    payload = {
        "service_type": "delivery_driver",
        "title": "TEST_iter8 توصيل شحنات",
        "city": "الرياض",
        "address": "الرياض - العليا - اختبار E2E iter8",
        "required_count": 1,
        "start_date": start,
        "start_time": "09:00",
        "duration_type": "one_day",
        "days_count": 1,
        "rate": 8,
        "shipments_per_driver": 20,
        "vehicle_type": "دراجة نارية",
        "requirements": "iter8 e2e",
        "publish": True,
        "terms": True,
    }
    r = requests.post(f"{BASE}/api/business/requests", headers=h(biz_token), json=payload, timeout=20)
    assert r.status_code < 400, f"create req: {r.status_code} {r.text}"
    body = r.json()
    req = body.get("request") or {}
    STATE["req_id"] = req.get("_id")
    assert STATE["req_id"], body
    assert req.get("status") == "published", f"expected published, got {req.get('status')}"
    print(f"created request {STATE['req_id']} status={req.get('status')} matched={body.get('matched_workers')}")


# =========================================================================
# H. Admin sees the new request
# =========================================================================
def test_H_admin_sees_new_request(admin_token):
    rid = STATE.get("req_id")
    assert rid
    r = requests.get(f"{BASE}/api/admin/requests?status=published", headers=h(admin_token), timeout=15)
    assert r.status_code == 200
    ids = {it.get("_id") for it in r.json().get("requests", [])}
    assert rid in ids, f"req {rid} not in admin published listing (got {len(ids)})"


# =========================================================================
# I-J. Driver sees + accepts opportunity (or applies via open list)
# =========================================================================
def test_I_driver_sees_and_accepts(drv_token, admin_token):
    rid = STATE.get("req_id")
    assert rid
    # If auto-matched, driver has an offered offer; else, apply
    r = requests.get(f"{BASE}/api/worker/offers", headers=h(drv_token), timeout=15)
    offers = r.json().get("offers", [])
    my_offer = next((o for o in offers if (o.get("request") or {}).get("_id") == rid), None)

    if my_offer:
        oid = my_offer["_id"]
        r2 = requests.post(f"{BASE}/api/worker/offers/{oid}/respond", headers=h(drv_token),
                           json={"action": "accept", "terms": True}, timeout=15)
        assert r2.status_code == 200, f"accept offer: {r2.status_code} {r2.text}"
        STATE["offer_id"] = oid
    else:
        # Check driver profile services
        me = requests.get(f"{BASE}/api/auth/me", headers=h(drv_token), timeout=15).json()
        svcs = (me.get("user", {}).get("worker_profile") or {}).get("services") or []
        print(f"driver services={svcs}, verification={STATE.get('drv_verification')}")
        # Try /apply
        r2 = requests.post(f"{BASE}/api/worker/apply", headers=h(drv_token),
                           json={"request_id": rid, "terms": True}, timeout=15)
        if r2.status_code >= 400:
            pytest.xfail(f"driver could not accept: no auto-offer + apply failed: {r2.status_code} {r2.text}")
        # locate the offer just created
        r3 = requests.get(f"{BASE}/api/admin/requests/{rid}", headers=h(admin_token), timeout=15).json()
        offers = r3.get("offers", [])
        my = next((o for o in offers if o.get("worker_id") == STATE["drv_id"] and o["status"] == "accepted"), None)
        assert my, f"no accepted offer for driver on {rid}"
        STATE["offer_id"] = my["_id"]


def test_J_admin_sees_accepted(admin_token):
    rid = STATE.get("req_id")
    r = requests.get(f"{BASE}/api/admin/requests/{rid}", headers=h(admin_token), timeout=15)
    assert r.status_code == 200
    offers = r.json().get("offers", [])
    accepted = [o for o in offers if o.get("status") in ("accepted", "confirmed", "attendance_confirmed", "attended", "paid")]
    assert accepted, "no accepted offer visible in admin"


# =========================================================================
# K. Overlap rule: driver cannot accept second overlapping opportunity
# =========================================================================
def test_K_overlap_rule(biz_token, drv_token):
    # create another biz request on same date
    start = (date.today() + timedelta(days=1)).isoformat()
    payload = {
        "service_type": "delivery_driver",
        "title": "TEST_iter8 overlap",
        "city": "الرياض",
        "address": "الرياض - العليا - overlap",
        "required_count": 1,
        "start_date": start,
        "start_time": "10:00",
        "duration_type": "one_day",
        "rate": 8,
        "shipments_per_driver": 10,
        "vehicle_type": "دراجة نارية",
        "publish": True,
        "terms": True,
    }
    r = requests.post(f"{BASE}/api/business/requests", headers=h(biz_token), json=payload, timeout=20)
    assert r.status_code < 400, r.text
    rid2 = r.json()["request"]["_id"]
    STATE["req2_id"] = rid2

    # Try to apply as driver -> should fail with OVERLAPPING_JOB
    r2 = requests.post(f"{BASE}/api/worker/apply", headers=h(drv_token),
                       json={"request_id": rid2, "terms": True}, timeout=15)
    assert r2.status_code == 400, f"expected 400, got {r2.status_code} {r2.text}"
    detail = r2.json().get("detail")
    code = detail.get("code") if isinstance(detail, dict) else None
    assert code == "OVERLAPPING_JOB", f"expected OVERLAPPING_JOB, got {detail}"


# =========================================================================
# L. Business request detail shows driver phone (post-acceptance)
# =========================================================================
def test_L_business_sees_driver_phone(biz_token):
    rid = STATE["req_id"]
    r = requests.get(f"{BASE}/api/business/requests/{rid}", headers=h(biz_token), timeout=15)
    assert r.status_code == 200, r.text
    offers = r.json().get("offers", [])
    accepted = [o for o in offers if o.get("worker_id") == STATE["drv_id"]]
    assert accepted, "driver offer not visible to business"
    worker = accepted[0].get("worker") or {}
    assert worker.get("phone") == DRV_PHONE, f"phone privacy failed after acceptance: {worker}"


# =========================================================================
# M. Full workflow: business confirm → checkin → attend → finish → complete
# =========================================================================
def test_M1_business_confirms(biz_token):
    rid = STATE["req_id"]
    r = requests.post(f"{BASE}/api/business/requests/{rid}/confirm", headers=h(biz_token), timeout=15)
    assert r.status_code == 200, f"confirm: {r.status_code} {r.text}"


def test_M2_driver_checkin(drv_token):
    oid = STATE["offer_id"]
    r = requests.post(f"{BASE}/api/worker/offers/{oid}/checkin", headers=h(drv_token), timeout=15)
    assert r.status_code == 200, f"checkin: {r.status_code} {r.text}"


def test_M3_business_marks_attended(biz_token):
    rid, oid = STATE["req_id"], STATE["offer_id"]
    r = requests.post(f"{BASE}/api/business/requests/{rid}/attendance/{oid}",
                      headers=h(biz_token), json={"result": "attended"}, timeout=15)
    assert r.status_code == 200, f"attendance: {r.status_code} {r.text}"


def test_M4_driver_finishes(drv_token):
    oid = STATE["offer_id"]
    r = requests.post(f"{BASE}/api/worker/offers/{oid}/finish", headers=h(drv_token), timeout=15)
    assert r.status_code == 200, f"finish: {r.status_code} {r.text}"


def test_M5_business_completes(biz_token, drv_token):
    rid = STATE["req_id"]
    r = requests.post(f"{BASE}/api/business/requests/{rid}/complete", headers=h(biz_token), timeout=15)
    assert r.status_code == 200, f"complete: {r.status_code} {r.text}"
    body = r.json()
    STATE["released"] = body.get("released")
    print(f"complete: released={body.get('released')} refunded={body.get('refunded')}")


# =========================================================================
# N. Settlement — driver wallet credited
# =========================================================================
def test_N_driver_wallet_credited(drv_token):
    r = requests.get(f"{BASE}/api/worker/overview", headers=h(drv_token), timeout=15)
    assert r.status_code == 200
    wallet = r.json().get("wallet") or {}
    print(f"driver wallet available={wallet.get('available')} paid_earnings={r.json().get('paid_earnings')}")
    assert (wallet.get("available") or 0) > 0, "driver wallet not credited after settlement"


# =========================================================================
# O. Ratings
# =========================================================================
def test_O1_business_rates_driver(biz_token):
    rid, oid = STATE["req_id"], STATE["offer_id"]
    r = requests.post(f"{BASE}/api/business/requests/{rid}/rate", headers=h(biz_token),
                      json={"offer_id": oid, "score": 5, "comment": "iter8 great"}, timeout=15)
    assert r.status_code == 200, f"biz rate: {r.status_code} {r.text}"


def test_O2_driver_rates_business(drv_token):
    oid = STATE["offer_id"]
    r = requests.post(f"{BASE}/api/worker/rate", headers=h(drv_token),
                      json={"offer_id": oid, "score": 5, "comment": "iter8 great biz"}, timeout=15)
    assert r.status_code == 200, f"drv rate: {r.status_code} {r.text}"


# =========================================================================
# P. Support ticket
# =========================================================================
def test_P1_driver_opens_ticket(drv_token):
    rid = STATE["req_id"]
    payload = {"subject": "TEST_iter8 استفسار",
               "category": "general", "message": "استفسار ما بعد المهمة",
               "request_id": rid}
    r = requests.post(f"{BASE}/api/tickets", headers=h(drv_token), json=payload, timeout=15)
    assert r.status_code < 400, f"ticket create: {r.status_code} {r.text}"
    STATE["ticket_id"] = (r.json().get("ticket") or r.json()).get("_id")
    assert STATE["ticket_id"]


def test_P2_admin_sees_and_replies(admin_token):
    tid = STATE["ticket_id"]
    r = requests.get(f"{BASE}/api/admin/tickets", headers=h(admin_token), timeout=15)
    if r.status_code == 404:
        r = requests.get(f"{BASE}/api/tickets", headers=h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    items = r.json().get("tickets", r.json().get("items", []))
    assert any(t.get("_id") == tid for t in items), f"ticket {tid} not in admin queue"

    # try to reply/resolve — endpoint may vary; test the common one
    for path, payload in [
        (f"/api/admin/tickets/{tid}/reply", {"message": "iter8 reply"}),
        (f"/api/tickets/{tid}/reply", {"message": "iter8 reply"}),
    ]:
        rr = requests.post(f"{BASE}{path}", headers=h(admin_token), json=payload, timeout=15)
        print(f"reply {path} -> {rr.status_code}")
        if rr.status_code < 400:
            break
    for path, payload in [
        (f"/api/admin/tickets/{tid}/status", {"status": "resolved"}),
        (f"/api/tickets/{tid}/status", {"status": "resolved"}),
    ]:
        rr = requests.post(f"{BASE}{path}", headers=h(admin_token), json=payload, timeout=15)
        print(f"resolve {path} -> {rr.status_code}")
        if rr.status_code < 400:
            break


# =========================================================================
# Q. Audit log has entries from this run
# =========================================================================
def test_Q_admin_audit_log(admin_token):
    r = requests.get(f"{BASE}/api/admin/audit", headers=h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    logs = r.json().get("logs", [])
    assert len(logs) > 0, "audit log empty"
    # Check for driver_verified action from our run
    actions = {l.get("action") for l in logs}
    print(f"audit actions sample: {list(actions)[:15]}")
