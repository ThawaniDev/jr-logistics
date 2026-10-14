"""
Iteration 9 — JR Logistics final update: client pricing, settlements/accountant flow,
loading confirmation, driver financial privacy, live location, reports, VAT.
Run: cd /app/backend && python -m pytest tests/test_iteration9.py -v
"""
import os
import uuid
import random
from datetime import date, timedelta

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://tawazon.preview.emergentagent.com")
API = f"{BASE}/api"
BIZ = "+966500000101"
DRV = "+966500000201"


def _h(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _otp_login(phone: str) -> dict:
    for _ in range(4):
        s = requests.post(f"{API}/auth/otp/send", json={"phone": phone})
        code = s.json().get("demo_otp", "8325")
        r = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
        if r.status_code == 200:
            return r.json()
    assert False, f"OTP login failed for {phone}: {r.text}"


def _admin() -> str:
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": "emadabuharb1993@gmail.com", "password": "Ee6211673"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def biz(): return _otp_login(BIZ)["token"]


@pytest.fixture(scope="module")
def drv(): return _otp_login(DRV)["token"]


@pytest.fixture(scope="module")
def adm(): return _admin()


def _mk_req(biz_token, title, rate=8, shipments=10):
    day = (date.today() + timedelta(days=120 + random.randint(0, 60))).isoformat()
    payload = {
        "service_type": "delivery_driver", "title": title,
        "city": "الرياض", "address": "حي النرجس", "required_count": 1,
        "start_date": day, "start_time": "09:00",
        "duration_type": "one_day", "days_count": 1, "rate": rate,
        "shipments_per_driver": shipments, "vehicle_type": "سيدان",
        "publish": True, "terms": True,
    }
    r = requests.post(f"{API}/business/requests", json=payload, headers=_h(biz_token))
    if r.status_code == 400 and r.json().get("detail", {}).get("code") == "INSUFFICIENT_FUNDS":
        d = r.json()["detail"]
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token),
                      json={"amount": d["required"] - d["available"] + 500})
        r = requests.post(f"{API}/business/requests", json=payload, headers=_h(biz_token))
    assert r.status_code == 200, r.text
    return r.json()["request"]


def _settle_all(adm_token, request_id):
    sts = requests.get(f"{API}/admin/finance/settlements", headers=_h(adm_token)).json()["settlements"]
    for s in [x for x in sts if x["request_id"] == request_id and x["status"] in ("pending_review", "under_review", "approved")]:
        requests.post(f"{API}/admin/finance/settlements/{s['_id']}/review", headers=_h(adm_token), json={})
        requests.post(f"{API}/admin/finance/settlements/{s['_id']}/approve", headers=_h(adm_token), json={})
        r = requests.post(f"{API}/admin/finance/settlements/{s['_id']}/payout", headers=_h(adm_token),
                          json={"method": "bank_transfer"})
        assert r.status_code == 200, r.text


class TestClientPricing:
    def test_set_and_snapshot(self, biz, adm):
        users = requests.get(f"{API}/admin/users?role=business", headers=_h(adm)).json()["users"]
        b1 = next(u for u in users if u["phone"] == BIZ)
        uid = uuid.uuid4().hex[:6]
        r = requests.post(f"{API}/admin/pricing", headers=_h(adm), json={
            "business_id": b1["_id"], "rate": 7.5, "commission_rate": 0.12,
            "effective_date": date.today().isoformat(), "version": f"TEST-AGR-{uid}",
            "reason": "اختبار"})
        assert r.status_code == 200, r.text
        # new request uses the client price automatically
        req = _mk_req(biz, f"TEST_pricing_{uid}")
        assert req["rate"] == 7.5, f"expected client rate 7.5, got {req['rate']}"
        assert req["commission_rate"] == 0.12
        assert req["pricing_version"] == f"TEST-AGR-{uid}"
        assert req["pricing_snapshot"]["source"] == "client_pricing"
        # change price → historical request unchanged
        requests.post(f"{API}/admin/pricing", headers=_h(adm), json={
            "business_id": b1["_id"], "rate": 9.0, "commission_rate": 0.10,
            "effective_date": date.today().isoformat(), "version": f"TEST-AGR2-{uid}", "reason": "زيادة"})
        det = requests.get(f"{API}/business/requests/{req['_id']}", headers=_h(biz)).json()["request"]
        assert det["rate"] == 7.5, "historical request price changed!"
        hist = requests.get(f"{API}/admin/pricing/history/{b1['_id']}", headers=_h(adm)).json()["history"]
        assert len(hist) >= 2
        assert hist[0]["old_rate"] == 7.5 and hist[0]["rate"] == 9.0
        assert hist[0]["created_by"]["name"]
        # restore platform default by deactivating
        requests.post(f"{API}/admin/pricing/{hist[0]['_id']}/deactivate", headers=_h(adm))
        requests.post(f"{API}/business/requests/{req['_id']}/cancel", json={}, headers=_h(biz))

    def test_pricing_requires_permission(self, biz, drv):
        for tok in (biz, drv):
            r = requests.get(f"{API}/admin/pricing", headers=_h(tok))
            assert r.status_code == 403


