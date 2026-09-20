"""Iteration 15 — New platform features: custody, complaints, smart assignment,
driver replacement with history, SLA tracking, company API keys, settlement batches."""
import uuid
import requests

API = "http://localhost:8001/api"
ADM = None


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _otp_token(phone):
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
                          json={"email": "emadabuharb1993@gmail.com", "password": "Isnad-Dev-Admin-2026!"})
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


def _uniq_phone():
    return f"+96655{uuid.uuid4().int % 10**7:07d}"


def _verified_driver(adm, suffix):
    phone = _uniq_phone()
    reg = _otp_token(phone)
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "worker",
        "name": f"مندوب iter15 {suffix}", "city": "الرياض",
        "services": ["delivery_driver"], "vehicle_type": "sedan", "terms_accepted": True})
    assert r.status_code == 200, r.text
    drv = r.json()["token"]
    uid = r.json()["user"]["_id"]
    for d in ["national_id", "driving_license", "vehicle_registration"]:
        r = requests.post(f"{API}/documents/upload", headers=_h(drv),
                          files={"file": (f"{d}.jpg", _jpg(), "image/jpeg")},
                          data={"doc_type": d, "expiry_date": "2028-01-01"})
        assert r.status_code == 200, f"upload {d}: {r.text}"
    docs = requests.get(f"{API}/admin/documents", headers=_h(adm)).json()["documents"]
    for d in [x for x in docs if x["worker_id"] == uid]:
        r = requests.post(f"{API}/admin/documents/{d['_id']}/review", headers=_h(adm), json={"action": "verify"})
        assert r.status_code == 200, r.text
    me = requests.get(f"{API}/auth/me", headers=_h(drv)).json()
    assert me["user"]["worker_profile"]["verification_status"] == "verified", me
    return drv, uid


def _business(suffix):
    phone = _uniq_phone()
    reg = _otp_token(phone)
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "business",
        "name": f"منشأة iter15 {suffix}", "city": "الرياض",
        "company_name": f"شركة iter15 {suffix}", "cr_number": f"1010{suffix[:6].ljust(6, '0')}",
        "industry": "logistics", "terms_accepted": True})
    assert r.status_code == 200, r.text
    biz = r.json()["token"]
    uid = r.json()["user"]["_id"]
    r = requests.post(f"{API}/admin/accounts/{uid}/verify", headers=_h(_admin()), json={"action": "approve"})
    assert r.status_code == 200, r.text
    return biz, uid


def _publish_request(biz_token, suffix, publish=True):
    adm = _admin()
    requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
        "price": 8, "effective_date": "2026-01-01", "version": f"IT15-{suffix}"})
    requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": 2000})
    r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json={
        "service_type": "delivery_driver", "title": f"طلب iter15 {suffix}", "city": "الرياض",
        "address": "مستودع الاختبار", "required_count": 1, "start_date": "2027-01-15",
        "start_time": "08:00", "duration_type": "one_day", "days_count": 1,
        "shipments_per_driver": 20, "vehicle_type": "sedan",
        "pickup_city": "الرياض", "delivery_city": "الرياض",
        "publish": publish, "terms": True})
    assert r.status_code == 200, r.text
    return r.json()["request"]["_id"]


def test_custody_flow():
    suffix = uuid.uuid4().hex[:5]
    adm = _admin()
    biz, _ = _business(suffix + "b")
    drv, drv_id = _verified_driver(adm, suffix + "d")
    req_id = _publish_request(biz, suffix)

    offers = requests.get(f"{API}/worker/offers", headers=_h(drv)).json()["offers"]
    offer = next((o for o in offers if o["request_id"] == req_id), None)
    assert offer, "driver did not receive the offer"
    oid = offer["_id"]
    r = requests.post(f"{API}/worker/offers/{oid}/respond", headers=_h(drv), json={"action": "accept", "terms": True})
    assert r.status_code == 200, r.text
    requests.post(f"{API}/business/requests/{req_id}/confirm", headers=_h(biz))
    r = requests.post(f"{API}/worker/offers/{oid}/checkin", headers=_h(drv))
    assert r.status_code == 200, r.text

    # warehouse hands over custody items
    r = requests.post(f"{API}/custody/handover", headers=_h(biz), json={
        "offer_id": oid, "items": [{"type": "pos_device", "qty": 1}, {"type": "charger", "qty": 1}]})
    assert r.status_code == 200, r.text
    cid = r.json()["custody"]["_id"]

    # duplicate active custody blocked
    r = requests.post(f"{API}/custody/handover", headers=_h(biz), json={
        "offer_id": oid, "items": [{"type": "phone", "qty": 1}]})
    assert r.status_code == 400, r.text

    # driver sees pending custody and confirms receipt
    lst = requests.get(f"{API}/custody/offer/{oid}", headers=_h(drv)).json()["custody"]
    assert lst and lst[0]["status"] == "pending_confirm"
    r = requests.post(f"{API}/custody/{cid}/confirm", headers=_h(drv))
    assert r.status_code == 200, r.text

    # warehouse records return: one damaged
    r = requests.post(f"{API}/custody/{cid}/return", headers=_h(biz), json={
        "items": [{"index": 0, "status": "returned"}, {"index": 1, "status": "damaged", "note": "شاشة مكسورة"}]})
    assert r.status_code == 200 and r.json()["status"] == "issue", r.text

    # custody visible in admin report
    rep = requests.get(f"{API}/admin/reports/custody", headers=_h(adm)).json()
    row = next((x for x in rep["rows"] if x["id"] == cid), None)
    assert row and row["issues"] == 1

    # RBAC: another driver cannot view this custody
    drv2, _ = _verified_driver(adm, suffix + "e")
    r = requests.get(f"{API}/custody/offer/{oid}", headers=_h(drv2))
    assert r.status_code == 403, r.text


