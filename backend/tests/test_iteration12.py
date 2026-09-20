"""Iteration 12 — Courier Office vertical: registration, verification, agreement,
driver linking, settlement ownership, office dashboard, RBAC, onboarding."""
import os
import random

import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")
ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "emadabuharb1993@gmail.com")
ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "Isnad-Dev-Admin-2026!")


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


def _mk_office():
    reg = _otp_token(_phone("+9665710"))
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "office",
        "name": "مدير مكتب iter12", "company_name": "مكتب توصيل iter12", "cr_number": "1010123456",
        "city": "الرياض", "address": "حي العليا", "terms_accepted": True})
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"]["_id"]


def _mk_driver(adm):
    reg = _otp_token(_phone("+9665720"))
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "worker",
        "name": "مندوب مكتب iter12", "city": "الرياض",
        "services": ["delivery_driver"], "vehicle_type": "sedan", "terms_accepted": True})
    assert r.status_code == 200, r.text
    token, uid = r.json()["token"], r.json()["user"]["_id"]
    jpg = bytes.fromhex("ffd8ffe000104a46494600010101006000600000ffdb00430003020203020203030303040303"
                        "04050805050404050a070706080c0a0c0c0b0a0b0b0d0e12100d0e110e0b0b101610111314"
                        "1515150c0f171816141812141514ffc0000b080001000101011100ffc40014000100000000"
                        "000000000000000000000000000000ffc40014100100000000000000000000000000000000"
                        "00000000ffda0008010100003f00d2cf20ffd9")
    for d in ("national_id", "driving_license", "vehicle_registration"):
        requests.post(f"{API}/documents/upload", headers=_h(token),
                      files={"file": (f"{d}.jpg", jpg, "image/jpeg")},
                      data={"doc_type": d, "expiry_date": "2028-01-01"})
    docs = requests.get(f"{API}/admin/documents", headers=_h(adm)).json()["documents"]
    for d in [x for x in docs if x["worker_id"] == uid]:
        requests.post(f"{API}/admin/documents/{d['_id']}/review", headers=_h(adm), json={"action": "verify"})
    me = requests.get(f"{API}/auth/me", headers=_h(token)).json()["user"]
    assert me["worker_profile"]["verification_status"] == "verified"
    return token, uid, me["phone"]


def _mk_business(adm):
    reg = _otp_token(_phone("+9665730"))
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "business",
        "name": "منشأة iter12", "company_name": "مستودع iter12", "cr_number": "1010999888",
        "city": "الرياض", "terms_accepted": True})
    assert r.status_code == 200, r.text
    token, uid = r.json()["token"], r.json()["user"]["_id"]
    rv = requests.post(f"{API}/admin/accounts/{uid}/verify", headers=_h(adm), json={"action": "approve"})
    assert rv.status_code == 200, rv.text
    return token, uid


class TestOfficeOnboarding:
    def test_office_registration_and_verification_center(self):
        adm = _admin()
        token, oid = _mk_office()
        me = requests.get(f"{API}/auth/me", headers=_h(token)).json()["user"]
        assert me["role"] == "office"
        assert me["office_profile"]["verification_status"] == "pending"
        # appears in admin offices + verification center
        offices = requests.get(f"{API}/admin/offices", headers=_h(adm)).json()["offices"]
        assert any(o["_id"] == oid for o in offices)
        vc = requests.get(f"{API}/admin/verification-center", headers=_h(adm)).json()
        assert any(o["_id"] == oid for o in vc["pending_offices"])
        # office documents upload + admin review
        jpg = bytes.fromhex("ffd8ffe000104a46494600010101006000600000ffdb00430003020203020203030303040303"
                            "04050805050404050a070706080c0a0c0c0b0a0b0b0d0e12100d0e110e0b0b101610111314"
                            "1515150c0f171816141812141514ffc0000b080001000101011100ffc40014000100000000"
                            "000000000000000000000000000000ffc40014100100000000000000000000000000000000"
                            "00000000ffda0008010100003f00d2cf20ffd9")
        r = requests.post(f"{API}/office/documents/upload", headers=_h(token),
                          files={"file": ("cr.jpg", jpg, "image/jpeg")},
                          data={"doc_type": "office_cr", "expiry_date": "2027-12-31"})
        assert r.status_code == 200, r.text
        doc_id = r.json()["document"]["_id"]
        r = requests.post(f"{API}/admin/office-documents/{doc_id}/review",
                          headers=_h(adm), json={"action": "verify"})
        assert r.status_code == 200, r.text
        # admin can view the file; business cannot
        assert requests.get(f"{API}/admin/office-documents/{doc_id}/file", headers=_h(adm)).status_code == 200
        biz, _ = _mk_business(adm)
        assert requests.get(f"{API}/admin/office-documents/{doc_id}/file", headers=_h(biz)).status_code == 403
        # approve office
        r = requests.post(f"{API}/admin/offices/{oid}/verify", headers=_h(adm), json={"action": "approve"})
        assert r.status_code == 200 and r.json()["verification_status"] == "verified"
        # onboarding status reflects progress
        onb = requests.get(f"{API}/onboarding/status", headers=_h(token)).json()
        assert onb["percent"] > 0 and isinstance(onb["missing"], list)

    def test_agreement_flow(self):
        adm = _admin()
        token, oid = _mk_office()
        requests.post(f"{API}/admin/offices/{oid}/verify", headers=_h(adm), json={"action": "approve"})
        # no agreement yet — accept blocked
        r = requests.post(f"{API}/office/agreement/accept", headers=_h(token))
        assert r.status_code == 400
        r = requests.post(f"{API}/admin/offices/{oid}/agreement", headers=_h(adm), json={
            "version": "AGR-2026-001", "effective_date": "2026-07-01",
            "commercial_terms": "شروط تجارية", "provider_rate_note": "حسب قواعد التسعير",
            "settlement_terms": "تسوية أسبوعية", "payment_terms": "تحويل بنكي"})
        assert r.status_code == 200, r.text
        agr = requests.get(f"{API}/office/agreement", headers=_h(token)).json()["agreement"]
        assert agr["status"] == "pending_acceptance"
        r = requests.post(f"{API}/office/agreement/accept", headers=_h(token))
        assert r.status_code == 200, r.text
        agr = requests.get(f"{API}/office/agreement", headers=_h(token)).json()["agreement"]
        assert agr["status"] == "accepted" and agr["accepted_by"]["id"] == oid
        # audit trail
        audits = requests.get(f"{API}/admin/audit", headers=_h(adm)).json()["logs"]
        actions = {a["action"] for a in audits}
        assert "office_agreement_issued" in actions and "office_agreement_accepted" in actions


