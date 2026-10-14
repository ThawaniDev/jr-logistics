"""Iteration 16 — Finalization: approval gates, per-business pricing rules,
vehicle categories (Dokker/Hiace/Van/Dyna dry+refrigerated), vehicle-only service,
pricing snapshot immutability, admin password reset."""
import uuid
import requests

API = "http://localhost:8001/api"
ADM = None


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _otp(phone):
    r = requests.post(f"{API}/auth/otp/send", json={"phone": phone})
    assert r.status_code == 200, r.text
    code = r.json()["demo_otp"]
    r = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
    assert r.status_code == 200, r.text
    return r.json()


def _admin():
    global ADM
    if not ADM:
        r = requests.post(f"{API}/auth/admin/login",
                          json={"email": "emadabuharb1993@gmail.com", "password": "Ee6211673"})
        assert r.status_code == 200, r.text
        ADM = r.json()["token"]
    return ADM


def _jpg():
    return bytes.fromhex(
        "FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F"
        "141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432FFDB0043010909090C0B0C180D0D"
        "1832211C2132323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232"
        "32323232323232FFC00011080001000103012200021101031101FFC4001400010000000000000000000000000000000000000008FF"
        "C4001410010000000000000000000000000000000000000000FFDA000C03010002110311003F00B2C001FFD9")


def _uniq():
    return f"+96655{uuid.uuid4().int % 10**7:07d}"


def _register(role, name, **extra):
    phone = _uniq()
    reg = _otp(phone)
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": role, "name": name,
        "city": "الرياض", "terms_accepted": True, **extra})
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"]["_id"]


def _verified_driver(vehicle="sedan"):
    tok, uid = _register("worker", f"مندوب16 {uuid.uuid4().hex[:4]}",
                         services=["delivery_driver"], vehicle_type=vehicle)
    for d in ["national_id", "driving_license", "vehicle_registration"]:
        r = requests.post(f"{API}/documents/upload", headers=_h(tok),
                          files={"file": (f"{d}.jpg", _jpg(), "image/jpeg")},
                          data={"doc_type": d, "expiry_date": "2028-01-01"})
        assert r.status_code == 200, r.text
    docs = requests.get(f"{API}/admin/documents", headers=_h(_admin())).json()["documents"]
    for d in [x for x in docs if x["worker_id"] == uid]:
        requests.post(f"{API}/admin/documents/{d['_id']}/review", headers=_h(_admin()), json={"action": "verify"})
    me = requests.get(f"{API}/auth/me", headers=_h(tok)).json()
    assert me["user"]["worker_profile"]["verification_status"] == "verified"
    return tok, uid


def _request_payload(**over):
    base = {"service_type": "delivery_driver", "title": "طلب16", "city": "الرياض",
            "address": "مستودع", "required_count": 1, "start_date": "2027-03-01",
            "start_time": "08:00", "duration_type": "one_day", "shipments_per_driver": 15,
            "vehicle_type": "dokker", "pickup_city": "الرياض", "delivery_city": "الرياض",
            "publish": True, "terms": True}
    return {**base, **over}


def test_business_approval_gate_and_pricing_requirement():
    adm = _admin()
    biz, uid = _register("business", f"منشأة16 {uuid.uuid4().hex[:4]}",
                         company_name="شركة 16", cr_number="1010999916", industry="logistics")

    # 1. pending business cannot publish
    requests.post(f"{API}/business/wallet/topup", headers=_h(biz), json={"amount": 5000})
    r = requests.post(f"{API}/business/requests", headers=_h(biz), json=_request_payload())
    assert r.status_code == 403, r.text
    assert "بانتظار" in r.json()["detail"]

    # 2. admin requests additional info → stays pending, business notified
    r = requests.post(f"{API}/admin/accounts/{uid}/verify", headers=_h(adm),
                      json={"action": "request_info", "reason": "أرفق السجل التجاري المحدث"})
    assert r.status_code == 200 and r.json()["verification_status"] == "pending", r.text
    notifs = requests.get(f"{API}/notifications", headers=_h(biz)).json()["notifications"]
    assert any("معلومات إضافية" in n["title"] for n in notifs)

    # 3. approve business — but no pricing rule yet → publish still blocked
    # (route الرياض→جدة has no global rule, so this isolates the gate)
    r = requests.post(f"{API}/admin/accounts/{uid}/verify", headers=_h(adm), json={"action": "approve"})
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/business/requests", headers=_h(biz),
                      json=_request_payload(delivery_city="جدة"))
    assert r.status_code == 400 and "لا يوجد سعر معتمد" in r.json()["detail"], r.text

    # 4. admin configures business-specific pricing rule → publish works
    r = requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "business_id": uid, "vehicle_type": "dokker", "service_type": "delivery_driver",
        "pickup_city": "الرياض", "delivery_city": "جدة", "price": 9,
        "effective_date": "2026-01-01", "expiry_date": "2028-01-01", "version": "AGR-16"})
    assert r.status_code == 200, r.text
    rule_id = r.json()["rule"]["_id"]
    r = requests.post(f"{API}/business/requests", headers=_h(biz),
                      json=_request_payload(delivery_city="جدة"))
    assert r.status_code == 200, r.text
    req = r.json()["request"]
    snap = req["pricing_snapshot"]
    assert snap["rate"] == 9 and snap["pricing_rule_id"] == rule_id and snap["source"] == "pricing_rule"
    return biz, uid, req["_id"], rule_id


