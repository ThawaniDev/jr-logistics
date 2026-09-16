from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List
from datetime import date, timedelta

from db import db
from deps import require_roles
from catalog import SERVICE_MAP
from utils import new_id, now_iso, notify, notify_admins, notify_staff, add_txn, get_wallet, pub, pub_list

router = APIRouter(prefix="/api/worker", tags=["worker"])
wrk = Depends(require_roles("worker"))


async def enrich_offer(o: dict) -> dict:
    r = await db.requests.find_one({"_id": o["request_id"]})
    o["request"] = pub(r)
    if r:
        b = await db.users.find_one({"_id": r["business_id"]},
                                    {"name": 1, "business_profile.company_name": 1,
                                     "business_profile.rating": 1})
        o["business"] = pub(b)
    return o


class AvailabilityIn(BaseModel):
    status: Literal["available", "unavailable"]


class RespondIn(BaseModel):
    action: Literal["accept", "reject"]
    terms: bool = False


class ApplyIn(BaseModel):
    request_id: str
    terms: bool = False


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
    wp = user.get("worker_profile", {})
    new_offers = await db.offers.count_documents({"worker_id": user["_id"], "status": "offered"})
    active = await db.offers.count_documents(
        {"worker_id": user["_id"],
         "status": {"$in": ["accepted", "confirmed", "attendance_confirmed", "attended", "driver_completed"]}})
    completed = wp.get("jobs_completed", 0)
    jobs = await db.offers.find(
        {"worker_id": user["_id"],
         "status": {"$in": ["accepted", "confirmed", "attendance_confirmed", "attended", "driver_completed"]}}
    ).sort("created_at", -1).to_list(10)
    pending = 0.0
    for o in jobs:
        await enrich_offer(o)
        if o.get("request") and o["status"] in ("confirmed", "attendance_confirmed", "attended", "driver_completed"):
            req = o["request"]
            share = req["estimated_total"] / req["required_count"]
            pending += share * (1 - req.get("commission_rate", 0.10))
    earned = [t for t in await db.transactions.find(
        {"user_id": user["_id"], "type": "earning"}).to_list(500)]
    paid_total = round(sum(t["amount"] for t in earned), 2)
    today = date.today().isoformat()
    soon = (date.today() + timedelta(days=30)).isoformat()
    docs = await db.driver_documents.find({"worker_id": user["_id"]}).to_list(50)
    expiring = [d for d in docs if d["status"] == "verified" and d.get("expiry_date")
                and today <= d["expiry_date"] <= soon]
    for d in expiring:
        if not await db.notifications.find_one({"user_id": user["_id"], "meta.doc_id": d["_id"]}):
            await db.notifications.insert_one({
                "_id": new_id(), "user_id": user["_id"],
                "title": "مستندك يقترب من الانتهاء",
                "body": f"مستند {d['type']} ينتهي بتاريخ {d['expiry_date']} — جدّده لتظل مؤهلاً للفرص",
                "type": "document", "link": "/app/worker/documents", "read": False,
                "meta": {"doc_id": d["_id"]}, "created_at": now_iso()})
    return {"wallet": pub(wallet), "new_offers": new_offers, "active_jobs": active,
            "jobs_completed": completed, "jobs": pub_list(jobs),
            "pending_earnings": round(pending, 2), "paid_earnings": paid_total,
            "verification_status": wp.get("verification_status", "pending"),
            "expiring_docs": len(expiring),
            "availability": wp.get("availability", "available")}


@router.patch("/availability")
async def set_availability(body: AvailabilityIn, user: dict = wrk):
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"worker_profile.availability": body.status}})
    return {"ok": True, "availability": body.status}


@router.get("/offers")
async def my_offers(user: dict = wrk):
    offers = await db.offers.find({"worker_id": user["_id"], "status": "offered"}).sort("created_at", -1).to_list(100)
    for o in offers:
        await enrich_offer(o)
    return {"offers": pub_list(offers)}


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
        r["business"] = pub(b)
        jobs.append(r)
    return {"jobs": pub_list(jobs)}


@router.post("/offers/{offer_id}/respond")
async def respond(offer_id: str, body: RespondIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] != "offered":
        raise HTTPException(status_code=404, detail="العرض غير موجود أو انتهى")
    r = await db.requests.find_one({"_id": o["request_id"]})
    if body.action == "reject":
        await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "rejected", "responded_at": now_iso()}})
        return {"ok": True, "status": "rejected"}
    if user.get("worker_profile", {}).get("verification_status") != "verified":
        raise HTTPException(status_code=403, detail="حسابك غير موثّق — أكمل رفع وتوثيق مستنداتك لقبول الفرص")
    if not body.terms:
        raise HTTPException(status_code=400, detail="يجب الموافقة على الشروط والأحكام قبل قبول الفرصة")
    if r["status"] not in ("published", "filling"):
        raise HTTPException(status_code=400, detail="انتهت صلاحية هذه الفرصة")
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "accepted", "responded_at": now_iso(),
                                                            "terms_accepted_at": now_iso()}})
    if r["status"] == "published":
        await db.requests.update_one({"_id": r["_id"]}, {"$set": {"status": "filling"}})
    await notify(r["business_id"], "مندوب قبل عرضك",
                 f"{user['name']} قبل فرصة: {r['title']} — يمكنك الآن تأكيد الطلب",
                 "accepted", f"/app/business/requests/{r['_id']}")
    if o.get("is_replacement"):
        await notify(r["business_id"], "تم العثور على بديل",
                     f"{user['name']} قبل عرض الاستبدال لطلب: {r['title']}",
                     "replacement", f"/app/business/requests/{r['_id']}")
        await db.requests.update_one({"_id": r["_id"]}, {"$set": {"replacement_requested": False}})
    await notify(user["_id"], "تم استلام قبولك",
                 f"قبلت فرصة: {r['title']} — بانتظار تأكيد المنشأة وحجز المبلغ",
                 "accepted", "/app/worker/jobs")
    return {"ok": True, "status": "accepted"}


