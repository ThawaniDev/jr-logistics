from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List

from db import db
from deps import require_roles
from catalog import SERVICE_MAP
from utils import new_id, now_iso, notify, notify_admins, add_txn, get_wallet

router = APIRouter(prefix="/api/worker", tags=["worker"])
wrk = Depends(require_roles("worker"))


async def enrich_offer(o: dict) -> dict:
    r = await db.requests.find_one({"_id": o["request_id"]})
    o["request"] = r
    if r:
        b = await db.users.find_one({"_id": r["business_id"]},
                                    {"name": 1, "business_profile.company_name": 1,
                                     "business_profile.rating": 1})
        o["business"] = b
    return o


class AvailabilityIn(BaseModel):
    status: Literal["available", "unavailable"]


class RespondIn(BaseModel):
    action: Literal["accept", "reject"]


class ApplyIn(BaseModel):
    request_id: str


class WithdrawalIn(BaseModel):
    amount: float
    bank_name: str
    iban: str


class RateBizIn(BaseModel):
    offer_id: str
    score: int
    comment: Optional[str] = None


@router.get("/overview")
async def overview(user: dict = wrk):
    wallet = await get_wallet(user["_id"])
    new_offers = await db.offers.count_documents({"worker_id": user["_id"], "status": "offered"})
    active = await db.offers.count_documents(
        {"worker_id": user["_id"], "status": {"$in": ["accepted", "confirmed", "attendance_confirmed", "attended"]}})
    completed = user.get("worker_profile", {}).get("jobs_completed", 0)
    jobs = await db.offers.find(
        {"worker_id": user["_id"], "status": {"$in": ["confirmed", "attendance_confirmed", "attended"]}}
    ).sort("created_at", -1).to_list(10)
    for o in jobs:
        await enrich_offer(o)
    return {"wallet": wallet, "new_offers": new_offers, "active_jobs": active,
            "jobs_completed": completed, "jobs": jobs,
            "availability": user.get("worker_profile", {}).get("availability", "available")}


@router.patch("/availability")
async def set_availability(body: AvailabilityIn, user: dict = wrk):
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"worker_profile.availability": body.status}})
    return {"ok": True, "availability": body.status}


@router.get("/offers")
async def my_offers(user: dict = wrk):
    offers = await db.offers.find({"worker_id": user["_id"], "status": "offered"}).sort("created_at", -1).to_list(100)
    for o in offers:
        await enrich_offer(o)
    return {"offers": offers}


@router.get("/available")
async def available_jobs(user: dict = wrk):
    services = user.get("worker_profile", {}).get("services", [])
    if not services:
        return {"jobs": []}
    reqs = await db.requests.find(
        {"service_type": {"$in": services}, "status": {"$in": ["published", "filling"]}}
    ).sort("created_at", -1).to_list(100)
    mine = await db.offers.distinct("request_id", {"worker_id": user["_id"]})
    jobs = []
    for r in reqs:
        if r["_id"] in mine:
            continue
        accepted = await db.offers.count_documents({"request_id": r["_id"], "status": "accepted"})
        confirmed = await db.offers.count_documents(
            {"request_id": r["_id"], "status": {"$in": ["confirmed", "attendance_confirmed", "attended", "paid"]}})
        if accepted + confirmed >= r["required_count"]:
            continue
        b = await db.users.find_one({"_id": r["business_id"]}, {"business_profile.company_name": 1, "name": 1})
        r["business"] = b
        jobs.append(r)
    return {"jobs": jobs}


@router.post("/offers/{offer_id}/respond")
async def respond(offer_id: str, body: RespondIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] != "offered":
        raise HTTPException(status_code=404, detail="العرض غير موجود أو انتهى")
    r = await db.requests.find_one({"_id": o["request_id"]})
    if body.action == "reject":
        await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "rejected", "responded_at": now_iso()}})
        return {"ok": True, "status": "rejected"}
    if r["status"] not in ("published", "filling"):
        raise HTTPException(status_code=400, detail="انتهت صلاحية هذه الفرصة")
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "accepted", "responded_at": now_iso()}})
    if r["status"] == "published":
        await db.requests.update_one({"_id": r["_id"]}, {"$set": {"status": "filling"}})
    await notify(r["business_id"], "عامل قبل عرضك",
                 f"{user['name']} قبل فرصة: {r['title']} — يمكنك الآن تأكيد الطلب",
                 "accepted", f"/app/business/requests/{r['_id']}")
    return {"ok": True, "status": "accepted"}


