"""Iteration 14 — production office assignment, privacy, profile, communication, reports."""
import os

import requests

from test_iteration12 import _admin, _h, _mk_business, _mk_driver, _mk_office

API = os.environ.get("API_URL", "http://localhost:8001/api")


def _link_driver(off_token, drv_token, drv_phone, name="مندوب المكتب"):
    r = requests.post(f"{API}/office/drivers/invite", headers=_h(off_token),
                      json={"name": name, "phone": drv_phone})
    assert r.status_code == 200, r.text
    invites = requests.get(f"{API}/worker/provider-invites", headers=_h(drv_token)).json()["invites"]
    invite = next(i for i in invites if i["phone"] == drv_phone)
    r = requests.post(f"{API}/worker/provider-invites/{invite['_id']}/respond",
                      headers=_h(drv_token), json={"action": "accept"})
    assert r.status_code == 200, r.text


def _ready_office(adm, provider_rate=None):
    off_token, oid = _mk_office()
    assert requests.post(f"{API}/admin/offices/{oid}/verify", headers=_h(adm),
                         json={"action": "approve"}).status_code == 200
    payload = {"version": "AGR-14", "effective_date": "2026-07-01",
               "commercial_terms": "شروط تجارية", "settlement_terms": "أسبوعية",
               "payment_terms": "تحويل بنكي", "cancellation_rules": "حسب السياسة",
               "no_show_rules": "حسب السياسة", "replacement_rules": "المكتب مسؤول",
               "responsibilities": "المندوب والمركبة", "data_protection": "سرية البيانات"}
    if provider_rate is not None:
        payload["provider_rate"] = provider_rate
    r = requests.post(f"{API}/admin/offices/{oid}/agreement", headers=_h(adm), json=payload)
    assert r.status_code == 200, r.text
    assert requests.post(f"{API}/office/agreement/accept", headers=_h(off_token)).status_code == 200
    return off_token, oid


def _office_request(biz_token, oid, title, vehicle="sedan", temp=None, date="2026-12-10"):
    r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
        "service_type": "delivery_driver", "title": title, "city": "الرياض",
        "address": "مستودع الرياض", "required_count": 1, "start_date": date,
        "start_time": "08:00", "duration_type": "one_day", "shipments_per_driver": 10,
        "vehicle_type": vehicle, "temperature_type": temp, "pickup_city": "الرياض",
        "delivery_city": "الرياض", "requirements": "تعليمات تشغيلية",
        "preferred_office_id": oid, "publish": True, "terms": True})
    assert r.status_code == 200, r.text
    return r.json()["request"]["_id"]


def test_office_profile_fields_are_central_and_editable():
    off_token, oid = _mk_office()
    payload = {"email": "office14@example.com", "city": "الرياض",
               "company_name": "مكتب توصيل iter14", "responsible_person": "مدير التشغيل",
               "address": "حي العليا، طريق الملك فهد", "bank_name": "مصرف الراجحي",
               "iban": "SA0380000000608010167519", "tax_number": "300123456700003",
               "compliance_notes": "مرخص ومتوافق"}
    r = requests.patch(f"{API}/profile", headers=_h(off_token), json=payload)
    assert r.status_code == 200, r.text
    me = requests.get(f"{API}/auth/me", headers=_h(off_token)).json()["user"]
    assert me["_id"] == oid and me["email"] == payload["email"]
    op = me["office_profile"]
    assert op["address"] == payload["address"] and op["iban"] == payload["iban"]
    assert op["tax_number"] == payload["tax_number"]
    onb = requests.get(f"{API}/onboarding/status", headers=_h(off_token)).json()
    assert "الآيبان" not in onb["missing"] and "العنوان" not in onb["missing"]


