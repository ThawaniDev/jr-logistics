"""Iteration 11 — Operations room, communication, route pricing, terms consent, map, alerts."""
import os
import random

import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")
ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "emadabuharb1993@gmail.com")
ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "Ee6211673")


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _otp_token(phone):
    code = requests.post(f"{API}/auth/otp/send", json={"phone": phone}).json()["demo_otp"]
    return requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code}).json()


def _admin():
    return requests.post(f"{API}/auth/admin/login",
                         json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()["token"]


def _phone(prefix):
    return prefix + "".join(random.choices("0123456789", k=5))


def _mk_business(adm):
    reg = _otp_token(_phone("+9665610"))
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "business",
        "name": "منشأة iter11", "company_name": "مستودع iter11", "city": "الرياض",
        "terms_accepted": True})
    assert r.status_code == 200, r.text
    biz_token = r.json()["token"]
    biz_id = r.json()["user"]["_id"]
    rv = requests.post(f"{API}/admin/accounts/{biz_id}/verify", headers=_h(adm), json={"action": "approve"})
    assert rv.status_code == 200, rv.text
    return biz_token, biz_id


def _mk_driver():
    reg = _otp_token(_phone("+9665620"))
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "worker",
        "name": "مندوب iter11", "city": "الرياض",
        "services": ["delivery_driver"], "vehicle_type": "sedan", "terms_accepted": True})
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"]["_id"]


class TestTermsConsent:
    def test_register_requires_terms(self):
        reg = _otp_token(_phone("+9665630"))
        r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
            "registration_token": reg["registration_token"], "role": "business",
            "name": "بدون شروط", "company_name": "بدون شروط", "terms_accepted": False})
        assert r.status_code == 400 and "الشروط" in r.json()["detail"]

    def test_terms_endpoint_public(self):
        r = requests.get(f"{API}/catalog/terms")
        assert r.status_code == 200
        assert r.json()["version"] and "JR Logistics" in r.json()["business_text"]


class TestRoutePricing:
    def test_no_rule_blocks_request(self):
        adm = _admin()
        biz_token, _ = _mk_business(adm)
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 500})
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "بدون قاعدة سعر", "city": "الرياض",
            "address": "موقع", "required_count": 1, "start_date": "2026-10-01",
            "start_time": "08:00", "duration_type": "one_day",
            "shipments_per_driver": 10, "vehicle_type": "dyna", "temperature_type": "cold",
            "pickup_city": "الرياض", "delivery_city": "الدمام", "publish": True, "terms": True})
        assert r.status_code == 400
        assert "لا يوجد سعر معتمد" in str(r.json()["detail"])

    def test_riyadh_only_pickup(self):
        adm = _admin()
        biz_token, _ = _mk_business(adm)
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 500})
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "استلام جدة", "city": "جدة",
            "address": "موقع", "required_count": 1, "start_date": "2026-10-01",
            "start_time": "08:00", "duration_type": "one_day",
            "shipments_per_driver": 10, "vehicle_type": "sedan",
            "pickup_city": "جدة", "delivery_city": "الرياض", "publish": True, "terms": True})
        assert r.status_code == 400 and "الرياض" in str(r.json()["detail"])

    def test_rule_snapshot_immutable(self):
        adm = _admin()
        biz_token, biz_id = _mk_business(adm)
        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "جدة",
            "price": 10, "effective_date": "2026-01-01", "version": "v1"})
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 2000})
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "لقطة سعر", "city": "الرياض",
            "address": "موقع", "required_count": 1, "start_date": "2026-10-02",
            "start_time": "08:00", "duration_type": "one_day",
            "shipments_per_driver": 5, "vehicle_type": "sedan",
            "pickup_city": "الرياض", "delivery_city": "جدة", "publish": False})
        assert r.status_code == 200, r.text
        req = r.json()["request"]
        assert req["rate"] == 10
        assert req["pricing_snapshot"]["pricing_rule_id"]
        assert req["pricing_snapshot"]["pickup_city"] == "الرياض"
        assert req["pricing_snapshot"]["delivery_city"] == "جدة"
        # new rule supersedes — historical request unchanged
        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "جدة",
            "price": 20, "effective_date": "2026-06-01", "version": "v2"})
        r = requests.get(f"{API}/business/requests/{req['_id']}", headers=_h(biz_token))
        assert r.json()["request"]["rate"] == 10
        # quote now returns the new price
        q = requests.get(f"{API}/business/pricing/quote", headers=_h(biz_token), params={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "جدة"}).json()
        assert q["ok"] and q["price"] == 20

    def test_business_specific_rule_overrides_global(self):
        adm = _admin()
        biz_token, biz_id = _mk_business(adm)
        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "van", "temperature_type": "cold",
            "pickup_city": "الرياض", "delivery_city": "الدمام",
            "price": 12, "effective_date": "2026-01-01"})
        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "business_id": biz_id, "vehicle_type": "van", "temperature_type": "cold",
            "pickup_city": "الرياض", "delivery_city": "الدمام",
            "price": 9, "effective_date": "2026-01-01", "agreement_ref": "AGR-11"})
        q = requests.get(f"{API}/business/pricing/quote", headers=_h(biz_token), params={
            "vehicle_type": "van", "temperature_type": "cold",
            "pickup_city": "الرياض", "delivery_city": "الدمام"}).json()
        assert q["ok"] and q["price"] == 9


