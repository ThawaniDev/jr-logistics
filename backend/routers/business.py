from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List

from db import db
from deps import require_roles
from catalog import SERVICE_MAP, DEFAULT_COMMISSION_RATE, DURATION_DAYS
from utils import new_id, now_iso, notify, notify_admins, notify_staff, add_txn, get_wallet, recalc_worker_rating, pub, pub_list, get_settings, audit, get_client_pricing, ledger_entry, log_event, resolve_price

router = APIRouter(prefix="/api/business", tags=["business"])
biz = Depends(require_roles("business"))

BUSY_STATUSES = ["accepted", "confirmed", "attendance_confirmed", "attended", "driver_completed",
                 "delivered_reported", "pending_settlement", "qty_disputed"]


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
    # eligibility: no conflicting active job + vehicle compatibility
    busy_ids = set(await db.offers.distinct("worker_id", {"status": {"$in": BUSY_STATUSES}}))
    if request.get("vehicle_type"):
        workers = [w for w in workers
                   if (w.get("worker_profile") or {}).get("vehicle_type") in (None, "", request["vehicle_type"])]
    if request.get("temperature_type"):
        workers = [w for w in workers
                   if (w.get("worker_profile") or {}).get("vehicle_temperature") in (None, "", request["temperature_type"])]
    # provider/office eligibility: linked drivers require a verified office with an accepted agreement
    linked = {w["_id"]: (w.get("worker_profile") or {}).get("provider_id") for w in workers
              if (w.get("worker_profile") or {}).get("provider_status") == "linked"
              and (w.get("worker_profile") or {}).get("provider_id")}
    if linked:
        ok_offices = set()
        async for off in db.users.find({"_id": {"$in": list(set(linked.values()))}, "role": "office"}):
            if (off.get("office_profile") or {}).get("verification_status") in ("verified", "active") and \
                    await db.agreements.find_one({"office_id": off["_id"], "status": "accepted"}):
                ok_offices.add(off["_id"])
        workers = [w for w in workers if w["_id"] not in linked or linked[w["_id"]] in ok_offices]
    # office-specific request: only that office's linked drivers
    if request.get("preferred_office_id"):
        workers = [w for w in workers
                   if (w.get("worker_profile") or {}).get("provider_id") == request["preferred_office_id"]
                   and (w.get("worker_profile") or {}).get("provider_status") == "linked"]
    existing = await db.offers.distinct("worker_id", {"request_id": request["_id"]})
    is_repl = bool(request.get("replacement_requested"))
    offers = []
    for w in workers:
        if w["_id"] in existing or w["_id"] in busy_ids:
            continue
        offers.append({
            "_id": new_id(),
            "request_id": request["_id"],
            "worker_id": w["_id"],
            "business_id": request["business_id"],
            "status": "offered",
            "is_replacement": is_repl,
            "earning": 0,
            "created_at": now_iso(),
            "responded_at": None,
        })
    if offers:
        await db.offers.insert_many(offers)
        svc = SERVICE_MAP[request["service_type"]]
        city = request.get("pickup_city") or request.get("city")
        for o in offers:
            await notify(
                o["worker_id"],
                "فرصة بديلة عاجلة — أول من يقبل يحصل عليها" if is_repl else f"فرصة عمل جديدة: {svc['name']}",
                f"طلب جديد في {city} — راجع التفاصيل الكاملة قبل القبول",
                "offer", "/app/worker/opportunities",
            )
            await log_event(request["_id"], o["_id"], None, "driver_notified",
                            notes="replacement" if is_repl else "initial_match")
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
    temperature_type: Optional[str] = None
    pickup_city: Optional[str] = None
    delivery_city: Optional[str] = None
    requirements: Optional[str] = None
    publish: bool = True
    terms: bool = False
    preferred_office_id: Optional[str] = None


class TopupIn(BaseModel):
    amount: float


class AttendanceIn(BaseModel):
    result: Literal["attended", "no_show"]
    reason: Optional[str] = None


class LoadingIn(BaseModel):
    offer_id: str
    qty: int


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
    pricing = await get_client_pricing(user["_id"])
    rate = pricing["rate"] if pricing else (body.rate if body.rate and body.rate > 0 else settings["default_rate"])
    comm_rate = pricing["commission_rate"] if pricing else settings["commission_rate"]
    total, commission, payout = compute_estimate(
        body.service_type, body.required_count, days, rate, body.shipment_count,
        body.shipments_per_driver, commission_rate=comm_rate)
    return {"duration_days": days, "rate": rate, "estimated_total": total,
            "commission": commission, "payout_total": payout,
            "commission_rate": comm_rate,
            "pricing_source": "client_pricing" if pricing else "platform_default",
            "unit": SERVICE_MAP[body.service_type]["unit"]}


