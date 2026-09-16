"""Iteration 4 backend tests — insufficient funds, terms enforcement, no-work flow,
tickets (category/priority/escalation/activity), staff CRUD, admin settings compensation,
and full API regression across roles.

Serial-safe. Restores mutated admin settings at end of module.
"""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://tawazon.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


def _otp_login(phone: str) -> dict:
    import time
    last = None
    for _ in range(5):
        r = requests.post(f"{API}/auth/otp/send", json={"phone": phone}, timeout=15)
        if r.status_code != 200:
            last = r
            time.sleep(0.5)
            continue
        code = r.json()["demo_otp"]
        r2 = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code}, timeout=15)
        if r2.status_code == 200:
            return r2.json()
        last = r2
        time.sleep(0.5)
    assert False, f"OTP login failed after retries: {last.text if last else 'no resp'}"


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ------------- Fixtures -------------
@pytest.fixture(scope="module")
def adm_token():
    return _otp_login("+966500000001")["token"]


@pytest.fixture(scope="module")
def biz_token():
    return _otp_login("+966500000101")["token"]


@pytest.fixture(scope="module")
def wrk_token():
    return _otp_login("+966500000201")["token"]


# ============= Health / regression =============
class TestHealth:
    def test_health(self):
        r = requests.get(f"{API}/health")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_otp_login_all_roles(self):
        for phone in ("+966500000001", "+966500000101", "+966500000201"):
            u = _otp_login(phone)
            assert "token" in u and "user" in u
            assert u["user"]["role"] in ("admin", "business", "worker")


# ============= Insufficient funds =============
class TestInsufficientFunds:
    def test_publish_fails_when_over_balance(self, biz_token):
        # Very large request beyond ~21,860 SAR available
        payload = {
            "service_type": "delivery_driver", "city": "الرياض",
            "address": "TEST_iter4_insufficient", "required_count": 20,
            "start_date": "2026-03-01", "start_time": "09:00",
            "duration_type": "one_day", "days_count": 1, "rate": 20,
            "shipments_per_driver": 500, "vehicle_type": "سيدان",
            "publish": True,
        }
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json=payload)
        assert r.status_code == 400, r.text
        detail = r.json().get("detail")
        assert isinstance(detail, dict)
        assert detail.get("code") == "INSUFFICIENT_FUNDS"
        assert "required" in detail and "available" in detail
        assert detail["required"] > detail["available"]

    def test_publish_draft_insufficient(self, biz_token):
        # Create a draft (not publishing yet) — should succeed
        payload = {
            "service_type": "delivery_driver", "city": "الرياض",
            "address": "TEST_iter4_draft_insufficient", "required_count": 20,
            "start_date": "2026-03-05", "start_time": "09:00",
            "duration_type": "one_day", "days_count": 1, "rate": 20,
            "shipments_per_driver": 500, "vehicle_type": "سيدان",
            "publish": False,
        }
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json=payload)
        assert r.status_code == 200
        rid = r.json()["request"]["_id"]
        # Publish should now fail
        p = requests.post(f"{API}/business/requests/{rid}/publish", headers=_h(biz_token))
        assert p.status_code == 400
        detail = p.json().get("detail")
        assert isinstance(detail, dict) and detail.get("code") == "INSUFFICIENT_FUNDS"


# ============= Terms enforcement =============
class TestTermsEnforcement:
    def test_respond_missing_terms_rejected(self, wrk_token):
        # Find a pending offer for this worker (off_1 seed)
        r = requests.get(f"{API}/worker/offers", headers=_h(wrk_token))
        assert r.status_code == 200
        offers = r.json().get("offers", [])
        pending = [o for o in offers if o["status"] == "offered"]
        if not pending:
            pytest.skip("no offered offers for worker")
        oid = pending[0]["_id"]
        # No terms → 400
        resp = requests.post(f"{API}/worker/offers/{oid}/respond",
                             headers=_h(wrk_token), json={"action": "accept"})
        assert resp.status_code == 400, resp.text
        assert "شروط" in resp.text or "terms" in resp.text.lower()

    def test_apply_missing_terms_rejected(self, wrk_token):
        # Try any available published request
        av = requests.get(f"{API}/worker/available", headers=_h(wrk_token)).json()
        items = av.get("available") or av.get("requests") or []
        if not items:
            pytest.skip("no available requests")
        rid = items[0]["_id"]
        r = requests.post(f"{API}/worker/apply", headers=_h(wrk_token),
                          json={"request_id": rid})
        assert r.status_code == 400


