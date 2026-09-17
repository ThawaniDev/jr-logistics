from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List

from db import db
from deps import require_roles
from catalog import SERVICE_MAP, DEFAULT_COMMISSION_RATE, DURATION_DAYS
from utils import new_id, now_iso, notify, notify_admins, add_txn, get_wallet, recalc_worker_rating, pub, pub_list, get_settings, audit

router = APIRouter(prefix="/api/business", tags=["business"])
biz = Depends(require_roles("business"))


def compute_estimate(service_key: str, required_count: int, duration_days: int,
                     rate: float, shipment_count: Optional[int],
                     shipments_per_driver: Optional[int] = None,
                     commission_rate: float = DEFAULT_COMMISSION_RATE):
    svc = SERVICE_MAP[service_key]
    if svc["unit"] == "shipment":
        total_shipments = (shipments_per_driver or 0) * required_count or (shipment_count or 0)
        total = round(rate * total_shipments, 2)
    else:
        total = round(rate * required_count * duration_days, 2)
    commission = round(total * commission_rate, 2)
    return total, commission, round(total - commission, 2)


async def match_workers(request: dict) -> int:
    workers = await db.users.find({
        "role": "worker", "status": "active",
        "worker_profile.availability": "available",
        "worker_profile.verification_status": "verified",
        "worker_profile.services": request["service_type"],
    }).to_list(50)
    existing = await db.offers.distinct("worker_id", {"request_id": request["_id"]})
    offers = []
    for w in workers:
        if w["_id"] in existing:
            continue
        offers.append({
            "_id": new_id(),
            "request_id": request["_id"],
            "worker_id": w["_id"],
            "business_id": request["business_id"],
            "status": "offered",
            "is_replacement": False,
            "earning": 0,
            "created_at": now_iso(),
            "responded_at": None,
        })
    if offers:
        await db.offers.insert_many(offers)
        svc = SERVICE_MAP[request["service_type"]]
        for o in offers:
            await notify(
                o["worker_id"],
                f"فرصة عمل جديدة: {svc['name']}",
                f"طلب جديد في {request['city']} — راجع التفاصيل الكاملة قبل القبول",
                "offer", "/app/worker/opportunities",
            )
    return len(offers)


async def reserve_funds(user_id: str, r: dict):
    wallet = await get_wallet(user_id)
    if wallet["available"] < r["estimated_total"]:
        raise HTTPException(status_code=400, detail={
            "code": "INSUFFICIENT_FUNDS",
            "message": "لا يمكن إرسال الطلب، يرجى شحن المحفظة أولاً.",
            "required": r["estimated_total"],
            "available": wallet["available"],
        })
    await db.wallets.update_one({"user_id": user_id},
                                {"$inc": {"available": -r["estimated_total"], "reserved": r["estimated_total"]}})
    await add_txn(user_id, "reserve", r["estimated_total"], "debit",
                  f"حجز تكلفة الطلب: {r['title']}", r["_id"])
    await db.requests.update_one({"_id": r["_id"]}, {"$set": {"escrow_reserved": True}})


class EstimateIn(BaseModel):
    service_type: str
    required_count: int = 1
    duration_type: str = "one_day"
    days_count: int = 1
    rate: float = 0
    shipment_count: Optional[int] = None
    shipments_per_driver: Optional[int] = None


class RequestIn(BaseModel):
    service_type: str
    title: Optional[str] = None
    city: str
    address: str
    required_count: int = 1
    start_date: str
    start_time: str
    duration_type: Literal["one_day", "several_days", "week", "month"] = "one_day"
    days_count: int = 1
    rate: float = 0
    shipment_count: Optional[int] = None
    shipments_per_driver: Optional[int] = None
    vehicle_type: Optional[str] = None
    requirements: Optional[str] = None
    publish: bool = True
    terms: bool = False


class TopupIn(BaseModel):
    amount: float


class AttendanceIn(BaseModel):
    result: Literal["attended", "no_show"]
    reason: Optional[str] = None


class PublishIn(BaseModel):
    terms: bool = False


class RateIn(BaseModel):
    offer_id: str
    score: int
    comment: Optional[str] = None