@router.get("/pricing/quote")
async def pricing_quote(vehicle_type: str, pickup_city: str, delivery_city: str,
                        temperature_type: Optional[str] = None, user: dict = biz):
    settings = await get_settings()
    if pickup_city not in settings.get("enabled_pickup_cities", ["الرياض"]):
        return {"ok": False, "message": "مدينة الاستلام غير مفعّلة حالياً — المرحلة الأولى: الرياض فقط"}
    rule = await resolve_price(user["_id"], vehicle_type,
                               temperature_type if vehicle_type != "sedan" else None,
                               pickup_city, delivery_city)
    if not rule:
        return {"ok": False,
                "message": "لا يوجد سعر معتمد لهذا المسار والمركبة. يرجى التواصل مع JR Logistics Operations."}
    return {"ok": True, "price": rule["price"], "version": rule.get("version"),
            "effective_date": rule.get("effective_date"),
            "commission_rate": settings["commission_rate"]}


@router.get("/offices")
async def list_verified_offices(user: dict = biz):
    offices = await db.users.find({"role": "office", "status": "active",
                                   "office_profile.verification_status": {"$in": ["verified", "active"]}}).to_list(200)
    busy = set(await db.offers.distinct("worker_id", {"status": {"$in": BUSY_STATUSES}}))
    out = []
    for o in offices:
        drivers = await db.users.find({"role": "worker", "worker_profile.provider_id": o["_id"],
                                       "worker_profile.provider_status": "linked"}).to_list(500)
        eligible = [d for d in drivers
                    if (d.get("worker_profile") or {}).get("verification_status") == "verified"
                    and (d.get("worker_profile") or {}).get("availability") == "available"
                    and d["_id"] not in busy]
        out.append({"_id": o["_id"],
                    "office_name": (o.get("office_profile") or {}).get("office_name") or o.get("name"),
                    "city": o.get("city"), "drivers_total": len(drivers),
                    "drivers_available": len(eligible)})
    return {"offices": out}


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
    pickup_city = body.pickup_city or body.city
    delivery_city = body.delivery_city or body.city
    if pickup_city not in settings.get("enabled_pickup_cities", ["الرياض"]):
        raise HTTPException(status_code=400,
                            detail="مدينة الاستلام غير مفعّلة حالياً — المرحلة الأولى: الرياض فقط")
    if delivery_city not in settings.get("enabled_delivery_cities", settings["service_areas"]):
        raise HTTPException(status_code=400, detail="مدينة التسليم غير مفعّلة حالياً")
    pricing = await get_client_pricing(user["_id"])
    rule = None
    if svc["needs_vehicle"]:
        rule = await resolve_price(user["_id"], body.vehicle_type,
                                   body.temperature_type if body.vehicle_type != "sedan" else None,
                                   pickup_city, delivery_city)
        if not rule:
            raise HTTPException(status_code=400,
                                detail="لا يوجد سعر معتمد لهذا المسار والمركبة. يرجى التواصل مع JR Logistics Operations.")
    rate = rule["price"] if rule else (pricing["rate"] if pricing else (body.rate if body.rate and body.rate > 0 else settings["default_rate"]))
    commission_rate = pricing["commission_rate"] if pricing else settings["commission_rate"]
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
        "pickup_city": pickup_city,
        "delivery_city": delivery_city,
        "temperature_type": body.temperature_type if body.vehicle_type != "sedan" else None,
        "pricing_version": (rule or pricing or {}).get("version"),
        "pricing_snapshot": {
            "rate": rate, "commission_rate": commission_rate,
            "source": "pricing_rule" if rule else ("client_pricing" if pricing else "platform_default"),
            "pricing_rule_id": (rule or {}).get("_id"),
            "pricing_id": (pricing or {}).get("_id"),
            "vehicle_type": body.vehicle_type,
            "temperature_type": body.temperature_type if body.vehicle_type != "sedan" else None,
            "pickup_city": pickup_city, "delivery_city": delivery_city,
            "business_id": user["_id"],
            "effective_date": (rule or {}).get("effective_date"),
            "at": now_iso(),
        },
        "status": "draft",
        "escrow_reserved": False,
        "replacement_count": 0,
        "is_demo": False,
        "created_at": now_iso(),
    }
    await db.requests.insert_one(doc)
    await log_event(doc["_id"], None, user, "request_created", new_status="draft")
    matched = 0
    if body.publish:
        bp = user.get("business_profile", {})
        if bp.get("verification_status") not in ("verified", "active"):
            raise HTTPException(status_code=403,
                                detail="حساب منشأتك بانتظار التحقق — أكمل البيانات وانتظر اعتماد الإدارة قبل نشر الطلبات")
        await reserve_funds(user["_id"], doc)
        updates = {"status": "published", "published_at": now_iso()}
        if body.terms:
            updates["biz_terms_accepted_at"] = now_iso()
        await db.requests.update_one({"_id": doc["_id"]}, {"$set": updates})
        doc["status"] = "published"
        matched = await match_workers(doc)
        await log_event(doc["_id"], None, user, "request_published",
                        old_status="draft", new_status="published",
                        notes=f"matched={matched}")
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
    await log_event(request_id, None, user, "request_published",
                    old_status="draft", new_status="published", notes=f"matched={matched}")
    await notify(user["_id"], "تم نشر طلبك",
                 f"طلب: {r['title']} — أُرسل لـ {matched} مندوب مطابق",
                 "request", f"/app/business/requests/{request_id}")
    return {"ok": True, "matched_workers": matched}


