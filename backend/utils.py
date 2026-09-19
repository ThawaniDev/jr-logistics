import uuid
from datetime import datetime, timezone
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
                        pickup_city: str, delivery_city: str):
    q = {"vehicle_type": vehicle_type, "pickup_city": pickup_city,
         "delivery_city": delivery_city, "status": "active",
         "temperature_type": temperature_type if vehicle_type != "sedan" else None}
    rule = await db.pricing_rules.find_one({**q, "business_id": business_id}, sort=[("created_at", -1)])
    if not rule:
        rule = await db.pricing_rules.find_one({**q, "business_id": None}, sort=[("created_at", -1)])
    return rule


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