def test_pricing_snapshot_immutability():
    biz, uid, req_id, rule_id = test_business_approval_gate_and_pricing_requirement()
    adm = _admin()
    before = requests.get(f"{API}/business/requests/{req_id}", headers=_h(biz)).json()["request"]
    assert before["rate"] == 9 and before["estimated_total"] == 9 * 15 * 1
    # admin changes the price (supersedes the rule)
    r = requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "business_id": uid, "vehicle_type": "dokker", "service_type": "delivery_driver",
        "pickup_city": "الرياض", "delivery_city": "جدة", "price": 12,
        "effective_date": "2026-06-01", "version": "AGR-16b"})
    assert r.status_code == 200, r.text
    # historical request unchanged
    after = requests.get(f"{API}/business/requests/{req_id}", headers=_h(biz)).json()["request"]
    assert after["rate"] == 9 and after["estimated_total"] == 135
    assert after["pricing_snapshot"]["rate"] == 9
    # old rule superseded, history preserved
    rules = requests.get(f"{API}/admin/pricing/rules", headers=_h(adm),
                         params={"business_id": uid}).json()["rules"]
    old = next(x for x in rules if x["_id"] == rule_id)
    assert old["status"] == "superseded"
    # expired rule must not resolve (hiace route جدة has no other rule)
    requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "business_id": uid, "vehicle_type": "hiace",
        "pickup_city": "الرياض", "delivery_city": "جدة", "price": 5,
        "effective_date": "2026-01-01", "expiry_date": "2026-02-01"})
    r = requests.get(f"{API}/business/pricing/quote", headers=_h(biz),
                     params={"vehicle_type": "hiace", "pickup_city": "الرياض", "delivery_city": "جدة"})
    assert r.json()["ok"] is False


def test_driver_approval_gate():
    # unverified driver receives no offers and cannot accept
    tok, uid = _register("worker", f"مندوب16b {uuid.uuid4().hex[:4]}",
                         services=["delivery_driver"], vehicle_type="sedan")
    # verified driver ready BEFORE publishing so matching can reach him
    drv2, _ = _verified_driver()
    biz, buid = _register("business", f"منشأة16b {uuid.uuid4().hex[:4]}",
                          company_name="شركة 16b", cr_number="1010999917", industry="logistics")
    adm = _admin()
    requests.post(f"{API}/admin/accounts/{buid}/verify", headers=_h(adm), json={"action": "approve"})
    requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
        "price": 8, "effective_date": "2026-01-01"})
    requests.post(f"{API}/business/wallet/topup", headers=_h(biz), json={"amount": 2000})
    r = requests.post(f"{API}/business/requests", headers=_h(biz),
                      json=_request_payload(vehicle_type="sedan"))
    assert r.status_code == 200, r.text
    req_id = r.json()["request"]["_id"]
    offers = requests.get(f"{API}/worker/offers", headers=_h(tok)).json()["offers"]
    assert not any(o["request_id"] == req_id for o in offers), "unverified driver got an offer"
    # verified driver DOES get it
    offers2 = requests.get(f"{API}/worker/offers", headers=_h(drv2)).json()["offers"]
    assert any(o["request_id"] == req_id for o in offers2), "verified driver missing offer"