@router.get("/requests")
async def list_requests(user: dict = biz):
    reqs = await db.requests.find({"business_id": user["_id"]}).sort("created_at", -1).to_list(1000)
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
        await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "attended", "attended_at": now_iso()}})
        if r["status"] == "confirmed":
            await db.requests.update_one({"_id": request_id}, {"$set": {"status": "in_progress"}})
        await audit(user, "attendance_confirmed", "offer", offer_id,
                    after={"request_id": request_id, "worker_id": o["worker_id"]})
        await log_event(request_id, offer_id, user, "attendance_confirmed", new_status="attended")
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


@router.post("/requests/{request_id}/loading")
async def record_loading(request_id: str, body: LoadingIn, user: dict = biz):
    r = await get_owned_request(request_id, user)
    o = await db.offers.find_one({"_id": body.offer_id, "request_id": request_id})
    if not o or o["status"] not in ("attended", "attendance_confirmed", "driver_completed"):
        raise HTTPException(status_code=400, detail="يمكن تسجيل التحميل بعد تأكيد حضور المندوب")
    if body.qty < 0:
        raise HTTPException(status_code=400, detail="كمية غير صالحة")
    await db.offers.update_one({"_id": body.offer_id},
                               {"$set": {"loaded_qty": body.qty, "loaded_at": now_iso(),
                                         "loaded_by": user["_id"], "loading_disputed": False,
                                         "loading_confirmed": False}})
    await notify(o["worker_id"], "تم تسجيل الشحنات المحملة",
                 f"المنشأة سجلت {body.qty} شحنة محملة لمهمة: {r['title']} — أكّد أو اعترض من صفحة مهامك",
                 "attendance", "/app/worker/jobs")
    await audit(user, "loading_recorded", "offer", body.offer_id,
                after={"qty": body.qty, "request_id": request_id})
    await log_event(request_id, body.offer_id, user, "loading_recorded", notes=f"loaded={body.qty}")
    return {"ok": True, "loaded_qty": body.qty}


class DeliveredIn(BaseModel):
    action: Literal["confirm", "dispute"]
    qty: Optional[int] = None
    note: Optional[str] = None