# ============= Tickets =============
class TestTicketsFlow:
    def test_business_creates_ticket_with_category_and_request(self, biz_token):
        # Get one of business's requests to link
        reqs = requests.get(f"{API}/business/requests", headers=_h(biz_token)).json()
        items = reqs.get("requests") or []
        assert items, "business should have requests"
        rid = items[0]["_id"]
        body = {
            "subject": "TEST_iter4 ticket",
            "category": "billing",
            "message": "Testing category+request link",
            "request_id": rid,
            "priority": "normal",
        }
        r = requests.post(f"{API}/tickets", headers=_h(biz_token), json=body)
        assert r.status_code == 200, r.text
        t = r.json()["ticket"]
        assert t["category"] in ("billing", "general")
        assert t["request_id"] == rid
        assert "activity" in t and len(t["activity"]) >= 1
        # Save id
        pytest.iter4_ticket_id = t["_id"]

    def test_admin_reply_escalate_resolve(self, adm_token, biz_token):
        tid = getattr(pytest, "iter4_ticket_id", None)
        if not tid:
            pytest.skip("no ticket created")
        # reply
        r = requests.post(f"{API}/tickets/{tid}/reply", headers=_h(adm_token),
                          json={"message": "admin reply TEST_iter4"})
        assert r.status_code == 200
        # escalate
        e = requests.post(f"{API}/tickets/{tid}/escalate", headers=_h(adm_token),
                          json={"level": "operations"})
        assert e.status_code == 200
        # invalid level
        e2 = requests.post(f"{API}/tickets/{tid}/escalate", headers=_h(adm_token),
                           json={"level": "invalid"})
        assert e2.status_code == 400
        # resolve
        res = requests.post(f"{API}/tickets/{tid}/resolve", headers=_h(adm_token))
        assert res.status_code == 200
        # verify state via list_tickets
        lst = requests.get(f"{API}/tickets", headers=_h(adm_token)).json()
        found = [t for t in lst["tickets"] if t["_id"] == tid]
        assert found and found[0]["status"] == "resolved"
        assert found[0]["escalation"] == "operations"
        acts = [a["action"] for a in found[0].get("activity", [])]
        assert "created" in acts and "reply" in acts and "escalated" in acts and "resolved" in acts


# ============= Staff CRUD =============
class TestStaff:
    def test_create_staff_and_login(self, adm_token):
        payload = {"name": "TEST_iter4 Staff", "phone": "+966500000901",
                   "staff_role": "support"}
        r = requests.post(f"{API}/admin/staff", headers=_h(adm_token), json=payload)
        # 400 if already exists — acceptable
        if r.status_code == 400 and "مسجل" in r.text:
            pytest.iter4_staff_created = False
        else:
            assert r.status_code == 200, r.text
            pytest.iter4_staff_created = True
        # login as staff
        t = _otp_login("+966500000901")
        assert t["user"]["role"] == "staff"
        pytest.iter4_staff_token = t["token"]

    def test_staff_can_access_tickets_but_not_settings(self):
        tok = getattr(pytest, "iter4_staff_token", None)
        if not tok:
            pytest.skip("no staff token")
        # Tickets accessible
        r = requests.get(f"{API}/tickets", headers=_h(tok))
        assert r.status_code == 200
        # Settings requires admin
        r2 = requests.get(f"{API}/admin/settings", headers=_h(tok))
        assert r2.status_code in (401, 403)
        # Staff list also admin-only
        r3 = requests.get(f"{API}/admin/staff", headers=_h(tok))
        assert r3.status_code in (401, 403)

    def test_duplicate_phone_rejected(self, adm_token):
        r = requests.post(f"{API}/admin/staff", headers=_h(adm_token),
                          json={"name": "dup", "phone": "+966500000901",
                                "staff_role": "support"})
        assert r.status_code == 400


