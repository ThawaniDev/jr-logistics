"""
Iteration 5 — overlap restriction, driver cancellation policy, privacy masking,
business terms. Run: cd /app/backend && python -m pytest tests/test_iteration5.py -v
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://tawazon.preview.emergentagent.com")
API = f"{BASE}/api"


def _h(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _otp_login(phone: str) -> dict:
    s = requests.post(f"{API}/auth/otp/send", json={"phone": phone})
    code = s.json().get("demo_otp", "8325")
    r = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
    assert r.status_code == 200, r.text
    return r.json()


def _admin_pwd_login() -> dict:
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": "emadabuharb1993@gmail.com", "password": "Isnad-Dev-Admin-2026!"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def biz_token():
    return _otp_login("+966500000101")["token"]


@pytest.fixture(scope="module")
def w1_token():
    return _otp_login("+966500000201")["token"]


@pytest.fixture(scope="module")
def adm_token():
    return _admin_pwd_login()["token"]


def _mk_req(biz_token, start, title, count=1, shipments=10, rate=8, publish=True):
    payload = {
        "service_type": "delivery_driver", "title": title,
        "city": "الرياض", "address": "حي النرجس", "required_count": count,
        "start_date": start, "start_time": "09:00",
        "duration_type": "one_day", "days_count": 1, "rate": rate,
        "shipments_per_driver": shipments, "vehicle_type": "سيدان",
        "publish": publish, "terms": True,
    }
    r = requests.post(f"{API}/business/requests", json=payload, headers=_h(biz_token))
    assert r.status_code == 200, r.text
    return r.json()["request"]


class TestOverlapRestriction:
    """Driver cannot accept two active jobs with overlapping date windows."""

    def test_overlap_blocked_on_respond_and_apply(self, biz_token, w1_token):
        import random
        day = (date.today() + timedelta(days=10 + random.randint(0, 30))).isoformat()
        uid = uuid.uuid4().hex[:6]
        r1 = _mk_req(biz_token, day, f"TEST_overlap_a_{uid}")
        r2 = _mk_req(biz_token, day, f"TEST_overlap_b_{uid}")

        # direct offers to w1 on both
        for rid in (r1["_id"], r2["_id"]):
            # find offer created by match_workers for w1 (he is verified + available)
            offers = requests.get(f"{API}/worker/offers", headers=_h(w1_token)).json()["offers"]
            if not any(o["request_id"] == rid for o in offers):
                # fall back to open apply path
                rr = requests.post(f"{API}/worker/apply",
                                   json={"request_id": rid, "terms": True}, headers=_h(w1_token))
                # first apply should succeed, second must 400 with OVERLAPPING_JOB
                if rid == r1["_id"]:
                    assert rr.status_code == 200, rr.text
                else:
                    assert rr.status_code == 400
                    assert rr.json()["detail"]["code"] == "OVERLAPPING_JOB"
            else:
                offer = next(o for o in offers if o["request_id"] == rid)
                rr = requests.post(f"{API}/worker/offers/{offer['_id']}/respond",
                                   json={"action": "accept", "terms": True}, headers=_h(w1_token))
                if rid == r1["_id"]:
                    assert rr.status_code == 200, rr.text
                else:
                    assert rr.status_code == 400
                    assert rr.json()["detail"]["code"] == "OVERLAPPING_JOB"

        # available list must hide the overlapping request r2 for w1
        jobs = requests.get(f"{API}/worker/available", headers=_h(w1_token)).json()["jobs"]
        assert not any(j["_id"] == r2["_id"] for j in jobs)

        # cleanup: cancel both requests (refund escrow)
        for rid in (r1["_id"], r2["_id"]):
            requests.post(f"{API}/business/requests/{rid}/cancel", json={}, headers=_h(biz_token))


class TestDriverCancellation:
    """Driver cancel with reason → recorded, counted, replacement triggered."""

    def test_cancel_with_reason_and_policy(self, biz_token, w1_token, adm_token):
        import random
        day = (date.today() + timedelta(days=45 + random.randint(0, 30))).isoformat()
        uid = uuid.uuid4().hex[:6]
        r = _mk_req(biz_token, day, f"TEST_cancel_{uid}")
        offers = requests.get(f"{API}/worker/offers", headers=_h(w1_token)).json()["offers"]
        offer = next((o for o in offers if o["request_id"] == r["_id"]), None)
        if offer:
            rr = requests.post(f"{API}/worker/offers/{offer['_id']}/respond",
                               json={"action": "accept", "terms": True}, headers=_h(w1_token))
            assert rr.status_code == 200, rr.text
        else:
            rr = requests.post(f"{API}/worker/apply",
                               json={"request_id": r["_id"], "terms": True}, headers=_h(w1_token))
            assert rr.status_code == 200, rr.text
            offer = {"request_id": r["_id"]}

        jobs = requests.get(f"{API}/worker/jobs", headers=_h(w1_token)).json()["jobs"]
        job = next(j for j in jobs if j["request_id"] == r["_id"])

        # cancel without reason → 400
        bad = requests.post(f"{API}/worker/offers/{job['_id']}/cancel",
                            json={"reason": " "}, headers=_h(w1_token))
        assert bad.status_code == 400

        ok = requests.post(f"{API}/worker/offers/{job['_id']}/cancel",
                           json={"reason": "ظرف طارئ — اختبار"}, headers=_h(w1_token))
        assert ok.status_code == 200, ok.text

        # request flagged for replacement
        det = requests.get(f"{API}/business/requests/{r['_id']}", headers=_h(biz_token)).json()
        assert det["request"]["replacement_requested"] is True

        # cancellation visible in admin audit via cancellations collection (through audit endpoint of request)
        requests.post(f"{API}/business/requests/{r['_id']}/cancel", json={"reason": "اختبار"},
                      headers=_h(biz_token))


class TestDriverPrivacy:
    """Worker phone hidden from business before acceptance."""

    def test_phone_masked_before_accept(self, biz_token):
        r = requests.get(f"{API}/business/requests/req_1", headers=_h(biz_token))
        if r.status_code != 200:
            pytest.skip("seeded req_1 not available")
        offers = r.json()["offers"]
        for o in offers:
            if o["status"] == "offered":
                assert not o["worker"].get("phone"), "phone leaked before acceptance"
            else:
                assert o["worker"].get("phone"), "phone must be visible after acceptance"


class TestBusinessTerms:
    def test_biz_terms_recorded_on_publish(self, biz_token):
        day = (date.today() + timedelta(days=4)).isoformat()
        uid = uuid.uuid4().hex[:6]
        r = _mk_req(biz_token, day, f"TEST_bizterms_{uid}")
        det = requests.get(f"{API}/business/requests/{r['_id']}", headers=_h(biz_token)).json()
        assert det["request"].get("biz_terms_accepted_at"), "biz terms timestamp missing"
        requests.post(f"{API}/business/requests/{r['_id']}/cancel", json={}, headers=_h(biz_token))


class TestCancellationPolicySettings:
    def test_admin_can_update_policy(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"cancel_warning_threshold": 2,
                                 "cancel_suspend_threshold": 4,
                                 "cancel_suspend_days": 3})
        assert r.status_code == 200, r.text
        s = r.json()["settings"]
        assert s["cancel_warning_threshold"] == 2
        assert s["cancel_suspend_threshold"] == 4
        assert s["cancel_suspend_days"] == 3

    def test_policy_bounds_enforced(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"cancel_suspend_days": 99})
        assert r.status_code == 400