@router.post("/estimate")
async def estimate(body: EstimateIn, user: dict = biz):
    if body.service_type not in SERVICE_MAP:
        raise HTTPException(status_code=400, detail="نوع الخدمة غير صالح")
    days = DURATION_DAYS.get(body.duration_type) or max(1, body.days_count)
    settings = await get_settings()
    rate = body.rate if body.rate and body.rate > 0 else settings["default_rate"]
    total, commission, payout = compute_estimate(
        body.service_type, body.required_count, days, rate, body.shipment_count,
        body.shipments_per_driver, commission_rate=settings["commission_rate"])
    return {"duration_days": days, "rate": rate, "estimated_total": total,
            "commission": commission, "payout_total": payout,
            "commission_rate": settings["commission_rate"],
            "unit": SERVICE_MAP[body.service_type]["unit"]}


@router.post("/requests")
async def create_request(body: RequestIn, user: dict = biz):
    if body.service_type not in SERVICE_MAP:
        raise HTTPException(status_code=400, detail="نوع الخدمة غير صالح")
    if body.required_count < 1:
        raise HTTPException(status_code=400, detail="تحقق من العدد المطلوب")
    svc = SERVICE_MAP[body.service_type]
    if svc["has_shipments"] and not (body.shipments_per_driver or body.shipment_count):
        raise HTTPException(status_code=400, detail="أدخل عدد الشحنات المتوقع لكل مندوب")
    if svc["needs_vehicle"] and not body.vehicle_type:
        raise HTTPException(status_code=400, detail="حدد نوع المركبة المطلوبة")
    settings = await get_settings()
    rate = body.rate if body.rate and body.rate > 0 else settings["default_rate"]
    commission_rate = settings["commission_rate"]
    shipment_count = (body.shipments_per_driver * body.required_count
                      if body.shipments_per_driver else body.shipment_count)
    days = DURATION_DAYS.get(body.duration_type) or max(1, body.days_count)
    total, commission, payout = compute_estimate(
        body.service_type, body.required_count, days, rate, shipment_count,
        commission_rate=commission_rate)
    doc = {
        "_id": new_id(),
        "business_id": user["_id"],
        "service_type": body.service_type,
        "title": body.title or svc["name"],
        "city": body.city,
        "address": body.address,
        "required_count": body.required_count,
        "start_date": body.start_date,
        "start_time": body.start_time,
        "duration_type": body.duration_type,
        "duration_days": days,
        "rate": rate,
        "commission_rate": commission_rate,
        "shipment_count": shipment_count,
        "shipments_per_driver": body.shipments_per_driver,
        "vehicle_type": body.vehicle_type,
        "requirements": body.requirements,
        "estimated_total": total,
        "commission": commission,
        "payout_total": payout,
        "status": "draft",
        "escrow_reserved": False,
        "replacement_count": 0,
        "is_demo": False,
        "created_at": now_iso(),
    }
    await db.requests.insert_one(doc)
    matched = 0
    if body.publish:
        await reserve_funds(user["_id"], doc)
        updates = {"status": "published", "published_at": now_iso()}
        if body.terms:
            updates["biz_terms_accepted_at"] = now_iso()
        await db.requests.update_one({"_id": doc["_id"]}, {"$set": updates})
        doc["status"] = "published"
        matched = await match_workers(doc)
        await notify(user["_id"], "تم إنشاء طلبك ونشره",
                     f"طلب: {doc['title']} — حُجز {doc['estimated_total']} ر.س وأُرسل لـ {matched} مندوب مطابق",
                     "request", f"/app/business/requests/{doc['_id']}")
    return {"request": doc, "matched_workers": matched}


@router.post("/requests/{request_id}/publish")
async def publish_request(request_id: str, body: PublishIn = None, user: dict = biz):
    body = body or PublishIn()
    r = await get_owned_request(request_id, user)
    if r["status"] != "draft":
        raise HTTPException(status_code=400, detail="يمكن نشر المسودات فقط")
    if not r.get("escrow_reserved"):
        await reserve_funds(user["_id"], r)
    updates = {"status": "published", "published_at": now_iso()}
    if body.terms:
        updates["biz_terms_accepted_at"] = now_iso()
    await db.requests.update_one({"_id": request_id}, {"$set": updates})
    r["status"] = "published"
    matched = await match_workers(r)
    await notify(user["_id"], "تم نشر طلبك",
                 f"طلب: {r['title']} — أُرسل لـ {matched} مندوب مطابق",
                 "request", f"/app/business/requests/{request_id}")
    return {"ok": True, "matched_workers": matched}


