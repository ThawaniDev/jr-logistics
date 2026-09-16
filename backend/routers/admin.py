from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Literal

from db import db
from deps import require_roles
from utils import new_id, now_iso, notify, add_txn, get_wallet, pub, pub_list

router = APIRouter(prefix="/api/admin", tags=["admin"])
adm = Depends(require_roles("admin"))


@router.get("/stats")
async def stats(user: dict = adm):
    pipeline = [{"$match": {"status": "completed"}},
                {"$group": {"_id": None, "gmv": {"$sum": "$estimated_total"}}}]
    gmv_res = await db.requests.aggregate(pipeline).to_list(1)
    comm_res = await db.transactions.aggregate(
        [{"$match": {"type": "commission"}}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]).to_list(1)
    by_status = {}
    for st in ["published", "filling", "confirmed", "in_progress", "completed", "cancelled"]:
        by_status[st] = await db.requests.count_documents({"status": st})
    return {
        "gmv": round(gmv_res[0]["gmv"], 2) if gmv_res else 0,
        "commission": round(comm_res[0]["total"], 2) if comm_res else 0,
        "businesses": await db.users.count_documents({"role": "business"}),
        "workers": await db.users.count_documents({"role": "worker"}),
        "requests_by_status": by_status,
        "pending_withdrawals": await db.withdrawals.count_documents({"status": "pending"}),
        "open_tickets": await db.tickets.count_documents({"status": {"$in": ["open", "in_review"]}}),
        "no_shows": await db.offers.count_documents({"status": "no_show"}),
        "recent_requests": pub_list(await db.requests.find().sort("created_at", -1).to_list(6)),
    }


@router.get("/users")
async def list_users(role: Optional[str] = None, q: Optional[str] = None, user: dict = adm):
    query = {"role": {"$ne": "admin"}}
    if role in ("business", "worker"):
        query = {"role": role}
    users = await db.users.find(query).sort("created_at", -1).to_list(500)
    if q:
        ql = q.lower()
        users = [u for u in users if ql in (u.get("name") or "").lower()
                 or ql in (u.get("phone") or "")
                 or ql in ((u.get("business_profile") or {}).get("company_name") or "").lower()]
    for u in users:
        u["wallet"] = pub(await get_wallet(u["_id"]))
    return {"users": pub_list(users)}


class StatusIn(BaseModel):
    status: Literal["active", "suspended"]


@router.patch("/users/{user_id}/status")
async def set_user_status(user_id: str, body: StatusIn, user: dict = adm):
    target = await db.users.find_one({"_id": user_id})
    if not target or target["role"] == "admin":
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    await db.users.update_one({"_id": user_id}, {"$set": {"status": body.status}})
    await notify(user_id, "تحديث حالة الحساب",
                 "تم تفعيل حسابك" if body.status == "active" else "تم إيقاف حسابك — تواصل مع الدعم",
                 "account")
    return {"ok": True}


@router.get("/requests")
async def list_requests(status: Optional[str] = None, user: dict = adm):
    query = {"status": status} if status else {}
    reqs = await db.requests.find(query).sort("created_at", -1).to_list(300)
    for r in reqs:
        b = await db.users.find_one({"_id": r["business_id"]}, {"business_profile.company_name": 1, "name": 1})
        r["business"] = pub(b)
        r["counts"] = {}
        for st in ["offered", "accepted", "confirmed", "attended", "paid", "no_show"]:
            r["counts"][st] = await db.offers.count_documents({"request_id": r["_id"], "status": st})
    return {"requests": pub_list(reqs)}


@router.get("/requests/{request_id}")
async def request_detail(request_id: str, user: dict = adm):
    r = await db.requests.find_one({"_id": request_id})
    if not r:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    b = await db.users.find_one({"_id": r["business_id"]}, {"business_profile.company_name": 1, "name": 1, "phone": 1})
    offers = await db.offers.find({"request_id": request_id}).to_list(200)
    for o in offers:
        o["worker"] = pub(await db.users.find_one({"_id": o["worker_id"]},
                                                  {"name": 1, "phone": 1, "worker_profile.rating": 1}))
    candidates = await db.users.find(
        {"role": "worker", "status": "active", "worker_profile.availability": "available",
         "worker_profile.services": r["service_type"]}).to_list(50)
    offered_ids = await db.offers.distinct("worker_id", {"request_id": request_id})
    candidates = [c for c in candidates if c["_id"] not in offered_ids]
    return {"request": pub(r), "business": pub(b), "offers": pub_list(offers), "candidates": pub_list(candidates)}


class MatchIn(BaseModel):
    worker_id: str


