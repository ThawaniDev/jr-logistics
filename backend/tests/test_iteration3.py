"""Iteration 3 backend tests — pricing settings, drafts, publish, dashboards, lifecycle.

Serial-safe. Restores mutated admin settings at end of module.
"""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://tawazon.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


def _otp_login(phone: str) -> dict:
    # retry: parallel xdist workers may re-send OTP for the same phone mid-verify
    for _ in range(4):
        r = requests.post(f"{API}/auth/otp/send", json={"phone": phone}, timeout=15)
        assert r.status_code == 200, r.text
        code = r.json()["demo_otp"]
        r2 = requests.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code}, timeout=15)
        if r2.status_code == 200:
            return r2.json()
    assert False, f"OTP login failed for {phone}: {r2.text}"


def _h(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _admin_pwd_login() -> dict:
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": "emadabuharb1993@gmail.com", "password": "Ee6211673"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def adm_token():
    return _admin_pwd_login()["token"]


@pytest.fixture(scope="module")
def biz_token():
    return _otp_login("+966500000101")["token"]


# ---------- Admin settings CRUD + validation ----------
class TestAdminSettings:
    def test_get_settings(self, adm_token):
        r = requests.get(f"{API}/admin/settings", headers=_h(adm_token))
        assert r.status_code == 200
        s = r.json()["settings"]
        assert "default_rate" in s and "commission_rate" in s
        assert "vehicle_types" in s and "service_areas" in s

    def test_public_catalog_defaults(self):
        r = requests.get(f"{API}/catalog/defaults")
        assert r.status_code == 200
        j = r.json()
        for k in ("default_rate", "commission_rate", "vehicle_types", "service_areas"):
            assert k in j

    def test_patch_settings_default_rate_and_commission(self, adm_token):
        # Change to 9 and 0.12
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"default_rate": 9, "commission_rate": 0.12})
        assert r.status_code == 200, r.text
        s = r.json()["settings"]
        assert s["default_rate"] == 9
        assert s["commission_rate"] == 0.12
        # GET to verify persistence
        g = requests.get(f"{API}/admin/settings", headers=_h(adm_token)).json()["settings"]
        assert g["default_rate"] == 9 and g["commission_rate"] == 0.12
        # Also visible in public catalog defaults
        pd = requests.get(f"{API}/catalog/defaults").json()
        assert pd["default_rate"] == 9 and pd["commission_rate"] == 0.12

    def test_commission_propagates_to_estimate(self, biz_token):
        # With commission at 12%, estimate 2 drivers × 30 shipments × 8 SAR
        # Business submits rate=0 → should fall back to admin default (9), 2*30*9=540, commission=64.8
        # But the review request expects rate=0, 2 drivers, 30/driver → commission=57.6 (12% of 480)
        # That implies the estimate used default_rate=8 (pre-change). So we test both:
        # (a) explicit rate=8, commission_rate=0.12 → total 480, commission 57.6
        r = requests.post(f"{API}/business/estimate", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "required_count": 2,
            "duration_type": "one_day", "days_count": 1, "rate": 8,
            "shipments_per_driver": 30,
        })
        assert r.status_code == 200
        j = r.json()
        assert j["estimated_total"] == 480
        assert j["commission"] == 57.6
        assert j["commission_rate"] == 0.12
        # (b) rate=0 → uses admin default_rate=9 → 2*30*9=540, commission=64.8
        r2 = requests.post(f"{API}/business/estimate", headers=_h(biz_token), json={
            "service_type": "delivery_driver", "required_count": 2,
            "duration_type": "one_day", "days_count": 1, "rate": 0,
            "shipments_per_driver": 30,
        })
        j2 = r2.json()
        assert j2["rate"] == 9
        assert j2["estimated_total"] == 540
        assert j2["commission"] == 64.8

    def test_create_request_uses_settings_default_when_rate_zero(self, biz_token):
        # With admin still at rate=9, commission=0.12
        payload = {
            "service_type": "delivery_driver", "city": "الرياض",
            "address": "TEST_default_rate_fallback", "required_count": 2,
            "start_date": "2026-02-15", "start_time": "09:00",
            "duration_type": "one_day", "days_count": 1, "rate": 0,
            "shipments_per_driver": 30, "vehicle_type": "سيدان",
            "publish": True,
        }
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json=payload)
        if r.status_code == 400 and r.json().get("detail", {}).get("code") == "INSUFFICIENT_FUNDS":
            d = r.json()["detail"]
            requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token),
                          json={"amount": d["required"] - d["available"] + 100})
            r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json=payload)
        assert r.status_code == 200, r.text
        req = r.json()["request"]
        assert req["rate"] == 9  # fell back to admin default
        assert req["commission_rate"] == 0.12  # snapshot
        assert req["estimated_total"] == 540
        assert req["commission"] == 64.8

    def test_vehicle_types_patch(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"vehicle_types": ["سيدان", "فان", "شاحنة صغيرة"]})
        assert r.status_code == 200
        # Public defaults reflects
        pd = requests.get(f"{API}/catalog/defaults").json()
        assert "شاحنة صغيرة" in pd["vehicle_types"]

    def test_commission_validation_out_of_range(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"commission_rate": 0.6})
        assert r.status_code == 400
        r2 = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                            json={"commission_rate": 0})
        assert r2.status_code == 400

    def test_default_rate_validation(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token),
                           json={"default_rate": 0})
        assert r.status_code == 400

    def test_restore_settings(self, adm_token):
        r = requests.patch(f"{API}/admin/settings", headers=_h(adm_token), json={
            "default_rate": 8, "commission_rate": 0.10,
            "vehicle_types": ["سيدان", "فان"],
        })
        assert r.status_code == 200
        s = r.json()["settings"]
        assert s["default_rate"] == 8 and s["commission_rate"] == 0.10
        assert s["vehicle_types"] == ["سيدان", "فان"]
        # Verify estimate returns to 48 commission on 480 base
        e = requests.post(f"{API}/business/estimate", headers=_h(_otp_login("+966500000101")["token"]),
                          json={"service_type": "delivery_driver", "required_count": 2,
                                "duration_type": "one_day", "days_count": 1, "rate": 8,
                                "shipments_per_driver": 30}).json()
        assert e["estimated_total"] == 480 and e["commission"] == 48