def test_complaints_flow():
    suffix = uuid.uuid4().hex[:5]
    adm = _admin()
    biz, biz_id = _business(suffix + "b")
    drv, drv_id = _verified_driver(adm, suffix + "d")
    req_id = _publish_request(biz, suffix)
    offers = requests.get(f"{API}/worker/offers", headers=_h(drv)).json()["offers"]
    offer = next(o for o in offers if o["request_id"] == req_id)

    # driver files complaint linked to the job
    r = requests.post(f"{API}/complaints", headers=_h(drv), json={
        "request_id": req_id, "offer_id": offer["_id"], "category": "delay",
        "subject": "تأخر تجهيز المستودع", "description": "انتظرت ساعتين"})
    assert r.status_code == 200, r.text
    cid = r.json()["complaint"]["_id"]

    # non-party cannot create complaint on this request
    drv2, _ = _verified_driver(adm, suffix + "x")
    r = requests.post(f"{API}/complaints", headers=_h(drv2), json={
        "request_id": req_id, "category": "other", "subject": "x", "description": "y"})
    assert r.status_code == 403, r.text

    # admin lists, assigns, notes, resolves
    lst = requests.get(f"{API}/complaints", headers=_h(adm)).json()["complaints"]
    assert any(c["_id"] == cid for c in lst)
    r = requests.post(f"{API}/complaints/{cid}/assign", headers=_h(adm), json={"staff_id": adm and "u_admin"})
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/complaints/{cid}/notes", headers=_h(adm), json={"text": "قيد المتابعة"})
    assert r.status_code == 200, r.text
    # resolve requires resolution
    r = requests.post(f"{API}/complaints/{cid}/status", headers=_h(adm), json={"status": "resolved"})
    assert r.status_code == 400, r.text
    r = requests.post(f"{API}/complaints/{cid}/status", headers=_h(adm),
                      json={"status": "resolved", "resolution": "تم تعويض المندوب"})
    assert r.status_code == 200, r.text
    # full history preserved
    mine = requests.get(f"{API}/complaints", headers=_h(drv)).json()["complaints"]
    c = next(x for x in mine if x["_id"] == cid)
    assert c["status"] == "resolved" and c["resolution"] == "تم تعويض المندوب"
    assert len(c["history"]) >= 3


def test_smart_assignment_and_replacement():
    suffix = uuid.uuid4().hex[:5]
    adm = _admin()
    biz, _ = _business(suffix + "b")
    # register driver but verify only AFTER publishing, so he isn't pre-offered
    phone = _uniq_phone()
    reg = _otp_token(phone)
    r = requests.post(f"{API}/auth/register", headers=_h(reg["registration_token"]), json={
        "registration_token": reg["registration_token"], "role": "worker",
        "name": f"مندوب iter15 {suffix}d", "city": "الرياض",
        "services": ["delivery_driver"], "vehicle_type": "sedan", "terms_accepted": True})
    assert r.status_code == 200, r.text
    drv, drv_id = r.json()["token"], r.json()["user"]["_id"]
    req_id = _publish_request(biz, suffix)
    # now verify the driver
    for d in ["national_id", "driving_license", "vehicle_registration"]:
        r = requests.post(f"{API}/documents/upload", headers=_h(drv),
                          files={"file": (f"{d}.jpg", _jpg(), "image/jpeg")},
                          data={"doc_type": d, "expiry_date": "2028-01-01"})
        assert r.status_code == 200, r.text
    docs = requests.get(f"{API}/admin/documents", headers=_h(adm)).json()["documents"]
    for d in [x for x in docs if x["worker_id"] == drv_id]:
        requests.post(f"{API}/admin/documents/{d['_id']}/review", headers=_h(adm), json={"action": "verify"})
    r = requests.get(f"{API}/admin/requests/{req_id}/smart-suggest", headers=_h(adm))
    assert r.status_code == 200, r.text
    sugg = r.json()["suggestions"]
    entry = next((s for s in sugg if s["driver"]["_id"] == drv_id), None)
    assert entry and entry["eligible"] and entry["score"] > 0
    assert entry["driver"]["affiliation"] == "platform"

    # admin assigns via suggestion → driver accepts → admin replaces with history
    r = requests.post(f"{API}/admin/requests/{req_id}/match", headers=_h(adm), json={"worker_id": drv_id})
    assert r.status_code == 200, r.text
    offers = requests.get(f"{API}/worker/offers", headers=_h(drv)).json()["offers"]
    offer = next(o for o in offers if o["request_id"] == req_id)
    requests.post(f"{API}/worker/offers/{offer['_id']}/respond", headers=_h(drv),
                  json={"action": "accept", "terms": True})
    r = requests.post(f"{API}/admin/offers/{offer['_id']}/replace", headers=_h(adm),
                      json={"reason": "اختبار الاستبدال"})
    assert r.status_code == 200, r.text
    det = requests.get(f"{API}/admin/requests/{req_id}", headers=_h(adm)).json()
    actions = [h["action"] for h in det["assignment_history"]]
    assert "assigned" in actions and "accepted" in actions and "replaced" in actions