# ============= Admin settings — compensation percent =============
class TestAdminSettingsCompensation:
    def test_get_settings_has_compensation(self, adm_token):
        r = requests.get(f"{API}/admin/settings", headers=_h(adm_token))
        assert r.status_code == 200
        s = r.json()["settings"]
        # Field may be absent by default; PATCH should accept it.
        # Patch to 80 and validate persistence
        p = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"no_work_compensation_pct": 80})
        assert p.status_code == 200, p.text
        g = requests.get(f"{API}/admin/settings", headers=_h(adm_token)).json()["settings"]
        assert g.get("no_work_compensation_pct") == 80

    def test_compensation_validation(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"no_work_compensation_pct": 150})
        assert r.status_code == 400

    def test_restore_compensation(self, adm_token):
        # Set to 100 (default)
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"no_work_compensation_pct": 100})
        assert r.status_code == 200


# ============= Admin regression =============
class TestAdminEndpoints:
    def test_stats(self, adm_token):
        r = requests.get(f"{API}/admin/stats", headers=_h(adm_token))
        assert r.status_code == 200
        j = r.json()
        for k in ("gmv", "commission", "businesses", "workers", "open_tickets",
                  "open_cases", "pending_documents"):
            assert k in j

    def test_users(self, adm_token):
        r = requests.get(f"{API}/admin/users", headers=_h(adm_token))
        assert r.status_code == 200
        assert "users" in r.json()

    def test_requests(self, adm_token):
        r = requests.get(f"{API}/admin/requests", headers=_h(adm_token))
        assert r.status_code == 200

    def test_withdrawals(self, adm_token):
        r = requests.get(f"{API}/admin/withdrawals", headers=_h(adm_token))
        assert r.status_code == 200

    def test_documents(self, adm_token):
        r = requests.get(f"{API}/admin/documents", headers=_h(adm_token))
        assert r.status_code == 200
        assert "documents" in r.json()

    def test_cases(self, adm_token):
        r = requests.get(f"{API}/admin/cases", headers=_h(adm_token))
        assert r.status_code == 200

    def test_audit(self, adm_token):
        r = requests.get(f"{API}/admin/audit", headers=_h(adm_token))
        assert r.status_code == 200

    def test_staff_list(self, adm_token):
        r = requests.get(f"{API}/admin/staff", headers=_h(adm_token))
        assert r.status_code == 200
        j = r.json()
        assert "staff" in j and "presets" in j


# ============= Business regression =============
class TestBusinessEndpoints:
    def test_overview(self, biz_token):
        r = requests.get(f"{API}/business/overview", headers=_h(biz_token))
        assert r.status_code == 200

    def test_requests(self, biz_token):
        r = requests.get(f"{API}/business/requests", headers=_h(biz_token))
        assert r.status_code == 200

    def test_wallet(self, biz_token):
        r = requests.get(f"{API}/wallet", headers=_h(biz_token))
        assert r.status_code == 200
        j = r.json()
        assert "wallet" in j and "available" in j["wallet"]


# ============= Worker regression =============
class TestWorkerEndpoints:
    def test_overview(self, wrk_token):
        r = requests.get(f"{API}/worker/overview", headers=_h(wrk_token))
        assert r.status_code == 200

    def test_offers(self, wrk_token):
        r = requests.get(f"{API}/worker/offers", headers=_h(wrk_token))
        assert r.status_code == 200
        assert "offers" in r.json()

    def test_documents(self, wrk_token):
        r = requests.get(f"{API}/documents/mine", headers=_h(wrk_token))
        assert r.status_code == 200