# ---------- Draft flow ----------
class TestDraftAndPublish:
    def test_create_draft_then_publish(self, biz_token):
        payload = {
            "service_type": "delivery_driver", "city": "جدة",
            "address": "TEST_draft_flow حي الروضة", "required_count": 2,
            "start_date": "2026-02-20", "start_time": "10:00",
            "duration_type": "one_day", "days_count": 1, "rate": 8,
            "shipments_per_driver": 30, "vehicle_type": "فان",
            "publish": False,
        }
        r = requests.post(f"{API}/business/requests", headers=_h(biz_token), json=payload)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["request"]["status"] == "draft"
        assert j["matched_workers"] == 0
        rid = j["request"]["_id"]

        # Publish it (ensure wallet can cover — shared demo wallet may be drained by other suites)
        p = requests.post(f"{API}/business/requests/{rid}/publish", headers=_h(biz_token))
        if p.status_code == 400 and p.json().get("detail", {}).get("code") == "INSUFFICIENT_FUNDS":
            topup = p.json()["detail"]["required"] - p.json()["detail"]["available"] + 100
            requests.post(f"{API}/business/wallet/topup", headers=_h(biz_token), json={"amount": topup})
            p = requests.post(f"{API}/business/requests/{rid}/publish", headers=_h(biz_token))
        assert p.status_code == 200, p.text
        pj = p.json()
        assert pj["ok"] is True

        # Verify
        d = requests.get(f"{API}/business/requests/{rid}", headers=_h(biz_token)).json()
        assert d["request"]["status"] == "published"

    def test_publish_non_draft_rejected(self, biz_token):
        # Get a non-draft request from seed (req_1 published)
        r = requests.post(f"{API}/business/requests/req_1/publish", headers=_h(biz_token))
        assert r.status_code == 400


# ---------- Business overview extended stats ----------
class TestBusinessOverviewExtended:
    def test_overview_has_pricing_stats(self, biz_token):
        r = requests.get(f"{API}/business/overview", headers=_h(biz_token))
        assert r.status_code == 200
        j = r.json()
        # New iteration 3 fields
        assert "total_spent" in j
        assert "platform_fees" in j
        assert "pending_attendance" in j
        assert "counts" in j
        counts = j["counts"]
        for k in ("draft", "published", "completed", "cancelled", "confirmed", "in_progress"):
            assert k in counts


# ---------- Driver wallet extended ----------
class TestDriverWallet:
    def test_wallet_for_driver_has_pending_and_paid(self):
        tok = _otp_login("+966500000208")["token"]  # ناصر
        r = requests.get(f"{API}/wallet", headers=_h(tok))
        assert r.status_code == 200
        j = r.json()
        assert "pending_earnings" in j
        assert "paid_earnings" in j
        assert "wallet" in j and "available" in j["wallet"]


# ---------- Ratings still work after completion ----------
class TestRatingAfterCompletion:
    def test_rate_paid_worker_on_req_d2(self, biz_token):
        # req_d2 completed by iteration 2. Find any paid offer and rate.
        d = requests.get(f"{API}/business/requests/req_d2", headers=_h(biz_token)).json()
        if d["request"]["status"] != "completed":
            pytest.skip("req_d2 not completed")
        paid = [o for o in d["offers"] if o["status"] == "paid"]
        if not paid:
            pytest.skip("no paid offers")
        r = requests.post(f"{API}/business/requests/req_d2/rate", headers=_h(biz_token),
                          json={"offer_id": paid[0]["_id"], "score": 5,
                                "comment": "TEST_rate_iter3"})
        assert r.status_code == 200