def test_company_api_keys_and_v1():
    suffix = uuid.uuid4().hex[:5]
    biz, _ = _business(suffix + "b")
    adm = _admin()
    requests.post(f"{API}/admin/pricing/rules", headers=_h(adm), json={
        "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض",
        "price": 8, "effective_date": "2026-01-01", "version": f"IT15API-{suffix}"})
    requests.post(f"{API}/business/wallet/topup", headers=_h(biz), json={"amount": 2000})

    # create key
    r = requests.post(f"{API}/business/api-keys", headers=_h(biz), json={"name": "ERP"})
    assert r.status_code == 200, r.text
    raw = r.json()["api_key"]
    assert raw.startswith("jrk_")
    keys = requests.get(f"{API}/business/api-keys", headers=_h(biz)).json()["keys"]
    assert not any("key_hash" in k for k in keys)  # hash never leaked

    # unauthenticated rejected
    assert requests.get(f"{API}/v1/jobs").status_code == 401
    assert requests.get(f"{API}/v1/jobs", headers={"X-API-Key": "jrk_wrong"}).status_code == 401

    # create job via API
    r = requests.post(f"{API}/v1/jobs", headers={"X-API-Key": raw}, json={
        "service_type": "delivery_driver", "title": f"API job {suffix}", "city": "الرياض",
        "address": "مستودع API", "required_count": 1, "start_date": "2027-02-01",
        "start_time": "09:00", "duration_type": "one_day", "shipments_per_driver": 10,
        "vehicle_type": "sedan", "pickup_city": "الرياض", "delivery_city": "الرياض", "publish": True})
    assert r.status_code == 201, r.text
    job_id = r.json()["job"]["id"]
    assert r.json()["job"]["created_via"] == "api"

    # status polling
    r = requests.get(f"{API}/v1/jobs/{job_id}", headers={"X-API-Key": raw})
    assert r.status_code == 200 and r.json()["job"]["status"] == "published", r.text
    r = requests.get(f"{API}/v1/jobs/{job_id}/events", headers={"X-API-Key": raw})
    assert r.status_code == 200 and len(r.json()["events"]) >= 1, r.text

    # api calls are logged
    logs_count = requests.get(f"{API}/business/api-keys", headers=_h(biz)).json()["total_calls"]
    assert logs_count >= 3

    # revoke → key stops working
    kid = keys[0]["_id"]
    requests.post(f"{API}/business/api-keys/{kid}/revoke", headers=_h(biz))
    assert requests.get(f"{API}/v1/jobs", headers={"X-API-Key": raw}).status_code == 401


def test_settlement_period_and_sla_report():
    adm = _admin()
    # settlement period configurable weekly/monthly
    r = requests.patch(f"{API}/admin/settings", headers=_h(adm), json={"settlement_period": "monthly"})
    assert r.status_code == 200, r.text
    assert r.json()["settings"]["settlement_period"] == "monthly"
    r = requests.patch(f"{API}/admin/settings", headers=_h(adm), json={"settlement_period": "weekly"})
    assert r.status_code == 200, r.text
    r = requests.patch(f"{API}/admin/settings", headers=_h(adm), json={"settlement_period": "daily"})
    assert r.status_code == 400, r.text

    # SLA report present with computed statuses
    rep = requests.get(f"{API}/admin/reports/sla", headers=_h(adm)).json()
    assert rep["report"] == "sla"
    if rep["rows"]:
        assert "start_sla" in rep["rows"][0] and "end_sla" in rep["rows"][0]

    # platform financial separation fields
    pf = requests.get(f"{API}/admin/finance/platform", headers=_h(adm)).json()
    for k in ("customer_payments", "platform_fees", "office_earnings_paid",
              "driver_earnings_paid", "settlement_period", "pending_batches"):
        assert k in pf

    # batch endpoint guards empty approved queue
    r = requests.post(f"{API}/admin/finance/payouts/run-batch", headers=_h(adm), json={})
    assert r.status_code in (200, 400), r.text
    batches = requests.get(f"{API}/admin/finance/payouts/batches", headers=_h(adm)).json()
    assert "batches" in batches
