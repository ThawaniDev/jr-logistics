"""Live operations: today's ops dashboard, smart alerts, KSA driver map, matching filters."""
from datetime import datetime, timezone, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends

from db import db
from deps import require_staff
from utils import pub, get_settings, CITY_COORDS

router = APIRouter(prefix="/api/admin/operations", tags=["operations"])
p_ops = Depends(require_staff("requests_view", "operations"))
p_alerts = Depends(require_staff("cases", "alerts"))
p_map = Depends(require_staff("live_location_view", "live_location"))

ACTIVE = ["accepted", "confirmed", "attendance_confirmed", "attended",
          "delivered_reported", "pending_settlement", "qty_disputed"]
ISSUE_STATUSES = ["qty_disputed", "no_show"]


def _parse_start(r: dict) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(f"{r['start_date']}T{r.get('start_time') or '00:00'}").replace(
            tzinfo=timezone.utc)
    except Exception:
        return None


async def _driver_op_state(w: dict):
    wp = w.get("worker_profile", {})
    active = await db.offers.find_one({"worker_id": w["_id"], "status": {"$in": ACTIVE}},
                                      sort=[("created_at", -1)])
    issue = await db.offers.find_one({"worker_id": w["_id"],
                                      "status": {"$in": ISSUE_STATUSES, }},
                                     sort=[("created_at", -1)])
    suspended = wp.get("suspended_until") and wp["suspended_until"] > datetime.now(timezone.utc).isoformat()
    if issue or suspended:
        return "issue", active
    if active:
        if active["status"] in ("accepted", "confirmed"):
            return "assigned", active
        return "on_job", active
    return ("available" if wp.get("availability") == "available" else "unavailable"), None


