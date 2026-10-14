"""Iteration 10 — Clean-state controlled E2E for the new JR Logistics driver workflow.

Flow: business registers+topup → driver registers → uploads docs (local storage
fallback) → admin verifies → business publishes 30-shipment request → driver sees
NET only → accepts → all other opportunities hidden/blocked → arrival (وصلت) →
warehouse confirms attendance → warehouse records 30 loaded → driver confirms →
driver ends opportunity with 27 delivered → warehouse confirms 27 → complete →
settlement (final_qty=27) → accountant review/approve → payout → wallets/ledger/
audit verified.
"""
import os
import random

import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")
ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "emadabuharb1993@gmail.com")
ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "Ee6211673")


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _otp_token(phone):
    r = requests.post(f"{API}/auth/otp/send", json={"phone": phone})
    assert r.status_code == 200, r.text
    code = r.json()["demo_otp"]
    r = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
    assert r.status_code == 200, r.text
    return r.json()


def _admin_token():
    r = requests.post(f"{API}/auth/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _tiny_jpg():
    return bytes.fromhex(
        "ffd8ffe000104a46494600010101006000600000ffdb0043000302020302020303030304"
        "030304050805050404050a070706080c0a0c0c0b0a0b0b0d0e12100d0e110e0b0b10161011"
        "13141515150c0f171816141812141514ffc0000b080001000101011100ffc4001400010000"
        "000000000000000000000000000000000000ffc4001410010000000000000000000000000000"
        "0000000000ffda0008010100003f00d2cf20ffd9")


class TestNewWorkflowE2E:
    def test_full_clean_flow(self):
        suffix = "".join(random.choices("0123456789", k=5))
        biz_phone = f"+9665510{suffix[:5]}"
        drv_phone = f"+9665520{suffix[:5]}"

        # --- admin sees new accounts automatically ---
        adm = _admin_token()
        biz_reg = _otp_token(biz_phone)
        r = requests.post(f"{API}/auth/register", headers=_h(biz_reg["registration_token"]), json={
            "registration_token": biz_reg["registration_token"], "role": "business",
            "name": "مدير مستودع الاختبار", "company_name": "مستودع الاختبار النظيف",
            "city": "الرياض", "industry": "logistics", "terms_accepted": True})
        assert r.status_code == 200, r.text
        biz_token = r.json()["token"]
        biz_id = r.json()["user"]["_id"]
        r = requests.post(f"{API}/admin/accounts/{biz_id}/verify", headers=_h(adm), json={"action": "approve"})
        assert r.status_code == 200, r.text

        users = requests.get(f"{API}/admin/users", headers=_h(adm)).json()["users"]
        assert any(u.get("phone") == biz_phone for u in users), "new business not visible in Admin"

        drv_reg = _otp_token(drv_phone)
        r = requests.post(f"{API}/auth/register", headers=_h(drv_reg["registration_token"]), json={
            "registration_token": drv_reg["registration_token"], "role": "worker",
            "name": "مندوب الاختبار النظيف", "city": "الرياض",
            "services": ["delivery_driver"], "vehicle_type": "sedan", "terms_accepted": True})
        assert r.status_code == 200, r.text
        drv_token = r.json()["token"]
        drv_id = r.json()["user"]["_id"]

        users = requests.get(f"{API}/admin/users", headers=_h(adm)).json()["users"]
        assert any(u.get("phone") == drv_phone for u in users), "new driver not visible in Admin"

        # --- driver document upload (real persistent storage) + admin verify ---
        for dtype in ("national_id", "driving_license", "vehicle_registration"):
            r = requests.post(f"{API}/documents/upload", headers=_h(drv_token),
                              files={"file": (f"{dtype}.jpg", _tiny_jpg(), "image/jpeg")},
                              data={"doc_type": dtype, "expiry_date": "2028-09-30"})
            assert r.status_code == 200, f"upload {dtype}: {r.status_code} {r.text}"
        # malformed expiry must be rejected
        r = requests.post(f"{API}/documents/upload", headers=_h(drv_token),
                          files={"file": ("bad.jpg", _tiny_jpg(), "image/jpeg")},
                          data={"doc_type": "vehicle_photo", "expiry_date": "302026/09/"})
        assert r.status_code == 400, r.text

        docs = requests.get(f"{API}/admin/documents", headers=_h(adm)).json()["documents"]
        mine = [d for d in docs if d["worker_id"] == drv_id]
        assert len(mine) >= 3
        for d in mine:
            assert d["expiry_date"] == "2028-09-30"
            r = requests.post(f"{API}/admin/documents/{d['_id']}/review",
                              headers=_h(adm), json={"action": "verify"})
            assert r.status_code == 200, r.text
        # admin can view the stored file
        r = requests.get(f"{API}/documents/{mine[0]['_id']}/file", headers=_h(adm))
        assert r.status_code == 200 and len(r.content) > 50
        # business must NOT access driver documents
        r = requests.get(f"{API}/documents/{mine[0]['_id']}/file", headers=_h(biz_token))
        assert r.status_code == 403, r.text

        me = requests.get(f"{API}/auth/me", headers=_h(drv_token)).json()
        assert me["user"]["worker_profile"]["verification_status"] == "verified"

        # --- business topup + publish 30-shipment request (route pricing rule required) ---
        r = requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
            "price": 8, "effective_date": "2026-01-01", "version": "TEST10"})
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 1000})
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "TEST10 طلب 30 شحنة", "city": "الرياض",
            "address": "مستودع الاختبار", "required_count": 1, "start_date": "2026-09-20",
            "start_time": "08:00", "duration_type": "one_day", "days_count": 1,
            "shipments_per_driver": 30, "vehicle_type": "sedan",
            "pickup_city": "الرياض", "delivery_city": "الرياض",
            "publish": True, "terms": True})
        assert r.status_code == 200, r.text
        req = r.json()["request"]
        req_id = req["_id"]

        reqs = requests.get(f"{API}/admin/requests", headers=_h(adm)).json()["requests"]
        assert any(x["_id"] == req_id for x in reqs), "new request not visible in Admin"

        # --- driver sees NET only, accepts, other opportunities disappear ---
        offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()
        assert not offers.get("has_active_job")
        offer = next((o for o in offers["offers"] if o["request_id"] == req_id), None)
        assert offer, "driver did not receive the offer"
        rq = offer["request"]
        assert rq["expected_earning"] == 216.0  # 30 × 8 × 0.9
        for banned in ("rate", "estimated_total", "commission", "commission_rate", "pricing_snapshot"):
            assert banned not in rq, f"driver payload leaks {banned}"

        r = requests.post(f"{API}/worker/offers/{offer['_id']}/respond",
                          headers=_h(drv_token), json={"action": "accept", "terms": True})
        assert r.status_code == 200, r.text

        after = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()
        assert after["has_active_job"] is True and after["offers"] == []
        avail = requests.get(f"{API}/worker/available", headers=_h(drv_token)).json()
        assert avail["has_active_job"] is True and avail["jobs"] == []
        # backend blocks accepting another job while one is active
        r = requests.post(f"{API}/worker/apply", headers=_h(drv_token),
                          json={"request_id": req_id, "terms": True})
        assert r.status_code == 400, r.text

        # --- business confirms (escrow) → driver arrival → attendance ---
        r = requests.post(f"{API}/business/requests/{req_id}/confirm", headers=_h(biz_token))
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/worker/offers/{offer['_id']}/checkin", headers=_h(drv_token))
        assert r.status_code == 200, r.text
        notifs = requests.get(f"{API}/notifications", headers=_h(biz_token)).json()["notifications"]
        assert any("وصل المندوب" in n["title"] for n in notifs)
        r = requests.post(f"{API}/business/requests/{req_id}/attendance/{offer['_id']}",
                          headers=_h(biz_token), json={"result": "attended"})
        assert r.status_code == 200, r.text

        # --- loaded shipments 30 → driver confirms ---
        r = requests.post(f"{API}/business/requests/{req_id}/loading",
                          headers=_h(biz_token), json={"offer_id": offer["_id"], "qty": 30})
        assert r.status_code == 200, r.text
        job = requests.get(f"{API}/worker/jobs", headers=_h(drv_token)).json()["jobs"][0]
        assert job["loaded_qty"] == 30
        r = requests.post(f"{API}/worker/offers/{offer['_id']}/confirm-loading", headers=_h(drv_token))
        assert r.status_code == 200, r.text

        # --- driver ends opportunity with 27 delivered (no auto-assume) ---
        r = requests.post(f"{API}/worker/offers/{offer['_id']}/finish",
                          headers=_h(drv_token), json={"delivered_qty": 27})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "delivered_reported"
        notifs = requests.get(f"{API}/notifications", headers=_h(biz_token)).json()["notifications"]
        assert any("المندوب أنهى الفرصة" in n["title"] and "27" in n["body"] for n in notifs)
        # driver must NOT be paid/complete by himself — no settlement yet
        wallet0 = requests.get(f"{API}/wallet", headers=_h(drv_token)).json()["wallet"]
        assert wallet0["available"] == 0

        # --- warehouse confirms final 27 → pending_settlement ---
        r = requests.post(f"{API}/business/requests/{req_id}/delivered/{offer['_id']}",
                          headers=_h(biz_token), json={"action": "confirm"})
        assert r.status_code == 200, r.text
        assert r.json()["final_qty"] == 27

        # --- complete → settlement for 27 ---
        r = requests.post(f"{API}/business/requests/{req_id}/complete", headers=_h(biz_token))
        assert r.status_code == 200, r.text
        settlements = requests.get(f"{API}/admin/finance/settlements", headers=_h(adm)).json()["settlements"]
        st = next(s for s in settlements if s["request_id"] == req_id)
        assert st["final_qty"] == 27 and st["loaded_qty"] == 30 and st["driver_reported_qty"] == 27
        assert st["status"] == "pending_review"
        assert st["gross"] == 216.0 and st["commission"] == 21.6 and st["net"] == 194.4

        # driver wallet untouched before accountant approval+payout
        wallet1 = requests.get(f"{API}/wallet", headers=_h(drv_token)).json()["wallet"]
        assert wallet1["available"] == 0

        # --- accountant review → approve → payout ---
        r = requests.post(f"{API}/admin/finance/settlements/{st['_id']}/review", headers=_h(adm), json={})
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/admin/finance/settlements/{st['_id']}/approve", headers=_h(adm), json={})
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/admin/finance/settlements/{st['_id']}/payout", headers=_h(adm), json={})
        assert r.status_code == 200, r.text

        wallet2 = requests.get(f"{API}/wallet", headers=_h(drv_token)).json()["wallet"]
        assert wallet2["available"] == 194.4
        bw = requests.get(f"{API}/wallet", headers=_h(biz_token)).json()["wallet"]
        assert bw["reserved"] == 0
        # refund of unused reserved share: reserved 240 (30×8) − gross 216 − ... refund = 240-216-0? reserved_share=240, gross+commission=237.6 → refund 2.4? No: commission not charged to business beyond gross… assert released
        platform = requests.get(f"{API}/admin/finance/platform", headers=_h(adm)).json()
        assert platform["commission_revenue"] >= 21.6

        # --- ledger + audit trail ---
        ledger = requests.get(f"{API}/admin/finance/ledger", headers=_h(adm)).json()["ledger"]
        types = {l["type"] for l in ledger}
        assert {"settlement_created", "payout", "commission"} <= types
        audits = requests.get(f"{API}/admin/audit", headers=_h(adm)).json()
        entries = audits.get("logs") or audits.get("entries") or []
        actions = {a["action"] for a in entries}
        for expected in ("driver_accepted", "driver_arrived", "attendance_confirmed",
                         "loading_recorded", "loading_confirmed", "driver_finished",
                         "delivery_confirmed", "request_completed",
                         "settlement_approved", "payout_executed"):
            assert expected in actions, f"missing audit action: {expected}"
        # accountant identity recorded
        payout_audit = next(a for a in entries if a["action"] == "payout_executed")
        assert payout_audit["actor_id"] and payout_audit["actor_name"]

        # --- opportunities return after the job is fully released (paid) ---
        final = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()
        assert final["has_active_job"] is False

    def test_delivered_dispute_blocks_settlement(self):
        suffix = "".join(random.choices("0123456789", k=5))
        biz_phone = f"+9665530{suffix[:5]}"
        drv_phone = f"+9665540{suffix[:5]}"
        adm = _admin_token()

        biz_reg = _otp_token(biz_phone)
        r = requests.post(f"{API}/auth/register", headers=_h(biz_reg["registration_token"]), json={
            "registration_token": biz_reg["registration_token"], "role": "business",
            "name": "منشأة نزاع", "company_name": "مستودع النزاع", "city": "الرياض", "terms_accepted": True})
        biz_token = r.json()["token"]
        biz_id = r.json()["user"]["_id"]
        r = requests.post(f"{API}/admin/accounts/{biz_id}/verify", headers=_h(adm), json={"action": "approve"})
        assert r.status_code == 200, r.text
        drv_reg = _otp_token(drv_phone)
        r = requests.post(f"{API}/auth/register", headers=_h(drv_reg["registration_token"]), json={
            "registration_token": drv_reg["registration_token"], "role": "worker",
            "name": "مندوب نزاع", "city": "الرياض",
            "services": ["delivery_driver"], "vehicle_type": "sedan", "terms_accepted": True})
        drv_token = r.json()["token"]
        drv_id = r.json()["user"]["_id"]
        for dtype in ("national_id", "driving_license", "vehicle_registration"):
            requests.post(f"{API}/documents/upload", headers=_h(drv_token),
                          files={"file": (f"{dtype}.jpg", _tiny_jpg(), "image/jpeg")},
                          data={"doc_type": dtype, "expiry_date": "2028-01-01"})
        docs = requests.get(f"{API}/admin/documents", headers=_h(adm)).json()["documents"]
        for d in [d for d in docs if d["worker_id"] == drv_id]:
            requests.post(f"{API}/admin/documents/{d['_id']}/review", headers=_h(adm), json={"action": "verify"})

        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
            "price": 8, "effective_date": "2026-01-01"})
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 1000})
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "TEST10 نزاع عدد", "city": "الرياض",
            "address": "مستودع", "required_count": 1, "start_date": "2026-09-21",
            "start_time": "08:00", "duration_type": "one_day", "days_count": 1,
            "shipments_per_driver": 30, "vehicle_type": "sedan",
            "pickup_city": "الرياض", "delivery_city": "الرياض",
            "publish": True, "terms": True})
        req_id = r.json()["request"]["_id"]
        offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"]
        offer = next(o for o in offers if o["request_id"] == req_id)
        requests.post(f"{API}/worker/offers/{offer['_id']}/respond", headers=_h(drv_token),
                      json={"action": "accept", "terms": True})
        requests.post(f"{API}/business/requests/{req_id}/confirm", headers=_h(biz_token))
        requests.post(f"{API}/worker/offers/{offer['_id']}/checkin", headers=_h(drv_token))
        requests.post(f"{API}/business/requests/{req_id}/attendance/{offer['_id']}",
                      headers=_h(biz_token), json={"result": "attended"})
        requests.post(f"{API}/business/requests/{req_id}/loading",
                      headers=_h(biz_token), json={"offer_id": offer["_id"], "qty": 30})
        requests.post(f"{API}/worker/offers/{offer['_id']}/confirm-loading", headers=_h(drv_token))
        requests.post(f"{API}/worker/offers/{offer['_id']}/finish",
                      headers=_h(drv_token), json={"delivered_qty": 27})

        # warehouse disputes → qty_disputed + operations case; completion blocked
        r = requests.post(f"{API}/business/requests/{req_id}/delivered/{offer['_id']}",
                          headers=_h(biz_token), json={"action": "dispute", "note": "العدد الفعلي 25"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "qty_disputed"
        r = requests.post(f"{API}/business/requests/{req_id}/complete", headers=_h(biz_token))
        assert r.status_code == 400, r.text
        tickets = requests.get(f"{API}/tickets", headers=_h(biz_token)).json()["tickets"]
        assert any(t["category"] == "shipment_count_differs" for t in tickets)
        wallet = requests.get(f"{API}/wallet", headers=_h(drv_token)).json()["wallet"]
        assert wallet["available"] == 0