@router.get("/requests")
async def list_requests(user: dict = biz):
    reqs = await db.requests.find({"business_id": user["_id"]}).sort("created_at", -1).to_list(200)
    for r in reqs:
        r["counts"] = {}
        for st in ["offered", "accepted", "confirmed", "attendance_confirmed", "attended", "paid", "no_show"]:
            r["counts"][st] = await db.offers.count_documents({"request_id": r["_id"], "status": st})
    return {"requests": pub_list(reqs)}


async def get_owned_request(request_id: str, user: dict) -> dict:
    r = await db.requests.find_one({"_id": request_id})
    if not r or r["business_id"] != user["_id"]:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    return r


VISIBLE_AFTER_ACCEPT = ("accepted", "confirmed", "attendance_confirmed", "attended",
                        "driver_completed", "paid", "no_show")


@router.get("/requests/{request_id}")
async def request_detail(request_id: str, user: dict = biz):
    r = await get_owned_request(request_id, user)
    offers = await db.offers.find({"request_id": request_id}).sort("created_at", 1).to_list(200)
    for o in offers:
        w = await db.users.find_one({"_id": o["worker_id"]},
                                    {"name": 1, "phone": 1, "city": 1, "worker_profile.rating": 1,
                                     "worker_profile.rating_count": 1, "worker_profile.jobs_completed": 1})
        # privacy: contact details revealed only after the driver accepts
        if o["status"] not in VISIBLE_AFTER_ACCEPT and w:
            w.pop("phone", None)
        o["worker"] = pub(w)
    rated = await db.ratings.distinct("offer_id", {"request_id": request_id, "from_user": user["_id"]})
    return {"request": pub(r), "offers": pub_list(offers), "rated_offer_ids": rated,
            "wallet": pub(await get_wallet(user["_id"]))}


@router.post("/requests/{request_id}/confirm")
async def confirm_request(request_id: str, user: dict = biz):
    r = await get_owned_request(request_id, user)
    if r["status"] not in ("published", "filling"):
        raise HTTPException(status_code=400, detail="لا يمكن تأكيد هذا الطلب في حالته الحالية")
    accepted = await db.offers.find({"request_id": request_id, "status": "accepted"}).to_list(500)
    if len(accepted) < r["required_count"]:
        raise HTTPException(status_code=400,
                            detail=f"بانتظار قبول {r['required_count'] - len(accepted)} مندوب إضافي قبل التأكيد")
    if not r.get("escrow_reserved"):
        await reserve_funds(user["_id"], r)
    chosen = accepted[: r["required_count"]]
    for o in chosen:
        await db.offers.update_one({"_id": o["_id"]}, {"$set": {"status": "confirmed"}})
        await notify(o["worker_id"], "تم تأكيدك للمهمة",
                     f"تم تأكيدك في طلب: {r['title']} — {r['city']} بتاريخ {r['start_date']}",
                     "confirmed", "/app/worker/jobs")
    for o in accepted[r["required_count"]:]:
        await db.offers.update_one({"_id": o["_id"]}, {"$set": {"status": "cancelled"}})
        await notify(o["worker_id"], "اعتذار عن فرصة", f"اكتمل عدد المطلوبين لطلب: {r['title']}", "general")
    await db.requests.update_one({"_id": request_id},
                                 {"$set": {"status": "confirmed", "confirmed_at": now_iso()}})
    return {"ok": True, "reserved": r["estimated_total"], "confirmed_workers": len(chosen)}