@router.post("/requests/{request_id}/delivered/{offer_id}")
async def confirm_delivered(request_id: str, offer_id: str, body: DeliveredIn, user: dict = biz):
    r = await get_owned_request(request_id, user)
    o = await db.offers.find_one({"_id": offer_id, "request_id": request_id})
    if not o or o["status"] != "delivered_reported":
        raise HTTPException(status_code=400, detail="لا يوجد عدد نهائي بانتظار التأكيد لهذا المندوب")
    if body.action == "confirm":
        final_qty = body.qty if body.qty is not None else o.get("driver_reported_qty")
        if final_qty is None or final_qty < 0:
            raise HTTPException(status_code=400, detail="عدد غير صالح")
        await db.offers.update_one({"_id": offer_id}, {"$set": {
            "status": "pending_settlement", "final_qty": final_qty,
            "qty_confirmed_by": user["_id"], "qty_confirmed_at": now_iso()}})
        await notify(o["worker_id"], "تم تأكيد العدد النهائي",
                     f"أكّدت المنشأة تسليم {final_qty} شحنة لمهمة: {r['title']} — بانتظار التسوية",
                     "completed", "/app/worker/jobs")
        await audit(user, "delivery_confirmed", "offer", offer_id,
                    before={"driver_reported_qty": o.get("driver_reported_qty")},
                    after={"final_qty": final_qty, "request_id": request_id})
        await log_event(request_id, offer_id, user, "delivery_confirmed",
                        old_status="delivered_reported", new_status="pending_settlement",
                        notes=f"final_qty={final_qty}")
        return {"ok": True, "status": "pending_settlement", "final_qty": final_qty}
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "qty_disputed"}})
    ticket = {
        "_id": new_id(), "user_id": user["_id"],
        "subject": f"اختلاف في العدد النهائي — {r['title']}",
        "category": "shipment_count_differs",
        "message": body.note or f"المندوب أفاد بتوصيل {o.get('driver_reported_qty')} — المحملة {o.get('loaded_qty')} — المنشأة تعترض على العدد",
        "request_id": request_id, "offer_id": offer_id,
        "priority": "urgent", "escalation": "operations", "status": "open",
        "activity": [{"action": "created", "by": user["name"], "at": now_iso()}],
        "replies": [], "is_demo": user.get("is_demo", False), "created_at": now_iso(),
    }
    await db.tickets.insert_one(ticket)
    await notify(o["worker_id"], "اعتراض على العدد النهائي",
                 f"المنشأة اعترضت على العدد المُبلغ عنه لمهمة: {r['title']} — الحالة قيد المراجعة ولن تُصرف المستحقات قبل الحل",
                 "support", "/app/worker/jobs")
    await notify_staff("cases", "اختلاف في العدد النهائي",
                       f"{r['title']} — المندوب أفاد بـ {o.get('driver_reported_qty')} والمنشأة تعترض",
                       "case", "/app/admin/cases")
    await notify_admins("اختلاف في العدد النهائي",
                        f"طلب {r['title']} — اختلاف بين المندوب والمنشأة على العدد النهائي",
                        "case", "/app/admin/cases")
    await audit(user, "delivery_disputed", "offer", offer_id,
                before={"driver_reported_qty": o.get("driver_reported_qty"), "loaded_qty": o.get("loaded_qty")},
                after={"note": body.note, "request_id": request_id})
    await log_event(request_id, offer_id, user, "delivery_disputed",
                    old_status="delivered_reported", new_status="qty_disputed", notes=body.note)
    return {"ok": True, "status": "qty_disputed", "ticket_id": ticket["_id"]}