class TestOpsRoom:
    def _setup_job(self):
        adm = _admin()
        biz_token, biz_id = _mk_business(adm)
        drv_token, drv_id = _mk_driver()
        # verify driver directly through admin doc flow is slow — mark verified via admin users patch if available;
        # instead use document upload + admin review like iteration10
        jpg = bytes.fromhex("ffd8ffe000104a46494600010101006000600000ffdb00430003020203020203030303040303"
                            "04050805050404050a070706080c0a0c0c0b0a0b0b0d0e12100d0e110e0b0b101610111314"
                            "1515150c0f171816141812141514ffc0000b080001000101011100ffc40014000100000000"
                            "000000000000000000000000000000ffc40014100100000000000000000000000000000000"
                            "00000000ffda0008010100003f00d2cf20ffd9")
        for d in ("national_id", "driving_license", "vehicle_registration"):
            requests.post(f"{API}/documents/upload", headers=_h(drv_token),
                          files={"file": (f"{d}.jpg", jpg, "image/jpeg")},
                          data={"doc_type": d, "expiry_date": "2028-01-01"})
        docs = requests.get(f"{API}/admin/documents", headers=_h(adm)).json()["documents"]
        for d in [x for x in docs if x["worker_id"] == drv_id]:
            requests.post(f"{API}/admin/documents/{d['_id']}/review", headers=_h(adm), json={"action": "verify"})
        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
            "price": 8, "effective_date": "2026-01-01"})
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 1000})
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "غرفة عمليات iter11", "city": "الرياض",
            "address": "موقع", "required_count": 1, "start_date": "2026-10-03",
            "start_time": "08:00", "duration_type": "one_day",
            "shipments_per_driver": 10, "vehicle_type": "sedan",
            "pickup_city": "الرياض", "delivery_city": "الرياض", "publish": True, "terms": True})
        req_id = r.json()["request"]["_id"]
        offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"]
        offer = next(o for o in offers if o["request_id"] == req_id)
        requests.post(f"{API}/worker/offers/{offer['_id']}/respond", headers=_h(drv_token),
                      json={"action": "accept", "terms": True})
        return adm, biz_token, drv_token, req_id, offer["_id"], drv_id

    def test_chat_timeline_contact_rbac(self):
        adm, biz_token, drv_token, req_id, offer_id, drv_id = self._setup_job()
        # chat both ways
        r = requests.post(f"{API}/jobs/{offer_id}/messages", headers=_h(drv_token),
                          json={"text": "وصلت للمستودع"})
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/jobs/{offer_id}/messages", headers=_h(biz_token),
                          json={"text": "أهلاً بك، بوابة 3"})
        assert r.status_code == 200, r.text
        msgs = requests.get(f"{API}/jobs/{offer_id}/messages", headers=_h(drv_token)).json()["messages"]
        assert len(msgs) == 2 and msgs[0]["text"] == "وصلت للمستودع"
        # masked contact logs event, never exposes numbers
        r = requests.post(f"{API}/jobs/{offer_id}/contact", headers=_h(drv_token), json={"channel": "call"})
        assert r.status_code == 200 and r.json()["masked"] is True
        # timeline accumulates the full chain
        events = requests.get(f"{API}/jobs/{offer_id}/timeline", headers=_h(biz_token)).json()["events"]
        types = {e["event_type"] for e in events}
        assert {"request_created", "request_published", "driver_notified",
                "driver_accepted", "message_sent", "contact_initiated"} <= types
        ev = next(e for e in events if e["event_type"] == "driver_accepted")
        assert ev["actor_id"] == drv_id and ev["actor_role"] == "worker"
        # RBAC: unrelated business cannot read chat/timeline
        other_biz, _ = _mk_business(adm)
        assert requests.get(f"{API}/jobs/{offer_id}/messages", headers=_h(other_biz)).status_code == 403
        assert requests.get(f"{API}/jobs/{offer_id}/timeline", headers=_h(other_biz)).status_code == 403

    def test_urgent_help_creates_ops_case(self):
        adm, biz_token, drv_token, req_id, offer_id, drv_id = self._setup_job()
        r = requests.post(f"{API}/business/requests/{req_id}/urgent-help", headers=_h(biz_token),
                          json={"reason": "driver_not_arrived", "offer_id": offer_id})
        assert r.status_code == 200, r.text
        tickets = requests.get(f"{API}/tickets", headers=_h(biz_token)).json()["tickets"]
        t = next(x for x in tickets if x["category"] == "urgent_help")
        assert t["priority"] == "urgent" and t["escalation"] == "operations"
        assert t["request_id"] == req_id and t["offer_id"] == offer_id and t["driver_id"] == drv_id
        events = requests.get(f"{API}/jobs/{offer_id}/timeline", headers=_h(biz_token)).json()["events"]
        assert any(e["event_type"] == "urgent_help_requested" for e in events)