@router.post("/requests/{request_id}/attendance/{offer_id}")
async def mark_attendance(request_id: str, offer_id: str, body: AttendanceIn, user: dict = biz):
    r = await get_owned_request(request_id, user)
    o = await db.offers.find_one({"_id": offer_id, "request_id": request_id})
    if not o or o["status"] not in ("confirmed", "attendance_confirmed"):
        raise HTTPException(status_code=400, detail="لا يمكن تحديث حضور هذا المندوب")
    if body.result == "attended":
        await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "attended"}})
        if r["status"] == "confirmed":
            await db.requests.update_one({"_id": request_id}, {"$set": {"status": "in_progress"}})
        return {"ok": True, "status": "attended"}
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "no_show", "no_show_reason": body.reason}})
    await db.cancellations.insert_one({
        "_id": new_id(), "party": "worker", "kind": "no_show",
        "request_id": request_id, "offer_id": offer_id, "worker_id": o["worker_id"],
        "business_id": user["_id"], "reason": body.reason or "لم يحضر في الموعد المحدد",
        "created_at": now_iso()})
    await db.requests.update_one({"_id": request_id},
                                 {"$inc": {"replacement_count": 1}, "$set": {"replacement_requested": True}})
    w = await db.users.find_one({"_id": o["worker_id"]}, {"name": 1})
    matched = await match_workers(r)
    await notify_admins("بلاغ تغيّب مندوب",
                        f"المندوب {w['name']} لم يحضر لطلب: {r['title']} — تم إرسال عروض بديلة لـ {matched} مندوب",
                        "replacement", "/app/admin/requests")
    await notify(user["_id"], "تم تسجيل تغيّب وبدء البحث عن بديل",
                 f"تم إرسال {matched} عرض بديل لطلب: {r['title']}", "replacement",
                 f"/app/business/requests/{request_id}")
    return {"ok": True, "status": "no_show", "replacement_offers": matched}


@router.post("/requests/{request_id}/complete")
async def complete_request(request_id: str, user: dict = biz):
    r = await get_owned_request(request_id, user)
    if r["status"] not in ("confirmed", "in_progress"):
        raise HTTPException(status_code=400, detail="لا يمكن إنهاء هذا الطلب في حالته الحالية")
    payable = await db.offers.find(
        {"request_id": request_id, "status": {"$in": ["attended", "attendance_confirmed", "driver_completed"]}}).to_list(500)
    if not payable:
        raise HTTPException(status_code=400, detail="لا يوجد حضور مؤكد — سجّل حضور العمال أولاً")
    share = round(r["estimated_total"] / r["required_count"], 2)
    released = 0.0
    for o in payable:
        earning = share
        commission = round(earning * r.get("commission_rate", DEFAULT_COMMISSION_RATE), 2)
        net = round(earning - commission, 2)
        released += earning
        await db.wallets.update_one({"user_id": o["worker_id"]}, {"$inc": {"available": net}})
        await db.offers.update_one({"_id": o["_id"]}, {"$set": {"status": "paid", "earning": net}})
        await db.users.update_one({"_id": o["worker_id"]}, {"$inc": {"worker_profile.jobs_completed": 1}})
        await add_txn(o["worker_id"], "earning", net, "credit",
                      f"أرباح مهمة: {r['title']} (بعد عمولة المنصة {commission} ر.س)", request_id)
        await add_txn("platform", "commission", commission, "credit",
                      f"عمولة المنصة — طلب: {r['title']}", request_id)
        await notify(o["worker_id"], "تم إيداع أرباحك",
                     f"تم إيداع {net} ر.س في محفظتك عن مهمة: {r['title']}", "earning", "/app/worker/wallet")
    refund = round(r["estimated_total"] - released, 2)
    await db.wallets.update_one({"user_id": user["_id"]},
                                {"$inc": {"reserved": -r["estimated_total"], "available": refund}})
    await add_txn(user["_id"], "release", released, "debit",
                  f"تسوية طلب مكتمل: {r['title']} (صُرف للمندوبين {released} ر.س)", request_id)
    if refund > 0:
        await add_txn(user["_id"], "refund", refund, "credit",
                      f"استرداد مقاعد غير مشغولة — {r['title']}", request_id)
    await db.requests.update_one({"_id": request_id},
                                 {"$set": {"status": "completed", "completed_at": now_iso(),
                                           "replacement_requested": False}})
    await notify(user["_id"], "اكتمل الطلب وتمت التسوية",
                 f"تم صرف {released} ر.س للمندوبين وإرجاع {refund} ر.س لمحفظتك — {r['title']}",
                 "completed", f"/app/business/requests/{request_id}")
    return {"ok": True, "paid_workers": len(payable), "released": released, "refunded": refund}


class CancelRequestIn(BaseModel):
    reason: Optional[str] = None