def test_office_assignment_privacy_provider_settlement_and_chat():
    adm = _admin()
    off_token, oid = _ready_office(adm, provider_rate=6.5)
    drv_token, drv_id, drv_phone = _mk_driver(adm)
    _link_driver(off_token, drv_token, drv_phone)
    biz_token, _ = _mk_business(adm)
    assert requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
        "price": 8, "effective_date": "2026-01-01", "version": "ITER14"}).status_code == 200
    requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 1000})
    req_id = _office_request(biz_token, oid, "فرصة مكتب iter14")

    offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"]
    assert all(o["request_id"] != req_id for o in offers), "assignment-first must not broadcast immediately"
    opps = requests.get(f"{API}/office/opportunities", headers=_h(off_token)).json()["opportunities"]
    opp = next(o for o in opps if o["_id"] == req_id)
    assert opp["business"] and opp["provider_amount_estimate"] == 65
    assert next(d for d in opp["eligible_drivers"] if d["_id"] == drv_id)["eligible"]
    r = requests.post(f"{API}/office/opportunities/{req_id}/assign", headers=_h(off_token),
                      json={"driver_id": drv_id})
    assert r.status_code == 200, r.text

    offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"]
    offer = next(o for o in offers if o["request_id"] == req_id)
    forbidden = {"expected_earning", "estimated_total", "rate", "commission", "commission_rate",
                 "pricing_snapshot", "pricing_version", "payout_total"}
    assert not forbidden & set(offer["request"].keys())
    assert "earning" not in offer
    requests.post(f"{API}/worker/offers/{offer['_id']}/respond", headers=_h(drv_token),
                  json={"action": "accept", "terms": True})
    requests.post(f"{API}/business/requests/{req_id}/confirm", headers=_h(biz_token))
    requests.post(f"{API}/worker/offers/{offer['_id']}/checkin", headers=_h(drv_token))
    requests.post(f"{API}/business/requests/{req_id}/attendance/{offer['_id']}",
                  headers=_h(biz_token), json={"result": "attended"})
    requests.post(f"{API}/business/requests/{req_id}/loading", headers=_h(biz_token),
                  json={"offer_id": offer["_id"], "qty": 10})
    requests.post(f"{API}/worker/offers/{offer['_id']}/confirm-loading", headers=_h(drv_token))
    requests.post(f"{API}/worker/offers/{offer['_id']}/finish", headers=_h(drv_token),
                  json={"delivered_qty": 9})
    requests.post(f"{API}/business/requests/{req_id}/delivered/{offer['_id']}",
                  headers=_h(biz_token), json={"action": "confirm"})
    assert requests.post(f"{API}/business/requests/{req_id}/complete", headers=_h(biz_token)).status_code == 200

    settlements = requests.get(f"{API}/admin/finance/settlements", headers=_h(adm)).json()["settlements"]
    st = next(s for s in settlements if s["request_id"] == req_id)
    assert st["office_id"] == oid and st["provider_amount"] == 58.5 and st["net"] == 58.5
    office_set = requests.get(f"{API}/office/settlements", headers=_h(off_token)).json()["settlements"]
    office_st = next(s for s in office_set if s["_id"] == st["_id"])
    assert office_st["provider_amount"] == 58.5
    assert not {"gross", "commission", "rate", "commission_rate", "pricing_version"} & set(office_st.keys())

    assert requests.get(f"{API}/jobs/{offer['_id']}/messages", headers=_h(off_token)).status_code == 200
    r = requests.post(f"{API}/jobs/{offer['_id']}/messages", headers=_h(off_token),
                      json={"text": "المكتب يتابع التنفيذ"})
    assert r.status_code == 200, r.text
    messages = requests.get(f"{API}/jobs/{offer['_id']}/messages", headers=_h(drv_token)).json()["messages"]
    assert any(m["sender_id"] == oid for m in messages)

    requests.post(f"{API}/admin/finance/settlements/{st['_id']}/review", headers=_h(adm), json={})
    requests.post(f"{API}/admin/finance/settlements/{st['_id']}/approve", headers=_h(adm), json={})
    assert requests.post(f"{API}/admin/finance/settlements/{st['_id']}/payout", headers=_h(adm), json={}).status_code == 200
    report = requests.get(f"{API}/office/reports", headers=_h(off_token)).json()["summary"]
    assert report["paid_amount"] == 58.5 and report["completed_jobs"] >= 1


def test_office_assignment_eligibility_and_fallback_broadcast():
    adm = _admin()
    off_token, oid = _ready_office(adm)
    drv_token, drv_id, drv_phone = _mk_driver(adm)
    _link_driver(off_token, drv_token, drv_phone)
    biz_token, _ = _mk_business(adm)
    requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "vehicle_type": "van", "temperature_type": "cold", "pickup_city": "الرياض",
        "delivery_city": "الرياض", "price": 10, "effective_date": "2026-01-01"})
    requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 1000})
    req_id = _office_request(biz_token, oid, "مركبة غير متوافقة", vehicle="van", temp="cold", date="2026-12-11")
    opps = requests.get(f"{API}/office/opportunities", headers=_h(off_token)).json()["opportunities"]
    opp = next(o for o in opps if o["_id"] == req_id)
    driver = next(d for d in opp["eligible_drivers"] if d["_id"] == drv_id)
    assert not driver["eligible"] and any("المركبة" in x for x in driver["reasons"])
    r = requests.post(f"{API}/office/opportunities/{req_id}/assign", headers=_h(off_token),
                      json={"driver_id": drv_id})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "DRIVER_NOT_ELIGIBLE"

    # A compatible direct request can still be broadcast as the office fallback path.
    requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
        "price": 8, "effective_date": "2026-01-01", "version": "ITER14-FALLBACK"})
    req2 = _office_request(biz_token, oid, "تعميم مكتب iter14", date="2026-12-12")
    r = requests.post(f"{API}/office/opportunities/{req2}/broadcast", headers=_h(off_token))
    assert r.status_code == 200 and r.json()["matched"] == 1
    offers = requests.get(f"{API}/worker/offers", headers=_h(drv_token)).json()["offers"]
    assert any(o["request_id"] == req2 for o in offers)
