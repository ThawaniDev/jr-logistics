import uuid
from datetime import datetime, timezone
from db import db
from catalog import (DEFAULT_RATE, DEFAULT_COMMISSION_RATE,
                     DEFAULT_VEHICLE_TYPES, DEFAULT_SERVICE_AREAS)


async def get_settings() -> dict:
    s = await db.settings.find_one({"key": "platform"})
    if not s:
        s = {"key": "platform", "default_rate": DEFAULT_RATE,
             "commission_rate": DEFAULT_COMMISSION_RATE,
             "vehicle_types": DEFAULT_VEHICLE_TYPES,
             "service_areas": DEFAULT_SERVICE_AREAS}
        await db.settings.insert_one(s)
    s.pop("_id", None)
    return s


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
                  request_id: str = None, status: str = "completed"):
    doc = {
        "_id": new_id(),
        "user_id": user_id,
        "type": type_,
        "amount": round(amount, 2),
        "direction": direction,
        "status": status,
        "request_id": request_id,
        "note": note,
        "is_demo": True,
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(doc)
    return doc


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