class TestDriverFinancialPrivacy:
    def test_driver_cannot_see_pricing(self, drv):
        for ep in ("/worker/offers", "/worker/available", "/worker/jobs"):
            r = requests.get(f"{API}{ep}", headers=_h(drv))
            assert r.status_code == 200
            payload = r.text
            for forbidden in ('"commission"', '"rate"', '"estimated_total"', '"payout_total"'):
                assert forbidden not in payload, f"financial field leaked in {ep}: {forbidden}"


class TestLoadingAndSettlement:
    def test_full_loading_settlement_flow(self, biz, drv, adm):
        uid = uuid.uuid4().hex[:6]
        req = _mk_req(biz, f"TEST_settle_{uid}", shipments=20)
        rid = req["_id"]
        # driver accepts
        offers = requests.get(f"{API}/worker/offers", headers=_h(drv)).json()["offers"]
        offer = next((o for o in offers if o["request_id"] == rid), None)
        if offer:
            rr = requests.post(f"{API}/worker/offers/{offer['_id']}/respond",
                               json={"action": "accept", "terms": True}, headers=_h(drv))
        else:
            rr = requests.post(f"{API}/worker/apply", json={"request_id": rid, "terms": True}, headers=_h(drv))
        assert rr.status_code == 200, rr.text
        # business confirms (reserves escrow)
        c = requests.post(f"{API}/business/requests/{rid}/confirm", headers=_h(biz))
        assert c.status_code == 200, c.text
        jobs = requests.get(f"{API}/worker/jobs", headers=_h(drv)).json()["jobs"]
        job = next(j for j in jobs if j["request_id"] == rid)
        oid = job["_id"]
        # checkin → attend → loading (27 of 20? use 18) → confirm → finish → complete
        requests.post(f"{API}/worker/offers/{oid}/checkin", headers=_h(drv))
        requests.post(f"{API}/business/requests/{rid}/attendance/{oid}", headers=_h(biz), json={"result": "attended"})
        ld = requests.post(f"{API}/business/requests/{rid}/loading", headers=_h(biz),
                           json={"offer_id": oid, "qty": 18})
        assert ld.status_code == 200, ld.text
        # driver sees loaded qty and confirms
        jobs2 = requests.get(f"{API}/worker/jobs", headers=_h(drv)).json()["jobs"]
        job2 = next(j for j in jobs2 if j["_id"] == oid)
        assert job2["loaded_qty"] == 18
        cf = requests.post(f"{API}/worker/offers/{oid}/confirm-loading", headers=_h(drv))
        assert cf.status_code == 200, cf.text
        requests.post(f"{API}/worker/offers/{oid}/finish", headers=_h(drv))
        co = requests.post(f"{API}/business/requests/{rid}/complete", headers=_h(biz))
        assert co.status_code == 200, co.text
        assert co.json()["settlements_created"] == 1
        # settlement uses actual 18, not expected 20
        sts = requests.get(f"{API}/admin/finance/settlements", headers=_h(adm)).json()["settlements"]
        s = next(x for x in sts if x["request_id"] == rid)
        assert s["final_qty"] == 18
        assert s["status"] == "pending_review"
        assert s["gross"] == round(s["rate"] * 18, 2)
        # driver wallet NOT credited before payout
        w_before = requests.get(f"{API}/wallet", headers=_h(drv)).json()["wallet"]["available"]
        # accountant flow
        _settle_all(adm, rid)
        det = requests.get(f"{API}/admin/finance/settlements", headers=_h(adm)).json()["settlements"]
        s2 = next(x for x in det if x["_id"] == s["_id"])
        assert s2["status"] == "paid"
        assert s2["approved"]["accountant_name"] == "مدير المنصة"
        assert s2["payout"]["executed_by"]["name"] == "مدير المنصة"
        assert s2["invoice_no"].startswith("JR-INV-")
        # driver wallet credited after payout
        w_after = requests.get(f"{API}/wallet", headers=_h(drv)).json()["wallet"]["available"]
        assert round(w_after - w_before, 2) == s["net"], f"driver net mismatch: {w_before} → {w_after}, net={s['net']}"
        # VAT computed on commission
        assert s["vat"] == round(s["commission"] * 0.15, 2)

    def test_loading_dispute_blocks_completion(self, biz, drv, adm):
        uid = uuid.uuid4().hex[:6]
        req = _mk_req(biz, f"TEST_dispute_{uid}", shipments=20)
        rid = req["_id"]
        offers = requests.get(f"{API}/worker/offers", headers=_h(drv)).json()["offers"]
        offer = next((o for o in offers if o["request_id"] == rid), None)
        if offer:
            requests.post(f"{API}/worker/offers/{offer['_id']}/respond",
                          json={"action": "accept", "terms": True}, headers=_h(drv))
        else:
            requests.post(f"{API}/worker/apply", json={"request_id": rid, "terms": True}, headers=_h(drv))
        requests.post(f"{API}/business/requests/{rid}/confirm", headers=_h(biz))
        jobs = requests.get(f"{API}/worker/jobs", headers=_h(drv)).json()["jobs"]
        job = next(j for j in jobs if j["request_id"] == rid)
        oid = job["_id"]
        requests.post(f"{API}/worker/offers/{oid}/checkin", headers=_h(drv))
        requests.post(f"{API}/business/requests/{rid}/attendance/{oid}", headers=_h(biz), json={"result": "attended"})
        requests.post(f"{API}/business/requests/{rid}/loading", headers=_h(biz), json={"offer_id": oid, "qty": 5})
        dp = requests.post(f"{API}/worker/offers/{oid}/dispute-loading", headers=_h(drv),
                           json={"note": "الكمية الفعلية 18 وليست 5"})
        assert dp.status_code == 200, dp.text
        # completion blocked while disputed
        co = requests.post(f"{API}/business/requests/{rid}/complete", headers=_h(biz))
        assert co.status_code == 400
        assert "نزاع" in co.text
        # dispute created an urgent support case
        cases = requests.get(f"{API}/admin/cases", headers=_h(adm)).json()["cases"]
        # shipment disputes go to tickets (category shipment_count_differs)
        tickets = requests.get(f"{API}/tickets", headers=_h(adm)).json()["tickets"]
        assert any(t.get("offer_id") == oid and t["category"] == "shipment_count_differs" for t in tickets)
        requests.post(f"{API}/business/requests/{rid}/cancel", json={}, headers=_h(biz))