@router.post("/apply")
async def apply(body: ApplyIn, user: dict = wrk):
    r = await db.requests.find_one({"_id": body.request_id})
    if not r or r["status"] not in ("published", "filling"):
        raise HTTPException(status_code=404, detail="الفرصة غير متاحة")
    if r["service_type"] not in user.get("worker_profile", {}).get("services", []):
        raise HTTPException(status_code=400, detail="هذه الخدمة غير موجودة في ملفك")
    if user.get("worker_profile", {}).get("verification_status") != "verified":
        raise HTTPException(status_code=403, detail="حسابك غير موثّق — أكمل رفع وتوثيق مستنداتك لقبول الفرص")
    if not body.terms:
        raise HTTPException(status_code=400, detail="يجب الموافقة على الشروط والأحكام قبل قبول الفرصة")
    if await db.offers.find_one({"request_id": body.request_id, "worker_id": user["_id"]}):
        raise HTTPException(status_code=400, detail="لديك عرض مسبق على هذا الطلب")
    o = {
        "_id": new_id(), "request_id": r["_id"], "worker_id": user["_id"],
        "business_id": r["business_id"], "status": "accepted", "is_replacement": False,
        "earning": 0, "created_at": now_iso(), "responded_at": now_iso(),
        "terms_accepted_at": now_iso(),
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
    await notify(r["business_id"], "مندوب سجّل حضوره",
                 f"{user['name']} سجّل حضوره لطلب: {r['title']} — أكّد الحضور من لوحتك",
                 "attendance", f"/app/business/requests/{r['_id']}")
    return {"ok": True}


@router.post("/offers/{offer_id}/finish")
async def finish_job(offer_id: str, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] != "attended":
        raise HTTPException(status_code=400, detail="يمكن إنهاء المهمة بعد تأكيد حضورك من المنشأة")
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "driver_completed",
                                                            "finished_at": now_iso()}})
    r = await db.requests.find_one({"_id": o["request_id"]})
    await notify(r["business_id"], "المندوب أنهى المهمة",
                 f"{user['name']} أنهى مهمة: {r['title']} — أكّد الإتمام لإتمام التسوية وصرف الأرباح",
                 "completed", f"/app/business/requests/{r['_id']}")
    return {"ok": True}


class NoWorkIn(BaseModel):
    note: Optional[str] = None


@router.post("/offers/{offer_id}/no-work")
async def report_no_work(offer_id: str, body: NoWorkIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] not in ("attendance_confirmed", "attended"):
        raise HTTPException(status_code=400, detail="يمكن الإبلاغ بعد تسجيل حضورك في الموقع فقط")
    if o.get("no_work_reported"):
        raise HTTPException(status_code=400, detail="تم الإبلاغ عن هذه المهمة مسبقاً")
    r = await db.requests.find_one({"_id": o["request_id"]})
    await db.offers.update_one({"_id": offer_id}, {"$set": {"no_work_reported": True}})
    ticket = {
        "_id": new_id(), "user_id": user["_id"],
        "subject": f"لم يتم توفير العمل — {r['title']}",
        "category": "not_put_to_work",
        "message": body.note or "حضرت في الموعد والموقع المحددين ولم تُوفر المنشأة العمل المتفق عليه",
        "request_id": r["_id"], "offer_id": offer_id,
        "priority": "urgent", "escalation": "support", "status": "open",
        "activity": [{"action": "created", "by": user["name"], "at": now_iso()}],
        "replies": [], "is_demo": user.get("is_demo", False), "created_at": now_iso(),
    }
    await db.tickets.insert_one(ticket)
    await notify_admins("حالة عدم توفير عمل", f"{user['name']} أبلغ عن عدم توفير العمل — {r['title']}",
                        "case", "/app/admin/cases")
    await notify_staff("cases", "حالة عدم توفير عمل", f"{user['name']} — {r['title']}", "case", "/app/admin/cases")
    return {"ok": True, "ticket_id": ticket["_id"]}


@router.get("/jobs")
async def my_jobs(user: dict = wrk):
    active = await db.offers.find(
        {"worker_id": user["_id"],
         "status": {"$in": ["accepted", "confirmed", "attendance_confirmed", "attended", "driver_completed"]}}
    ).sort("created_at", -1).to_list(100)
    for o in active:
        await enrich_offer(o)
    return {"jobs": pub_list(active)}


@router.get("/history")
async def history(user: dict = wrk):
    done = await db.offers.find(
        {"worker_id": user["_id"], "status": {"$in": ["paid", "no_show", "rejected", "cancelled"]}}
    ).sort("created_at", -1).to_list(200)
    for o in done:
        await enrich_offer(o)
    rated = await db.ratings.distinct("offer_id", {"from_user": user["_id"]})
    return {"history": pub_list(done), "rated_offer_ids": rated}


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
                  "score": body.score, "comment": body.comment, "created_at": now_iso()},
         "$setOnInsert": {"_id": new_id()}},
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
    return {"withdrawals": pub_list(items)}