class TestOperationsAndMap:
    def test_today_alerts_map_endpoints(self):
        adm = _admin()
        drv_token, drv_id = _mk_driver()
        r = requests.get(f"{API}/admin/operations/today", headers=_h(adm))
        assert r.status_code == 200 and "summary" in r.json() and "late_drivers" in r.json()
        r = requests.get(f"{API}/admin/operations/alerts", headers=_h(adm))
        assert r.status_code == 200 and "alerts" in r.json() and "thresholds" in r.json()
        r = requests.get(f"{API}/admin/operations/map", headers=_h(adm))
        assert r.status_code == 200
        markers = [d for d in r.json()["drivers"] if d["worker_id"] == drv_id]
        assert markers and markers[0]["op_status"] == "available" and markers[0]["lat"]
        r = requests.get(f"{API}/admin/operations/map", headers=_h(adm), params={"status": "on_job"})
        assert all(d["op_status"] == "on_job" for d in r.json()["drivers"])
        r = requests.get(f"{API}/admin/operations/city-summary", headers=_h(adm), params={"city": "الرياض"})
        assert r.status_code == 200 and r.json()["total"] >= 1
        r = requests.get(f"{API}/admin/operations/drivers", headers=_h(adm),
                         params={"vehicle_type": "sedan", "eligible_only": True})
        assert r.status_code == 200
        r = requests.get(f"{API}/admin/operations/drivers/{drv_id}/profile", headers=_h(adm))
        assert r.status_code == 200 and "stats" in r.json()
        # RBAC: business/driver blocked from ops + map
        biz_token, _ = _mk_business(adm)
        assert requests.get(f"{API}/admin/operations/map", headers=_h(biz_token)).status_code == 403
        assert requests.get(f"{API}/admin/operations/today", headers=_h(drv_token)).status_code == 403
        assert requests.get(f"{API}/admin/operations/alerts", headers=_h(biz_token)).status_code == 403
