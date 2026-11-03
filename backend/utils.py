import uuid
from datetime import date, datetime, timedelta, timezone
from db import db
from catalog import (DEFAULT_RATE, DEFAULT_COMMISSION_RATE,
                     DEFAULT_VEHICLE_TYPES, DEFAULT_SERVICE_AREAS)


DEFAULT_SETTINGS = {"key": "platform", "default_rate": DEFAULT_RATE,
                    "commission_rate": DEFAULT_COMMISSION_RATE,
                    "vehicle_types": DEFAULT_VEHICLE_TYPES,
                    "service_areas": DEFAULT_SERVICE_AREAS,
                    "no_work_compensation_pct": 100,
                    "cancel_warning_threshold": 2,
                    "cancel_suspend_threshold": 4,
                    "cancel_suspend_days": 3,
                    "cancel_weekly_limit": 3,
                    "vat_pct": 15,
                    "alert_no_checkin_grace_min": 30,
                    "alert_unfilled_hours": 6,
                    "urgent_unfilled_hours": 24,
                    "enabled_pickup_cities": ["الرياض"],
                    "warehouse_confirm_pending_min": 30,
                    "replacement_timeout_min": 30,
                    "settlement_pending_hours": 24,
                    "doc_expiry_warn_days": 30,
                    "office_assignment_grace_min": 30,
                    "settlement_period": "weekly",
                    "enabled_services": ["delivery_driver", "car_with_driver", "car_without_driver"],
                    "terms_version": "1.0",
                    "terms_business_text": "",
                    "terms_driver_text": ""}


async def get_settings() -> dict:
    s = await db.settings.find_one({"key": "platform"})
    if not s:
        await db.settings.insert_one(dict(DEFAULT_SETTINGS))
        s = {}
    merged = {**DEFAULT_SETTINGS, **s}
    merged.pop("_id", None)
    return merged


CITY_COORDS = {
    "الرياض": (24.7136, 46.6753), "جدة": (21.4858, 39.1925), "الدمام": (26.4207, 50.0888),
    "الخبر": (26.2172, 50.1971), "مكة المكرمة": (21.3891, 39.8579), "المدينة المنورة": (24.5247, 39.5692),
    "نيوم": (27.9622, 35.3023), "تبوك": (28.3838, 36.5550), "أبها": (18.2164, 42.5053),
    "بريدة": (26.3260, 43.9750),
}


async def log_event(request_id: str, offer_id, actor, event_type: str,
                    old_status=None, new_status=None, notes=None):
    await db.job_events.insert_one({
        "_id": new_id(), "request_id": request_id, "offer_id": offer_id,
        "actor_id": actor.get("_id") if actor else None,
        "actor_name": actor.get("name") if actor else "النظام",
        "actor_role": actor.get("role") if actor else "system",
        "event_type": event_type, "old_status": old_status, "new_status": new_status,
        "notes": notes, "created_at": now_iso(),
    })
    if event_type in WEBHOOK_EVENTS and request_id:
        r = await db.requests.find_one({"_id": request_id}, {"business_id": 1})
        if r:
            await queue_webhook(r["business_id"], event_type, request_id)


WEBHOOK_EVENTS = {
    "request_published", "driver_accepted", "driver_arrived", "attendance_confirmed",
    "driver_finished", "delivery_confirmed", "request_completed", "payout_executed",
    "job_closed", "driver_cancelled", "driver_replaced",
}


async def queue_webhook(business_id: str, event_type: str, request_id: str):
    b = await db.users.find_one({"_id": business_id}, {"business_profile.webhook_url": 1})
    url = ((b or {}).get("business_profile") or {}).get("webhook_url")
    if not url:
        return
    await db.webhook_deliveries.insert_one({
        "_id": new_id(), "business_id": business_id, "event": event_type,
        "request_id": request_id, "url": url, "status": "delivered",
        "delivered_at": now_iso(), "created_at": now_iso()})