def test_vehicle_categories_supported():
    adm = _admin()
    # all six catalog categories work in pricing rules (van/dyna need temperature)
    biz, buid = _register("business", f"منشأة16c {uuid.uuid4().hex[:4]}",
                          company_name="شركة 16c", cr_number="1010999918", industry="logistics")
    requests.post(f"{API}/admin/accounts/{buid}/verify", headers=_h(adm), json={"action": "approve"})
    for veh, temp in [("sedan", None), ("dokker", None), ("hiace", None),
                      ("van", "dry"), ("van", "cold"), ("dyna", "dry"), ("dyna", "cold")]:
        r = requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
            "vehicle_type": veh, "temperature_type": temp,
            "pickup_city": "الرياض", "delivery_city": "الرياض",
            "price": 10, "effective_date": "2026-01-01"})
        assert r.status_code == 200, f"{veh}/{temp}: {r.text}"
        q = {"vehicle_type": veh, "pickup_city": "الرياض", "delivery_city": "الرياض"}
        if temp:
            q["temperature_type"] = temp
        quote = requests.get(f"{API}/business/pricing/quote", headers=_h(biz), params=q).json()
        assert quote["ok"] and quote["price"] == 10, f"quote {veh}/{temp}: {quote}"
    # van without temperature rejected
    r = requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "vehicle_type": "van", "pickup_city": "الرياض", "delivery_city": "الرياض",
        "price": 10, "effective_date": "2026-01-01"})
    assert r.status_code == 400, r.text


def test_vehicle_only_service_no_driver_assignment():
    adm = _admin()
    biz, buid = _register("business", f"منشأة16d {uuid.uuid4().hex[:4]}",
                          company_name="شركة 16d", cr_number="1010999919", industry="logistics")
    requests.post(f"{API}/admin/accounts/{buid}/verify", headers=_h(adm), json={"action": "approve"})
    # approved price for vehicle-only service
    r = requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "business_id": buid, "vehicle_type": "hiace", "service_type": "car_without_driver",
        "pickup_city": "الرياض", "delivery_city": "الرياض", "price": 250,
        "effective_date": "2026-01-01"})
    assert r.status_code == 200, r.text
    requests.post(f"{API}/business/wallet/topup", headers=_h(biz), json={"amount": 5000})
    r = requests.post(f"{API}/business/requests", headers=_h(biz), json={
        "service_type": "car_without_driver", "title": "حجز هايس بدون سائق", "city": "الرياض",
        "address": "ساحة المستودع", "required_count": 2, "start_date": "2027-03-05",
        "start_time": "09:00", "duration_type": "week",
        "vehicle_type": "hiace", "pickup_city": "الرياض", "delivery_city": "الرياض",
        "publish": True, "terms": True})
    assert r.status_code == 200, r.text
    req = r.json()["request"]
    assert r.json()["matched_workers"] == 0
    assert req["status"] == "confirmed", req["status"]  # straight to confirmed — no driver matching
    assert req["estimated_total"] == 250 * 2 * 7
    # no offers were created anywhere for this request
    detail = requests.get(f"{API}/business/requests/{req['_id']}", headers=_h(biz)).json()
    assert detail["offers"] == []
    # complete → escrow settles to platform rental revenue, request completed
    r = requests.post(f"{API}/business/requests/{req['_id']}/complete", headers=_h(biz))
    assert r.status_code == 200, r.text
    assert r.json()["settlements_created"] == 0
    assert r.json()["rental_total"] == 3500
    detail = requests.get(f"{API}/business/requests/{req['_id']}", headers=_h(biz)).json()
    assert detail["request"]["status"] == "completed"
    assert detail["request"]["settlement_status"] == "settled"


def test_admin_password_reset_login():
    # existing admin authenticates with the reset password, forced change flagged
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": "emadabuharb1993@gmail.com", "password": "Ee6211673"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "admin"
    assert r.json()["user"].get("must_change_password") is True
    # exactly one admin account — repeated logins resolve to the same user id
    tok = r.json()["token"]
    uid1 = r.json()["user"]["_id"]
    r2 = requests.post(f"{API}/auth/admin/login",
                       json={"email": "emadabuharb1993@gmail.com", "password": "Ee6211673"})
    assert r2.status_code == 200 and r2.json()["user"]["_id"] == uid1
    # wrong old password rejected
    r2 = requests.post(f"{API}/auth/admin/login",
                       json={"email": "emadabuharb1993@gmail.com", "password": "wrong-old-password-9"})
    assert r2.status_code in (401, 429)