class TestLiveLocation:
    def test_worker_location_and_admin_view(self, drv, adm):
        # available driver posts location
        requests.patch(f"{API}/worker/availability", json={"status": "available"}, headers=_h(drv))
        r = requests.post(f"{API}/worker/location", json={"lat": 24.7136, "lng": 46.6753}, headers=_h(drv))
        assert r.status_code == 200, r.text
        locs = requests.get(f"{API}/admin/locations", headers=_h(adm)).json()["locations"]
        mine = next((l for l in locs if l["phone"] == DRV), None)
        assert mine and abs(mine["lat"] - 24.7136) < 0.001
        # going unavailable stops updates
        requests.patch(f"{API}/worker/availability", json={"status": "unavailable"}, headers=_h(drv))
        requests.delete(f"{API}/worker/location", headers=_h(drv))
        r2 = requests.post(f"{API}/worker/location", json={"lat": 24.7, "lng": 46.7}, headers=_h(drv))
        assert r2.status_code == 400
        requests.patch(f"{API}/worker/availability", json={"status": "available"}, headers=_h(drv))
        # audit recorded the admin view
        aud = requests.get(f"{API}/admin/audit", headers=_h(adm)).json()["logs"]
        assert any(e["action"] == "live_location_viewed" for e in aud)

    def test_location_forbidden_for_business(self, biz):
        r = requests.get(f"{API}/admin/locations", headers=_h(biz))
        assert r.status_code == 403


class TestReportsAndLedger:
    def test_reports_all_types(self, adm):
        for rt in ("businesses", "drivers", "requests", "finance", "operations", "support", "staff"):
            r = requests.get(f"{API}/admin/reports/{rt}", headers=_h(adm))
            assert r.status_code == 200, f"{rt}: {r.text}"
            assert "rows" in r.json()

    def test_report_export_audited(self, adm):
        r = requests.get(f"{API}/admin/reports/requests/export", headers=_h(adm))
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        aud = requests.get(f"{API}/admin/audit", headers=_h(adm)).json()["logs"]
        assert any(e["action"] == "report_exported" for e in aud)

    def test_ledger_and_platform_account(self, adm):
        led = requests.get(f"{API}/admin/finance/ledger", headers=_h(adm)).json()["ledger"]
        assert len(led) > 0
        types = {l["type"] for l in led}
        assert "reserve" in types or "payout" in types or "topup" in types
        pf = requests.get(f"{API}/admin/finance/platform", headers=_h(adm)).json()
        for k in ("commission_revenue", "driver_amounts_owed", "reserved_total"):
            assert k in pf

    def test_alerts_endpoint(self, adm):
        r = requests.get(f"{API}/admin/reports/alerts/list", headers=_h(adm))
        assert r.status_code == 200
        assert "alerts" in r.json()

    def test_reports_forbidden_for_driver(self, drv):
        r = requests.get(f"{API}/admin/reports/requests", headers=_h(drv))
        assert r.status_code == 403