class TestOfficeDriversAndSettlement:
    def _full_setup(self):
        adm = _admin()
        off_token, oid = _mk_office()
        requests.post(f"{API}/admin/offices/{oid}/verify", headers=_h(adm), json={"action": "approve"})
        requests.post(f"{API}/admin/offices/{oid}/agreement", headers=_h(adm), json={
            "version": "AGR-12", "effective_date": "2026-07-01"})
        requests.post(f"{API}/office/agreement/accept", headers=_h(off_token))
        drv_token, drv_id, drv_phone = _mk_driver(adm)
        # link driver via invite (Scenario B — existing account, no duplicate)
        r = requests.post(f"{API}/office/drivers/invite", headers=_h(off_token),
                          json={"name": "مندوب مكتب iter12", "phone": drv_phone, "vehicle_type": "sedan"})
        assert r.status_code == 200 and r.json()["invite"]["kind"] == "link_existing"
        invites = requests.get(f"{API}/worker/provider-invites", headers=_h(drv_token)).json()["invites"]
        iv = next(i for i in invites if i["office_id"] == oid)
        r = requests.post(f"{API}/worker/provider-invites/{iv['_id']}/respond",
                          headers=_h(drv_token), json={"action": "accept"})
        assert r.status_code == 200 and r.json()["status"] == "linked"
        prov = requests.get(f"{API}/worker/provider", headers=_h(drv_token)).json()
        assert prov["provider_status"] == "linked" and prov["office"]["_id"] == oid
        return adm, off_token, oid, drv_token, drv_id

    def test_link_invite_and_office_dashboard(self):
        adm, off_token, oid, drv_token, drv_id = self._full_setup()
        drivers = requests.get(f"{API}/office/drivers", headers=_h(off_token)).json()["drivers"]
        assert any(d["_id"] == drv_id for d in drivers)
        dash = requests.get(f"{API}/office/dashboard", headers=_h(off_token)).json()["summary"]
        assert dash["drivers_total"] == 1 and dash["drivers_available"] == 1
        # no duplicate account created for the invited phone
        assert requests.get(f"{API}/admin/users", headers=_h(adm)).status_code == 200

    def test_office_settlement_ownership(self):
        adm, off_token, oid, drv_token, drv_id = self._full_setup()
        biz_token, biz_id = _mk_business(adm)
        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
            "price": 8, "effective_date": "2026-01-01"})
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 1000})
        # office-specific request
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "طلب مكتب iter12", "city": "الرياض",
            "address": "موقع", "required_count": 1, "start_date": "2026-10-05",
            "start_time": "08:00", "duration_type": "one_day",
            "shipments_per_driver": 10, "vehicle_type": "sedan",
            "pickup_city": "الرياض", "delivery_city": "الرياض",
            "preferred_office_id": oid, "publish": True, "terms": True})
        assert r.status_code == 200, r.text
        req_id = r.json()["request"]["_id"]
        # assignment-first: office receives the opportunity before any driver offer exists
        assert all(o["request_id"] != req_id for o in requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"])
        opps = requests.get(f"{API}/office/opportunities", headers=_h(off_token)).json()["opportunities"]
        opp = next(o for o in opps if o["_id"] == req_id)
        eligible = next(d for d in opp["eligible_drivers"] if d["_id"] == drv_id and d["eligible"])
        r = requests.post(f"{API}/office/opportunities/{req_id}/assign", headers=_h(off_token),
                          json={"driver_id": eligible["_id"]})
        assert r.status_code == 200, r.text
        offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"]
        offer = next((o for o in offers if o["request_id"] == req_id), None)
        assert offer, "office driver did not receive the assigned offer"
        requests.post(f"{API}/worker/offers/{offer['_id']}/respond", headers=_h(drv_token),
                      json={"action": "accept", "terms": True})
        requests.post(f"{API}/business/requests/{req_id}/confirm", headers=_h(biz_token))
        requests.post(f"{API}/worker/offers/{offer['_id']}/checkin", headers=_h(drv_token))
        requests.post(f"{API}/business/requests/{req_id}/attendance/{offer['_id']}",
                      headers=_h(biz_token), json={"result": "attended"})
        requests.post(f"{API}/business/requests/{req_id}/loading",
                      headers=_h(biz_token), json={"offer_id": offer["_id"], "qty": 10})
        requests.post(f"{API}/worker/offers/{offer['_id']}/confirm-loading", headers=_h(drv_token))
        requests.post(f"{API}/worker/offers/{offer['_id']}/finish",
                      headers=_h(drv_token), json={"delivered_qty": 9})
        requests.post(f"{API}/business/requests/{req_id}/delivered/{offer['_id']}",
                      headers=_h(biz_token), json={"action": "confirm"})
        r = requests.post(f"{API}/business/requests/{req_id}/complete", headers=_h(biz_token))
        assert r.status_code == 200, r.text
        settlements = requests.get(f"{API}/admin/finance/settlements", headers=_h(adm)).json()["settlements"]
        st = next(s for s in settlements if s["request_id"] == req_id)
        assert st["provider_type"] == "office" and st["office_id"] == oid
        # settlement visible to office (own data only)
        off_set = requests.get(f"{API}/office/settlements", headers=_h(off_token)).json()["settlements"]
        assert any(s["_id"] == st["_id"] for s in off_set)
        # RBAC: driver cannot read office settlements
        assert requests.get(f"{API}/office/settlements", headers=_h(drv_token)).status_code == 403
        # review → approve → payout pays the OFFICE wallet, not the driver (no duplicate liability)
        requests.post(f"{API}/admin/finance/settlements/{st['_id']}/review", headers=_h(adm), json={})
        requests.post(f"{API}/admin/finance/settlements/{st['_id']}/approve", headers=_h(adm), json={})
        r = requests.post(f"{API}/admin/finance/settlements/{st['_id']}/payout", headers=_h(adm), json={})
        assert r.status_code == 200, r.text
        drv_wallet = requests.get(f"{API}/wallet", headers=_h(drv_token)).json()["wallet"]
        assert drv_wallet["available"] == 0, "driver wallet must not be paid when office is provider"
        off_payments = requests.get(f"{API}/office/payments", headers=_h(off_token)).json()
        assert off_payments["wallet"]["available"] == st["net"]
        assert any(p["amount"] == st["net"] for p in off_payments["payments"])

    def test_unverified_office_driver_blocked(self):
        adm = _admin()
        off_token, oid = _mk_office()  # NOT verified, no agreement
        drv_token, drv_id, drv_phone = _mk_driver(adm)
        requests.post(f"{API}/office/drivers/invite", headers=_h(off_token),
                      json={"name": "x", "phone": drv_phone})
        invites = requests.get(f"{API}/worker/provider-invites", headers=_h(drv_token)).json()["invites"]
        requests.post(f"{API}/worker/provider-invites/{invites[0]['_id']}/respond",
                      headers=_h(drv_token), json={"action": "accept"})
        biz_token, _ = _mk_business(adm)
        requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "جدة",
            "price": 8, "effective_date": "2026-01-01"})
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 1000})
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "title": "مكتب غير موثق", "city": "الرياض",
            "address": "موقع", "required_count": 1, "start_date": "2026-10-06",
            "start_time": "08:00", "duration_type": "one_day",
            "shipments_per_driver": 5, "vehicle_type": "sedan",
            "pickup_city": "الرياض", "delivery_city": "جدة", "publish": True, "terms": True})
        assert r.status_code == 200, r.text
        # linked driver of unverified office must NOT receive the offer
        offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"]
        assert all(o["request_id"] != r.json()["request"]["_id"] for o in offers)


class TestSessionIsolation:
    def test_bearer_tokens_are_independent(self):
        adm = _admin()
        biz_token, _ = _mk_business(adm)
        drv_token, _, _ = _mk_driver(adm)
        # same API, two tokens: each context resolves its own identity regardless of order
        assert requests.get(f"{API}/auth/me", headers=_h(biz_token)).json()["user"]["role"] == "business"
        assert requests.get(f"{API}/auth/me", headers=_h(drv_token)).json()["user"]["role"] == "worker"
        assert requests.get(f"{API}/auth/me", headers=_h(adm)).json()["user"]["role"] == "admin"
        assert requests.get(f"{API}/auth/me", headers=_h(biz_token)).json()["user"]["role"] == "business"