@router.get("/today")
async def operations_today(user: dict = p_ops):
    s = await get_settings()
    today = date.today().isoformat()
    reqs = await db.requests.find(
        {"start_date": {"$lte": today},
         "status": {"$in": ["published", "filling", "confirmed", "in_progress", "completed"]}}
    ).sort("created_at", -1).to_list(200)
    req_ids = [r["_id"] for r in reqs]
    req_map = {r["_id"]: r for r in reqs}
    offers = await db.offers.find({"request_id": {"$in": req_ids}}).to_list(1000) if req_ids else []

    grace = s.get("alert_no_checkin_grace_min", 30)
    now = datetime.now(timezone.utc)
    late, counts = [], {"present": 0, "not_arrived": 0, "working": 0,
                        "waiting_warehouse": 0, "completed": 0, "issues": 0}
    for o in offers:
        r = req_map.get(o["request_id"])
        st = o["status"]
        if st in ("attended",):
            counts["present"] += 1
            counts["working"] += 1
        elif st == "delivered_reported":
            counts["present"] += 1
            counts["waiting_warehouse"] += 1
        elif st in ("pending_settlement", "paid"):
            counts["present"] += 1
            counts["completed"] += 1
        elif st in ("accepted", "confirmed", "attendance_confirmed"):
            start = _parse_start(r) if r else None
            if st == "attendance_confirmed":
                counts["present"] += 1
            elif start and now > start + timedelta(minutes=grace):
                counts["not_arrived"] += 1
                w = await db.users.find_one({"_id": o["worker_id"]}, {"name": 1, "phone": 1})
                b = await db.users.find_one({"_id": o["business_id"]},
                                            {"name": 1, "business_profile.company_name": 1})
                late.append({
                    "offer_id": o["_id"], "request_id": o["request_id"],
                    "driver_name": (w or {}).get("name"), "driver_id": o["worker_id"],
                    "driver_phone": (w or {}).get("phone"),
                    "business_name": ((b or {}).get("business_profile") or {}).get("company_name") or (b or {}).get("name"),
                    "city": r.get("pickup_city") or r.get("city"), "title": r.get("title"),
                    "start_time": r.get("start_time"), "status": st,
                    "minutes_late": int((now - start).total_seconds() // 60),
                })
        if st in ISSUE_STATUSES or (st == "cancelled" and o.get("cancelled_at", "").startswith(today)):
            counts["issues"] += 1
    replacements = [r for r in reqs if r.get("replacement_requested")]
    summary = {
        "active_requests": len([r for r in reqs if r["status"] not in ("completed",)]),
        "expected_drivers": sum(r.get("required_count", 0) for r in reqs if r["status"] != "completed"),
        "replacements_open": len(replacements),
        **counts,
    }
    return {"summary": summary, "late_drivers": late,
            "replacement_requests": pub(replacements) if isinstance(replacements, dict) else [pub(x) for x in replacements]}


@router.get("/alerts")
async def smart_alerts(user: dict = p_alerts):
    s = await get_settings()
    now = datetime.now(timezone.utc)
    alerts = []

    def add(atype, severity, title, message, request_id=None, offer_id=None):
        alerts.append({"type": atype, "severity": severity, "title": title, "message": message,
                       "request_id": request_id, "offer_id": offer_id, "at": now.isoformat()})

    grace = s.get("alert_no_checkin_grace_min", 30)
    wh_pending = s.get("warehouse_confirm_pending_min", 30)
    repl_timeout = s.get("replacement_timeout_min", 30)
    settle_hours = s.get("settlement_pending_hours", 24)
    doc_days = s.get("doc_expiry_warn_days", 30)

    offers = await db.offers.find({"status": {"$in": ACTIVE + ["qty_disputed"]}}).to_list(1000)
    for o in offers:
        r = await db.requests.find_one({"_id": o["request_id"]},
                                       {"title": 1, "start_date": 1, "start_time": 1, "status": 1,
                                        "replacement_requested": 1, "replacement_count": 1})
        if not r:
            continue
        start = _parse_start(r)
        if o["status"] in ("accepted", "confirmed") and start and now > start + timedelta(minutes=grace):
            add("driver_late", "high", "مندوب متأخر",
                f"مندوب لم يسجّل وصوله — {r['title']} — متأخر {int((now - start).total_seconds() // 60)} دقيقة",
                o["request_id"], o["_id"])
        if o["status"] == "attendance_confirmed" and o.get("arrived_at"):
            arrived = datetime.fromisoformat(o["arrived_at"])
            if now > arrived + timedelta(minutes=wh_pending):
                add("warehouse_confirm_pending", "medium", "بانتظار تأكيد الحضور",
                    f"المندوب وصل منذ {int((now - arrived).total_seconds() // 60)} دقيقة دون تأكيد المستودع — {r['title']}",
                    o["request_id"], o["_id"])
        if o["status"] == "qty_disputed":
            add("qty_discrepancy", "high", "اختلاف في كمية الشحنات",
                f"يوجد اختلاف في العدد النهائي — {r['title']}", o["request_id"], o["_id"])
        if r.get("replacement_requested") and o["status"] == "cancelled" and o.get("cancelled_at"):
            cancelled = datetime.fromisoformat(o["cancelled_at"])
            filled = await db.offers.count_documents({"request_id": o["request_id"],
                                                      "status": {"$in": ACTIVE + ["paid"]}})
            if filled < 1 and now > cancelled + timedelta(minutes=repl_timeout):
                add("no_replacement", "critical", "مطلوب إجراء عاجل — لا يوجد بديل",
                    f"لم يُقبل أي بديل خلال {repl_timeout} دقيقة — {r['title']}", o["request_id"], o["_id"])

    pending = await db.settlements.find({"status": {"$in": ["pending_review", "under_review"]}}).to_list(500)
    for st in pending:
        created = datetime.fromisoformat(st["created_at"])
        if now > created + timedelta(hours=settle_hours):
            add("settlement_pending", "medium", "تسوية بانتظار الاعتماد",
                f"تسوية {st.get('_id')} معلقة منذ {int((now - created).total_seconds() // 3600)} ساعة",
                st.get("request_id"), st.get("offer_id"))

    cutoff = (now + timedelta(days=doc_days)).date().isoformat()
    expired_docs = await db.driver_documents.find(
        {"status": {"$ne": "rejected"}, "expiry_date": {"$ne": None, "$lte": cutoff}}).to_list(500)
    for d in expired_docs:
        expired = d["expiry_date"] < now.date().isoformat()
        add("doc_expired" if expired else "doc_expiring",
            "high" if expired else "medium",
            "مستند مندوب منتهٍ" if expired else "مستند مندوب قارب على الانتهاء",
            f"مستند {d['type']} — ينتهي في {d['expiry_date']}")

    unfilled_h = s.get("alert_unfilled_hours", 6)
    open_reqs = await db.requests.find({"status": {"$in": ["published", "filling"]}}).to_list(200)
    for r in open_reqs:
        created = datetime.fromisoformat(r["created_at"])
        accepted = await db.offers.count_documents({"request_id": r["_id"], "status": {"$in": ACTIVE + ["paid"]}})
        if accepted < r.get("required_count", 1) and now > created + timedelta(hours=unfilled_h):
            add("insufficient_drivers", "medium", "نقص في المناديب",
                f"{r['title']} — قبل {accepted} من {r.get('required_count', 1)} مندوبين",
                r["_id"])
    return {"alerts": alerts, "thresholds": {
        "late_grace_min": grace, "warehouse_confirm_pending_min": wh_pending,
        "replacement_timeout_min": repl_timeout, "settlement_pending_hours": settle_hours,
        "doc_expiry_warn_days": doc_days}}


@router.get("/map")
async def drivers_map(status: Optional[str] = None, vehicle_type: Optional[str] = None,
                      temperature_type: Optional[str] = None, city: Optional[str] = None,
                      user: dict = p_map):
    workers = await db.users.find({"role": "worker", "status": {"$ne": "deleted"}}).to_list(2000)
    live = {l["worker_id"]: l for l in await db.driver_locations.find().to_list(1000)}
    out = []
    for w in workers:
        wp = w.get("worker_profile", {})
        st, active = await _driver_op_state(w)
        wcity = wp.get("city") or w.get("city") or "الرياض"
        if status and st != status:
            continue
        if vehicle_type and wp.get("vehicle_type") != vehicle_type:
            continue
        if temperature_type and wp.get("vehicle_temperature") != temperature_type:
            continue
        if city and wcity != city:
            continue
        loc = live.get(w["_id"])
        base = CITY_COORDS.get(wcity, CITY_COORDS["الرياض"])
        jitter = ((int(w["_id"][:6], 16) % 200) - 100) / 2500.0
        out.append({
            "worker_id": w["_id"], "name": w["name"], "city": wcity,
            "vehicle_type": wp.get("vehicle_type"), "temperature_type": wp.get("vehicle_temperature"),
            "availability": wp.get("availability"), "op_status": st,
            "verification_status": wp.get("verification_status"),
            "lat": (loc or {}).get("lat", round(base[0] + jitter, 5)),
            "lng": (loc or {}).get("lng", round(base[1] + jitter, 5)),
            "live": bool(loc), "at": (loc or {}).get("at"),
            "active_job": {"request_id": active["request_id"], "offer_id": active["_id"],
                           "status": active["status"]} if active else None,
        })
    return {"drivers": out}


@router.get("/city-summary")
async def city_summary(city: str, user: dict = p_map):
    workers = await db.users.find({"role": "worker", "status": {"$ne": "deleted"}}).to_list(2000)
    counts = {"city": city, "total": 0, "available": 0, "unavailable": 0, "on_job": 0,
              "assigned": 0, "issue": 0}
    for w in workers:
        wp = w.get("worker_profile", {})
        if (wp.get("city") or w.get("city")) != city:
            continue
        st, _ = await _driver_op_state(w)
        counts["total"] += 1
        counts[st] += 1
    return counts


@router.post("/requests/{request_id}/rematch")
async def rematch_request(request_id: str, user: dict = p_ops):
    from routers.business import match_workers
    r = await db.requests.find_one({"_id": request_id})
    if not r:
        return {"ok": False, "matched": 0}
    r["replacement_requested"] = True
    matched = await match_workers(r)
    return {"ok": True, "matched": matched}


@router.get("/drivers")
async def drivers_directory(city: Optional[str] = None, vehicle_type: Optional[str] = None,
                            temperature_type: Optional[str] = None, availability: Optional[str] = None,
                            eligible_only: bool = False, user: dict = p_ops):
    q = {"role": "worker", "status": "active"}
    if city:
        q["city"] = city
    if vehicle_type:
        q["worker_profile.vehicle_type"] = vehicle_type
    if temperature_type:
        q["worker_profile.vehicle_temperature"] = temperature_type
    if availability:
        q["worker_profile.availability"] = availability
    if eligible_only:
        q["worker_profile.verification_status"] = "verified"
        q["worker_profile.availability"] = "available"
    workers = await db.users.find(q).to_list(1000)
    busy_ids = set(await db.offers.distinct("worker_id", {"status": {"$in": ACTIVE}}))
    out = []
    for w in workers:
        wp = w.get("worker_profile", {})
        out.append({**pub(w), "has_active_job": w["_id"] in busy_ids,
                    "eligible": wp.get("verification_status") == "verified"
                    and wp.get("availability") == "available" and w["_id"] not in busy_ids})
    return {"drivers": out}


@router.get("/drivers/{worker_id}/profile")
async def driver_operational_profile(worker_id: str, user: dict = p_ops):
    w = await db.users.find_one({"_id": worker_id, "role": "worker"})
    if not w:
        return {"error": "غير موجود"}
    offers = await db.offers.find({"worker_id": worker_id}).to_list(2000)
    by_status = {}
    for o in offers:
        by_status[o["status"]] = by_status.get(o["status"], 0) + 1
    earnings = await db.settlements.find({"driver_id": worker_id, "status": "paid"}).to_list(1000)
    docs = await db.driver_documents.find({"worker_id": worker_id}).to_list(50)
    ratings = await db.ratings.find({"to_user": worker_id}).to_list(500)
    avg = round(sum(x["score"] for x in ratings) / len(ratings), 1) if ratings else None
    return {"driver": pub(w), "stats": {
        "jobs_completed": (w.get("worker_profile") or {}).get("jobs_completed", 0),
        "offers_by_status": by_status,
        "cancellations": (w.get("worker_profile") or {}).get("cancel_count", 0),
        "no_shows": by_status.get("no_show", 0),
        "total_earnings": round(sum(x["net"] for x in earnings), 2),
        "settlements_count": len(earnings),
        "rating": avg, "rating_count": len(ratings),
        "verification_status": (w.get("worker_profile") or {}).get("verification_status"),
        "documents": [{"type": d["type"], "status": d["status"], "expiry_date": d.get("expiry_date")} for d in docs],
    }}