async def record_assignment(request_id: str, offer_id, worker_id, action: str,
                            actor: dict = None, reason: str = None):
    await db.assignment_history.insert_one({
        "_id": new_id(), "request_id": request_id, "offer_id": offer_id,
        "worker_id": worker_id, "action": action,
        "actor_id": (actor or {}).get("_id"),
        "actor_name": (actor or {}).get("name", "النظام"),
        "reason": reason, "created_at": now_iso()})


def compute_offer_sla(offer: dict, request: dict, grace_min: int = 30) -> dict:
    """SLA for pickup/start and delivery/completion based on existing timestamps."""
    sla = {}
    try:
        sched_start = datetime.fromisoformat(
            f"{request['start_date']}T{request.get('start_time') or '00:00'}").replace(tzinfo=timezone.utc)
    except Exception:
        return sla
    sla["scheduled_start"] = sched_start.isoformat()
    actual_start = offer.get("attended_at") or offer.get("checkin_at") or offer.get("arrived_at")
    now = datetime.now(timezone.utc)
    if actual_start:
        delay = int((datetime.fromisoformat(actual_start) - sched_start).total_seconds() // 60)
        sla.update(actual_start=actual_start, start_delay_min=delay,
                   start_status="on_time" if delay <= grace_min else "late")
    elif offer.get("status") == "no_show":
        sla["start_status"] = "missed"
    elif offer.get("status") in ("cancelled", "rejected", "offered"):
        sla["start_status"] = "pending"
    else:
        sla["start_status"] = "at_risk" if now > sched_start + timedelta(minutes=grace_min) else "pending"
    try:
        end_date = date.fromisoformat(request["start_date"]) + timedelta(days=max(1, request.get("duration_days", 1)) - 1)
        sched_end = datetime.fromisoformat(f"{end_date.isoformat()}T23:59").replace(tzinfo=timezone.utc)
    except Exception:
        return sla
    sla["scheduled_end"] = sched_end.isoformat()
    actual_end = offer.get("qty_confirmed_at") or offer.get("finished_at") or offer.get("paid_at")
    if actual_end:
        delay = int((datetime.fromisoformat(actual_end) - sched_end).total_seconds() // 60)
        sla.update(actual_end=actual_end, end_delay_min=max(0, delay),
                   end_status="on_time" if delay <= 0 else "late")
    elif offer.get("status") in ("cancelled", "rejected", "offered", "no_show"):
        sla["end_status"] = "pending"
    else:
        sla["end_status"] = "late" if now > sched_end else "on_track"
    return sla


def current_period_key(period: str) -> str:
    today = date.today()
    if period == "monthly":
        return f"{today.year}-{today.month:02d}"
    iso = today.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


BUSY_JOB_STATUSES = ["accepted", "confirmed", "attendance_confirmed", "attended", "driver_completed",
                     "delivered_reported", "pending_settlement", "qty_disputed"]


async def score_drivers_for_request(request: dict) -> list:
    """Smart assignment scoring: availability, location, vehicle/temp compatibility,
    workload, job-time overlap, provider eligibility. Returns ranked candidates."""
    from routers.worker import find_overlapping_job
    workers = await db.users.find({
        "role": "worker", "status": "active",
        "worker_profile.services": request["service_type"]}).to_list(500)
    busy = set(await db.offers.distinct("worker_id", {"status": {"$in": BUSY_JOB_STATUSES}}))
    existing = set(await db.offers.distinct("worker_id", {"request_id": request["_id"]}))
    linked = {w["_id"]: (w.get("worker_profile") or {}).get("provider_id") for w in workers
              if (w.get("worker_profile") or {}).get("provider_status") == "linked"
              and (w.get("worker_profile") or {}).get("provider_id")}
    ok_offices = set()
    if linked:
        async for off in db.users.find({"_id": {"$in": list(set(linked.values()))}, "role": "office"}):
            if (off.get("office_profile") or {}).get("verification_status") in ("verified", "active") and \
                    await db.agreements.find_one({"office_id": off["_id"], "status": "accepted"}):
                ok_offices.add(off["_id"])
    out = []
    for w in workers:
        wp = w.get("worker_profile") or {}
        reasons = []
        if wp.get("verification_status") != "verified":
            reasons.append("not_verified")
        if wp.get("availability") != "available":
            reasons.append("unavailable")
        if wp.get("suspended_until") and wp["suspended_until"] > now_iso():
            reasons.append("suspended")
        if w["_id"] in busy:
            reasons.append("busy")
        if w["_id"] in existing:
            reasons.append("already_offered")
        if request.get("vehicle_type") and wp.get("vehicle_type") not in (None, "", request["vehicle_type"]):
            reasons.append("vehicle_mismatch")
        if request.get("temperature_type") and wp.get("vehicle_temperature") not in (None, "", request["temperature_type"]):
            reasons.append("temp_mismatch")
        if w["_id"] in linked and linked[w["_id"]] not in ok_offices:
            reasons.append("provider_ineligible")
        if request.get("preferred_office_id") and linked.get(w["_id"]) != request["preferred_office_id"]:
            reasons.append("different_office")
        if "busy" not in reasons and await find_overlapping_job(w["_id"], request):
            reasons.append("time_overlap")
        score = 0
        if not reasons:
            score = 50
            if (wp.get("city") or w.get("city")) == (request.get("pickup_city") or request.get("city")):
                score += 20
            score += min(round((wp.get("rating") or 0) * 4), 20)
            score += min(wp.get("jobs_completed", 0), 10)
            score -= min(wp.get("cancel_count", 0) * 3, 15)
        out.append({
            "driver": {"_id": w["_id"], "name": w.get("name"), "phone": w.get("phone"),
                       "city": wp.get("city") or w.get("city"),
                       "vehicle_type": wp.get("vehicle_type"),
                       "vehicle_temperature": wp.get("vehicle_temperature"),
                       "rating": wp.get("rating"), "jobs_completed": wp.get("jobs_completed", 0),
                       "availability": wp.get("availability"),
                       "verification_status": wp.get("verification_status"),
                       "affiliation": "office" if w["_id"] in linked else "platform"},
            "score": score, "eligible": not reasons, "reasons": reasons,
        })
    return sorted(out, key=lambda x: (-x["eligible"], -x["score"]))


async def provider_blocks_paid_work(worker: dict) -> bool:
    """True if the driver is linked to an office that is not verified or lacks an accepted agreement."""
    wp = worker.get("worker_profile", {})
    oid = wp.get("provider_id")
    if not oid or wp.get("provider_status") != "linked":
        return False
    office = await db.users.find_one({"_id": oid, "role": "office"})
    if not office:
        return False
    if (office.get("office_profile") or {}).get("verification_status") not in ("verified", "active"):
        return True
    agr = await db.agreements.find_one({"office_id": oid, "status": "accepted"})
    return not agr


async def resolve_price(business_id: str, vehicle_type: str, temperature_type,
                        pickup_city: str, delivery_city: str, service_type: str = None):
    temp = temperature_type if vehicle_type in ("van", "dyna") else None
    q = {"vehicle_type": vehicle_type, "pickup_city": pickup_city,
         "delivery_city": delivery_city, "status": "active",
         "temperature_type": temp}
    today = date.today().isoformat()
    candidates = await db.pricing_rules.find({**q, "business_id": business_id}).to_list(50)
    if not candidates:
        candidates = await db.pricing_rules.find({**q, "business_id": None}).to_list(50)

    def usable(rule):
        if rule.get("expiry_date") and rule["expiry_date"] < today:
            return False
        st = rule.get("service_type")
        return not st or st == service_type

    valid = [r for r in candidates if usable(r)]
    if not valid:
        return None
    # most specific (service-matched) first, then newest
    valid.sort(key=lambda r: (bool(r.get("service_type")), r.get("created_at", "")), reverse=True)
    return valid[0]


def new_id() -> str:
    return uuid.uuid4().hex


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def notify(user_id: str, title: str, body: str, ntype: str = "general", link: str = None):
    if not user_id:
        return
    await db.notifications.insert_one({
        "_id": new_id(),
        "user_id": user_id,
        "title": title,
        "body": body,
        "type": ntype,
        "link": link,
        "read": False,
        "created_at": now_iso(),
    })


async def notify_admins(title: str, body: str, ntype: str = "admin", link: str = None):
    admins = await db.users.find({"role": "admin"}, {"_id": 1}).to_list(20)
    for a in admins:
        await notify(a["_id"], title, body, ntype, link)


async def add_txn(user_id: str, type_: str, amount: float, direction: str, note: str,
                  request_id: str = None, status: str = "completed", actor: dict | str = "system",
                  settlement_id: str = None):
    doc = {
        "_id": new_id(),
        "user_id": user_id,
        "type": type_,
        "amount": round(amount, 2),
        "direction": direction,
        "status": status,
        "request_id": request_id,
        "settlement_id": settlement_id,
        "note": note,
        "is_demo": True,
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(doc)
    await ledger_entry(type_, doc["amount"], direction, actor, user_id=user_id,
                       request_id=request_id, settlement_id=settlement_id,
                       ref=doc["_id"], note=note)
    return doc


async def ledger_entry(type_: str, amount: float, direction: str, actor: dict | str,
                       user_id: str = None, request_id: str = None,
                       settlement_id: str = None, ref: str = None,
                       status: str = "posted", note: str = None):
    actor_desc = actor if isinstance(actor, str) else f"{actor.get('name')} ({actor.get('_id')})"
    doc = {"_id": new_id(), "type": type_, "amount": round(amount, 2), "direction": direction,
           "actor": actor_desc, "user_id": user_id, "request_id": request_id,
           "settlement_id": settlement_id, "ref": ref, "status": status,
           "note": note, "created_at": now_iso()}
    await db.ledger.insert_one(doc)
    return doc


async def get_client_pricing(business_id: str) -> dict | None:
    return await db.client_pricing.find_one({"business_id": business_id, "status": "active"})


async def next_invoice_no() -> str:
    c = await db.counters.find_one_and_update(
        {"_id": "invoice"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return f"JR-INV-{c['seq']:05d}"


async def get_wallet(user_id: str) -> dict:
    wallet = await db.wallets.find_one({"user_id": user_id})
    if not wallet:
        wallet = {"_id": new_id(), "user_id": user_id, "available": 0.0, "reserved": 0.0, "currency": "SAR"}
        await db.wallets.insert_one(wallet)
    return wallet


async def recalc_worker_rating(worker_id: str):
    ratings = await db.ratings.find({"to_user": worker_id}).to_list(1000)
    if ratings:
        avg = round(sum(r["score"] for r in ratings) / len(ratings), 1)
        await db.users.update_one(
            {"_id": worker_id},
            {"$set": {"worker_profile.rating": avg, "worker_profile.rating_count": len(ratings)}},
        )


def pub(doc):
    if doc is None:
        return None
    d = dict(doc)
    d["_id"] = str(d["_id"])
    return d


def pub_list(docs):
    return [pub(d) for d in docs]


async def audit(user: dict, action: str, entity: str = None, entity_id: str = None,
                before=None, after=None, note: str = None):
    await db.audit_logs.insert_one({
        "_id": new_id(),
        "actor_id": user["_id"],
        "actor_name": user.get("name", ""),
        "actor_role": user.get("staff_profile", {}).get("staff_role") or user.get("role"),
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "before": before,
        "after": after,
        "note": note,
        "created_at": now_iso(),
    })


async def notify_staff(permission: str, title: str, body: str, ntype: str = "admin", link: str = None):
    staff = await db.users.find({"role": "staff", "status": "active"}).to_list(100)
    for s in staff:
        if permission in (s.get("staff_profile") or {}).get("permissions", []):
            await notify(s["_id"], title, body, ntype, link)