@router.post("/requests/{request_id}/cancel")
async def cancel_request(request_id: str, body: CancelRequestIn = None, user: dict = biz):
    body = body or CancelRequestIn()
    r = await get_owned_request(request_id, user)
    if r["status"] in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="الطلب منتهي بالفعل")
    if r.get("escrow_reserved"):
        await db.wallets.update_one({"user_id": user["_id"]},
                                    {"$inc": {"reserved": -r["estimated_total"], "available": r["estimated_total"]}})
        await add_txn(user["_id"], "refund", r["estimated_total"], "credit",
                      f"استرداد حجز طلب ملغي: {r['title']}", request_id)
        await db.requests.update_one({"_id": request_id}, {"$set": {"escrow_reserved": False}})
    await db.offers.update_many(
        {"request_id": request_id, "status": {"$in": ["offered", "accepted", "confirmed", "attendance_confirmed"]}},
        {"$set": {"status": "cancelled"}})
    await db.cancellations.insert_one({
        "_id": new_id(), "party": "business", "kind": "cancellation",
        "request_id": request_id, "offer_id": None, "worker_id": None,
        "business_id": user["_id"], "reason": (body.reason or "إلغاء من المنشأة").strip(),
        "created_at": now_iso()})
    await audit(user, "business_cancelled", "request", request_id,
                after={"reason": body.reason})
    await db.requests.update_one({"_id": request_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


@router.post("/requests/{request_id}/rate")
async def rate_worker(request_id: str, body: RateIn, user: dict = biz):
    r = await get_owned_request(request_id, user)
    if r["status"] != "completed":
        raise HTTPException(status_code=400, detail="يمكن التقييم بعد اكتمال الطلب")
    o = await db.offers.find_one({"_id": body.offer_id, "request_id": request_id, "status": "paid"})
    if not o:
        raise HTTPException(status_code=404, detail="العامل غير موجود")
    if not 1 <= body.score <= 5:
        raise HTTPException(status_code=400, detail="التقييم من 1 إلى 5")
    await db.ratings.update_one(
        {"request_id": request_id, "offer_id": body.offer_id, "from_user": user["_id"]},
        {"$set": {"to_user": o["worker_id"], "score": body.score, "comment": body.comment,
                  "created_at": now_iso()},
         "$setOnInsert": {"_id": new_id()}},
        upsert=True)
    await recalc_worker_rating(o["worker_id"])
    return {"ok": True}


@router.post("/wallet/topup")
async def topup(body: TopupIn, user: dict = biz):
    if body.amount <= 0 or body.amount > 1_000_000:
        raise HTTPException(status_code=400, detail="مبلغ غير صالح")
    await db.wallets.update_one({"user_id": user["_id"]}, {"$inc": {"available": body.amount}})
    await add_txn(user["_id"], "topup", body.amount, "credit", "شحن محفظة (أموال تجريبية)")
    return {"ok": True, "wallet": await get_wallet(user["_id"])}


@router.get("/overview")
async def overview(user: dict = biz):
    wallet = await get_wallet(user["_id"])
    counts = {}
    for st in ["draft", "published", "filling", "confirmed", "in_progress", "completed", "cancelled"]:
        counts[st] = await db.requests.count_documents({"business_id": user["_id"], "status": st})
    pending_attendance = await db.offers.count_documents(
        {"business_id": user["_id"], "status": "attendance_confirmed"})
    spent = await db.transactions.aggregate(
        [{"$match": {"user_id": user["_id"], "type": "release"}},
         {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
    fees = await db.requests.aggregate(
        [{"$match": {"business_id": user["_id"], "status": "completed"}},
         {"$group": {"_id": None, "t": {"$sum": "$commission"}}}]).to_list(1)
    recent = await db.requests.find({"business_id": user["_id"]}).sort("created_at", -1).to_list(5)
    for r in recent:
        r["counts"] = {"accepted": await db.offers.count_documents({"request_id": r["_id"], "status": "accepted"})}
    return {"wallet": pub(wallet), "counts": counts, "pending_attendance": pending_attendance,
            "total_spent": round(spent[0]["t"], 2) if spent else 0,
            "platform_fees": round(fees[0]["t"], 2) if fees else 0,
            "recent": pub_list(recent)}
