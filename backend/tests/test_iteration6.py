"""
Iteration 6 — weekly cancellation policy, cancellations registry, admin filters/stats.
Run: cd /app/backend && python -m pytest tests/test_iteration6.py -v
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
    for _ in range(4):
        s = requests.post(f"{API}/auth/otp/send", json={"phone": phone})
        code = s.json().get("demo_otp", "8325")
        r = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
        if r.status_code == 200:
            return r.json()
    assert False, f"OTP login failed for {phone}: {r.text}"


def _admin_pwd_login() -> dict:
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": "emadabuharb1993@gmail.com", "password": "Ee6211673"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def biz_token():
    return _otp_login("+966500000101")["token"]


def _ensure_w1_active(adm_token: str):
    users = requests.get(f"{API}/admin/users?role=worker&q=محمد", headers=_h(adm_token)).json()["users"]
    w1 = next(u for u in users if u["phone"] == "+966500000201")
    if (w1.get("worker_profile") or {}).get("suspended_until"):
        requests.post(f"{API}/admin/users/{w1['_id']}/clear-suspension", headers=_h(adm_token))


@pytest.fixture(scope="module")
def w1_token(adm_token):
    _ensure_w1_active(adm_token)
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
    if r.status_code == 400 and r.json().get("detail", {}).get("code") == "INSUFFICIENT_FUNDS":
        d = r.json()["detail"]
        requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token),
                      json={"amount": d["required"] - d["available"] + 500})
        r = requests.post(f"{API}/business/requests", json=payload, headers=_h(biz_token))
    assert r.status_code == 200, r.text
    return r.json()["request"]


class TestWeeklyCancellationPolicy:
    def test_weekly_count_tracked(self, biz_token, w1_token, adm_token):
        import random
        day = (date.today() + timedelta(days=80 + random.randint(0, 30))).isoformat()
        uid = uuid.uuid4().hex[:6]
        r = _mk_req(biz_token, day, f"TEST_weekly_{uid}")
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
        jobs = requests.get(f"{API}/worker/jobs", headers=_h(w1_token)).json()["jobs"]
        job = next(j for j in jobs if j["request_id"] == r["_id"])
        ok = requests.post(f"{API}/worker/offers/{job['_id']}/cancel",
                           json={"reason": "اختبار السياسة الأسبوعية"}, headers=_h(w1_token))
        assert ok.status_code == 200, ok.text

        # weekly + lifetime counters visible on the worker profile via admin users list
        users = requests.get(f"{API}/admin/users?role=worker&q=محمد", headers=_h(adm_token)).json()["users"]
        w1 = next(u for u in users if u["phone"] == "+966500000201")
        wp = w1["worker_profile"]
        assert wp.get("cancel_count", 0) >= 1
        assert wp.get("cancel_count_week", 0) >= 1
        year, week, _ = date.today().isocalendar()
        assert wp.get("cancel_week") == f"{year}-W{week:02d}"

        requests.post(f"{API}/business/requests/{r['_id']}/cancel", json={}, headers=_h(biz_token))
        # leave the shared driver usable for other suites running in parallel
        _ensure_w1_active(adm_token)


class TestCancellationsRegistry:
    def test_admin_cancellations_endpoint(self, adm_token):
        r = requests.get(f"{API}/admin/cancellations", headers=_h(adm_token))
        assert r.status_code == 200, r.text
        items = r.json()["cancellations"]
        assert len(items) >= 1
        c = items[0]
        assert c["party"] in ("worker", "business")
        assert c["kind"] in ("cancellation", "no_show")
        assert c.get("reason")
        # joined context
        assert c.get("request") or c.get("worker") or c.get("business")
        # filters work
        rw = requests.get(f"{API}/admin/cancellations?party=worker", headers=_h(adm_token))
        assert rw.status_code == 200
        assert all(c["party"] == "worker" for c in rw.json()["cancellations"])
        rn = requests.get(f"{API}/admin/cancellations?kind=no_show", headers=_h(adm_token))
        assert rn.status_code == 200
        assert all(c["kind"] == "no_show" for c in rn.json()["cancellations"])

    def test_cancellations_forbidden_for_business(self, biz_token):
        r = requests.get(f"{API}/admin/cancellations", headers=_h(biz_token))
        assert r.status_code == 403


class TestAdminRequestFilters:
    def test_city_and_date_filters(self, adm_token):
        r = requests.get(f"{API}/admin/requests?city=الرياض", headers=_h(adm_token))
        assert r.status_code == 200
        assert all(x["city"] == "الرياض" for x in r.json()["requests"])
        far = (date.today() + timedelta(days=300)).isoformat()
        r2 = requests.get(f"{API}/admin/requests?date_from={far}", headers=_h(adm_token))
        assert r2.status_code == 200
        assert all(x["start_date"] >= far for x in r2.json()["requests"])


class TestAdminStatsTotals:
    def test_stats_include_financial_totals(self, adm_token):
        r = requests.get(f"{API}/admin/stats", headers=_h(adm_token))
        assert r.status_code == 200
        s = r.json()
        for k in ("wallet_balances", "reserved_total", "driver_earnings",
                  "cancellations_total", "replacement_requests"):
            assert k in s, f"missing stat {k}"
            assert isinstance(s[k], (int, float))


class TestWeeklyLimitConfigurable:
    def test_weekly_limit_setting(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"cancel_weekly_limit": 3})
        assert r.status_code == 200, r.text
        assert r.json()["settings"]["cancel_weekly_limit"] == 3
        bad = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                             json={"cancel_weekly_limit": 99})
        assert bad.status_code == 400