@router.post("/apply")
async def apply(body: ApplyIn, user: dict = wrk):
    r = await db.requests.find_one({"_id": body.request_id})
    if not r or r["status"] not in ("published", "filling"):
        raise HTTPException(status_code=404, detail="الفرصة غير متاحة")
    if r["service_type"] not in user.get("worker_profile", {}).get("services", []):
        raise HTTPException(status_code=400, detail="هذه الخدمة غير موجودة في ملفك")
    if await db.offers.find_one({"request_id": body.request_id, "worker_id": user["_id"]}):
        raise HTTPException(status_code=400, detail="لديك عرض مسبق على هذا الطلب")
    o = {
        "_id": new_id(), "request_id": r["_id"], "worker_id": user["_id"],
        "business_id": r["business_id"], "status": "accepted", "is_replacement": False,
        "earning": 0, "created_at": now_iso(), "responded_at": now_iso(),
    }
    await db.offers.insert_one(o)
    if r["status"] == "published":
        await db.requests.update_one({"_id": r["_id"]}, {"$set": {"status": "filling"}})
    await notify(r["business_id"], "تقديم جديد على طلبك",
                 f"{user['name']} قبل فرصة: {r['title']}", "accepted", f"/app/business/requests/{r['_id']}")
    return {"ok": True, "status": "accepted"}


@router.post("/offers/{offer_id}/checkin")
async def checkin(offer_id: str, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] != "confirmed":
        raise HTTPException(status_code=400, detail="لا يمكن تسجيل الحضور الآن")
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "attendance_confirmed",
                                                            "checkin_at": now_iso()}})
    r = await db.requests.find_one({"_id": o["request_id"]})
    await notify(r["business_id"], "عامل سجّل حضوره",
                 f"{user['name']} سجّل حضوره لطلب: {r['title']} — أكّد الحضور من لوحتك",
                 "attendance", f"/app/business/requests/{r['_id']}")
    return {"ok": True}


@router.get("/jobs")
async def my_jobs(user: dict = wrk):
    active = await db.offers.find(
        {"worker_id": user["_id"],
         "status": {"$in": ["accepted", "confirmed", "attendance_confirmed", "attended"]}}
    ).sort("created_at", -1).to_list(100)
    for o in active:
        await enrich_offer(o)
    return {"jobs": active}


@router.get("/history")
async def history(user: dict = wrk):
    done = await db.offers.find(
        {"worker_id": user["_id"], "status": {"$in": ["paid", "no_show", "rejected", "cancelled"]}}
    ).sort("created_at", -1).to_list(200)
    for o in done:
        await enrich_offer(o)
    rated = await db.ratings.distinct("offer_id", {"from_user": user["_id"]})
    return {"history": done, "rated_offer_ids": rated}


@router.post("/rate")
async def rate_business(body: RateBizIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": body.offer_id, "worker_id": user["_id"], "status": "paid"})
    if not o:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة")
    if not 1 <= body.score <= 5:
        raise HTTPException(status_code=400, detail="التقييم من 1 إلى 5")
    await db.ratings.update_one(
        {"offer_id": body.offer_id, "from_user": user["_id"]},
        {"$set": {"to_user": o["business_id"], "request_id": o["request_id"],
                  "score": body.score, "comment": body.comment, "created_at": now_iso(), "_id": new_id()}},
        upsert=True)
    ratings = await db.ratings.find({"to_user": o["business_id"]}).to_list(1000)
    avg = round(sum(x["score"] for x in ratings) / len(ratings), 1)
    await db.users.update_one({"_id": o["business_id"]},
                              {"$set": {"business_profile.rating": avg,
                                        "business_profile.rating_count": len(ratings)}})
    return {"ok": True}


@router.post("/withdrawals")
async def request_withdrawal(body: WithdrawalIn, user: dict = wrk):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="مبلغ غير صالح")
    wallet = await get_wallet(user["_id"])
    if wallet["available"] < body.amount:
        raise HTTPException(status_code=400, detail="الرصيد المتاح غير كافٍ")
    doc = {
        "_id": new_id(), "worker_id": user["_id"], "amount": round(body.amount, 2),
        "bank_name": body.bank_name, "iban": body.iban, "status": "pending",
        "is_demo": True, "created_at": now_iso(),
    }
    await db.withdrawals.insert_one(doc)
    await notify_admins("طلب سحب جديد", f"{user['name']} طلب سحب {body.amount} ر.س",
                        "withdrawal", "/app/admin/withdrawals")
    return {"ok": True, "withdrawal": doc}


@router.get("/withdrawals")
async def my_withdrawals(user: dict = wrk):
    items = await db.withdrawals.find({"worker_id": user["_id"]}).sort("created_at", -1).to_list(100)
    return {"withdrawals": items}