@router.post("/requests/{request_id}/complete")
async def complete_request(request_id: str, user: dict = biz):
    r = await get_owned_request(request_id, user)
    if r["status"] not in ("confirmed", "in_progress"):
        raise HTTPException(status_code=400, detail="لا يمكن إنهاء هذا الطلب في حالته الحالية")
    unresolved = await db.offers.count_documents(
        {"request_id": request_id,
         "status": {"$in": ["accepted", "confirmed", "attendance_confirmed", "attended",
                            "delivered_reported", "driver_completed"]}})
    if unresolved:
        raise HTTPException(status_code=400,
                            detail="يوجد مندوبون لم تُستكمل إجراءاتهم — أكّد الأعداد النهائية لجميع المندوبين أولاً")
    qty_disputed = await db.offers.count_documents({"request_id": request_id, "status": "qty_disputed"})
    if qty_disputed:
        raise HTTPException(status_code=400, detail="يوجد اختلاف في الأعداد قيد المراجعة — يجب حلّه قبل إنشاء التسوية")
    payable = await db.offers.find({"request_id": request_id, "status": "pending_settlement"}).to_list(500)
    if not payable:
        raise HTTPException(status_code=400, detail="لا يوجد عدد نهائي مؤكد — أكّد أعداد التوصيل أولاً")
    disputed = [o for o in payable if o.get("loading_disputed")]
    if disputed:
        raise HTTPException(status_code=400, detail="يوجد نزاع على عدد الشحنات — يجب حلّه عبر الدعم قبل الإنهاء")
    settings = await get_settings()
    vat_pct = settings.get("vat_pct", 15)
    share = round(r["estimated_total"] / r["required_count"], 2)
    rate = r["rate"]
    commission_rate = r.get("commission_rate", DEFAULT_COMMISSION_RATE)
    for o in payable:
        expected_qty = r.get("shipments_per_driver") or 0
        final_qty = o.get("final_qty") if o.get("final_qty") is not None else (
            o.get("loaded_qty") if o.get("loaded_qty") is not None else expected_qty)
        gross = round(rate * final_qty, 2) if expected_qty else share
        commission = round(gross * commission_rate, 2)
        vat = round(commission * vat_pct / 100, 2)
        net = round(gross - commission, 2)
        wp = ((await db.users.find_one({"_id": o["worker_id"]},
                                       {"worker_profile.provider_id": 1,
                                        "worker_profile.provider_status": 1}) or {}).get("worker_profile") or {})
        office_id = wp.get("provider_id") if wp.get("provider_status") == "linked" else None
        settlement = {
            "_id": new_id(), "request_id": request_id, "offer_id": o["_id"],
            "driver_id": o["worker_id"], "business_id": user["_id"],
            "office_id": office_id, "provider_type": "office" if office_id else "driver",
            "expected_qty": expected_qty, "loaded_qty": o.get("loaded_qty"),
            "driver_reported_qty": o.get("driver_reported_qty"),
            "final_qty": final_qty, "rate": rate, "commission_rate": commission_rate,
            "gross": gross, "commission": commission, "vat": vat, "vat_pct": vat_pct,
            "net": net, "reserved_share": share,
            "pricing_version": r.get("pricing_version"),
            "status": "pending_review",
            "is_demo": r.get("is_demo", False), "created_at": now_iso(),
        }
        await db.settlements.insert_one(settlement)
        await db.offers.update_one({"_id": o["_id"]}, {"$set": {"settlement_id": settlement["_id"]}})
        await ledger_entry("settlement_created", gross, "debit", user, user_id=user["_id"],
                           request_id=request_id, settlement_id=settlement["_id"],
                           note=f"تصفية مهمة {r['title']} — بانتظار مراجعة المحاسب")
    await db.requests.update_one({"_id": request_id},
                                 {"$set": {"status": "completed", "completed_at": now_iso(),
                                           "replacement_requested": False,
                                           "settlement_status": "pending_review"}})
    await notify(user["_id"], "اكتمل الطلب — التصفية قيد المراجعة",
                 f"اكتمل طلب: {r['title']} — سيراجع المحاسب التصفية ثم يصرف مستحقات المندوبين",
                 "completed", f"/app/business/requests/{request_id}")
    await notify_staff("settlement_review", "تصفيات جديدة بانتظار المراجعة",
                       f"طلب {r['title']} — {len(payable)} تصفية", "general", "/app/admin/finance")
    await notify_admins("طلب مكتمل بانتظار التسوية", f"{r['title']} — {len(payable)} تصفية معلقة",
                        "completed", "/app/admin/finance")
    await audit(user, "request_completed", "request", request_id,
                after={"settlements_created": len(payable)})
    for o in payable:
        await log_event(request_id, o["_id"], user, "settlement_created",
                        new_status="pending_settlement",
                        notes=f"final_qty={o.get('final_qty')}")
    await log_event(request_id, None, user, "request_completed", new_status="completed")
    return {"ok": True, "settlements_created": len(payable)}


URGENT_REASONS = ["driver_not_arrived", "need_replacement", "attendance_issue", "shipment_issue",
                  "qty_discrepancy", "finish_issue", "communication_issue", "other"]


class UrgentHelpIn(BaseModel):
    reason: str
    note: Optional[str] = None
    offer_id: Optional[str] = None


@router.post("/requests/{request_id}/urgent-help")
async def urgent_help(request_id: str, body: UrgentHelpIn, user: dict = biz):
    r = await get_owned_request(request_id, user)
    if body.reason not in URGENT_REASONS:
        raise HTTPException(status_code=400, detail="سبب غير صالح")
    offer = None
    if body.offer_id:
        offer = await db.offers.find_one({"_id": body.offer_id, "request_id": request_id})
    ticket = {
        "_id": new_id(), "user_id": user["_id"],
        "subject": f"طلب مساعدة عاجلة — {r['title']}",
        "category": "urgent_help",
        "urgent_reason": body.reason,
        "message": body.note or f"مساعدة عاجلة ({body.reason}) لطلب: {r['title']}",
        "request_id": request_id, "offer_id": body.offer_id,
        "driver_id": (offer or {}).get("worker_id"),
        "priority": "urgent", "escalation": "operations", "status": "open",
        "activity": [{"action": "created", "by": user["name"], "at": now_iso()}],
        "replies": [], "is_demo": user.get("is_demo", False), "created_at": now_iso(),
    }
    await db.tickets.insert_one(ticket)
    await notify_staff("cases", "طلب مساعدة عاجلة من مستودع",
                       f"{r['title']} — السبب: {body.reason}", "case", "/app/admin/cases")
    await notify_admins("طلب مساعدة عاجلة", f"{r['title']} — {body.reason}", "case", "/app/admin/cases")
    await log_event(request_id, body.offer_id, user, "urgent_help_requested", notes=body.reason)
    return {"ok": True, "ticket_id": ticket["_id"]}


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