@router.post("/requests/{request_id}/match")
async def manual_match(request_id: str, body: MatchIn, user: dict = adm):
    r = await db.requests.find_one({"_id": request_id})
    w = await db.users.find_one({"_id": body.worker_id, "role": "worker"})
    if not r or not w:
        raise HTTPException(status_code=404, detail="الطلب أو العامل غير موجود")
    if r["status"] not in ("published", "filling", "confirmed", "in_progress"):
        raise HTTPException(status_code=400, detail="لا يمكن المطابقة في هذه الحالة")
    if await db.offers.find_one({"request_id": request_id, "worker_id": body.worker_id}):
        raise HTTPException(status_code=400, detail="للعامل عرض مسبق على هذا الطلب")
    await db.offers.insert_one({
        "_id": new_id(), "request_id": request_id, "worker_id": body.worker_id,
        "business_id": r["business_id"], "status": "offered", "is_replacement": True,
        "earning": 0, "created_at": now_iso(), "responded_at": None,
    })
    await notify(body.worker_id, "فرصة جديدة من فريق المنصة",
                 f"رشّحك فريق إسناد لطلب: {r['title']} في {r['city']}", "offer", "/app/worker/opportunities")
    return {"ok": True}


@router.get("/withdrawals")
async def withdrawals(status: Optional[str] = None, user: dict = adm):
    query = {"status": status} if status else {}
    items = await db.withdrawals.find(query).sort("created_at", -1).to_list(300)
    for w in items:
        w["worker"] = pub(await db.users.find_one({"_id": w["worker_id"]}, {"name": 1, "phone": 1}))
        w["wallet"] = pub(await get_wallet(w["worker_id"]))
    return {"withdrawals": pub_list(items)}


class DecisionIn(BaseModel):
    action: Literal["approve", "reject"]
    note: Optional[str] = None


@router.post("/withdrawals/{wid}/decision")
async def withdrawal_decision(wid: str, body: DecisionIn, user: dict = adm):
    w = await db.withdrawals.find_one({"_id": wid})
    if not w or w["status"] != "pending":
        raise HTTPException(status_code=404, detail="الطلب غير موجود أو معالج مسبقاً")
    if body.action == "approve":
        wallet = await get_wallet(w["worker_id"])
        if wallet["available"] < w["amount"]:
            raise HTTPException(status_code=400, detail="رصيد العامل غير كافٍ")
        await db.wallets.update_one({"user_id": w["worker_id"]}, {"$inc": {"available": -w["amount"]}})
        await add_txn(w["worker_id"], "withdrawal", w["amount"], "debit",
                      f"سحب إلى {w['bank_name']} — {w['iban']}")
        new_status = "approved"
    else:
        new_status = "rejected"
    await db.withdrawals.update_one({"_id": wid},
                                    {"$set": {"status": new_status, "processed_at": now_iso(),
                                              "processed_by": user["_id"], "note": body.note}})
    await notify(w["worker_id"],
                 "تمت الموافقة على السحب" if new_status == "approved" else "تم رفض طلب السحب",
                 f"طلب سحب بقيمة {w['amount']} ر.س — {new_status == 'approved' and 'تم التحويل (تجريبي)' or (body.note or '')}",
                 "withdrawal", "/app/worker/wallet")
    return {"ok": True, "status": new_status}


@router.get("/transactions")
async def transactions(user: dict = adm):
    txns = await db.transactions.find().sort("created_at", -1).to_list(300)
    ids = {t["user_id"] for t in txns if t["user_id"] != "platform"}
    names = {}
    async for u in db.users.find({"_id": {"$in": list(ids)}}, {"name": 1}):
        names[u["_id"]] = u["name"]
    for t in txns:
        t["user_name"] = "المنصة" if t["user_id"] == "platform" else names.get(t["user_id"], "—")
    return {"transactions": pub_list(txns)}


class BroadcastIn(BaseModel):
    title: str
    body: str
    target: Literal["all", "business", "worker"] = "all"


@router.post("/broadcast")
async def broadcast(body: BroadcastIn, user: dict = adm):
    query = {} if body.target == "all" else {"role": body.target}
    users = await db.users.find(query, {"_id": 1}).to_list(1000)
    for u in users:
        if u["_id"] == user["_id"]:
            continue
        await notify(u["_id"], body.title, body.body, "broadcast")
    return {"ok": True, "sent": len(users) - 1}


@router.get("/ratings")
async def ratings(user: dict = adm):
    items = await db.ratings.find().sort("created_at", -1).to_list(200)
    ids = {i["from_user"] for i in items} | {i["to_user"] for i in items}
    names = {}
    async for u in db.users.find({"_id": {"$in": list(ids)}}, {"name": 1}):
        names[u["_id"]] = u["name"]
    for i in items:
        i["from_name"] = names.get(i["from_user"], "—")
        i["to_name"] = names.get(i["to_user"], "—")
    return {"ratings": pub_list(items)}
