from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List
from datetime import date, timedelta, datetime, timezone

from db import db
from deps import require_roles
from catalog import SERVICE_MAP
from utils import new_id, now_iso, notify, notify_admins, notify_staff, add_txn, get_wallet, pub, pub_list, get_settings, audit, log_event, provider_blocks_paid_work

router = APIRouter(prefix="/api/worker", tags=["worker"])
wrk = Depends(require_roles("worker"))

ACTIVE_JOB_STATUSES = ["accepted", "confirmed", "attendance_confirmed", "attended", "driver_completed",
                       "delivered_reported", "pending_settlement", "qty_disputed"]


async def enrich_offer(o: dict) -> dict:
    r = await db.requests.find_one({"_id": o["request_id"]})
    o["request"] = pub(r)
    if o["request"]:
        # driver financial privacy: never expose client price / commission / internal math
        share = r["estimated_total"] / max(1, r["required_count"])
        o["request"]["expected_earning"] = round(share * (1 - r.get("commission_rate", 0.10)), 2)
        for f in ("rate", "estimated_total", "commission", "commission_rate",
                  "payout_total", "pricing_snapshot", "pricing_version"):
            o["request"].pop(f, None)
    if r:
        b = await db.users.find_one({"_id": r["business_id"]},
                                    {"name": 1, "business_profile.company_name": 1,
                                     "business_profile.rating": 1})
        o["business"] = pub(b)
    return o


def ranges_overlap(a_start: str, a_days: int, b_start: str, b_days: int) -> bool:
    a0 = date.fromisoformat(a_start)
    a1 = a0 + timedelta(days=max(1, a_days) - 1)
    b0 = date.fromisoformat(b_start)
    b1 = b0 + timedelta(days=max(1, b_days) - 1)
    return a0 <= b1 and b0 <= a1


async def find_overlapping_job(worker_id: str, req: dict) -> Optional[dict]:
    """A driver may hold only one active job per overlapping time window."""
    offers = await db.offers.find(
        {"worker_id": worker_id, "request_id": {"$ne": req["_id"]},
         "status": {"$in": ACTIVE_JOB_STATUSES}}).to_list(50)
    if not offers:
        return None
    reqs = {r["_id"]: r async for r in db.requests.find(
        {"_id": {"$in": [o["request_id"] for o in offers]}})}
    for o in offers:
        er = reqs.get(o["request_id"])
        if er and ranges_overlap(req["start_date"], req.get("duration_days", 1),
                                 er["start_date"], er.get("duration_days", 1)):
            return er
    return None


async def ensure_acceptable(user: dict, req: dict):
    wp = user.get("worker_profile", {})
    if wp.get("verification_status") != "verified":
        raise HTTPException(status_code=403, detail="حسابك غير موثّق — أكمل رفع وتوثيق مستنداتك لقبول الفرص")
    until = wp.get("suspended_until")
    if until and until > now_iso():
        raise HTTPException(status_code=403,
                            detail=f"حسابك موقوف مؤقتاً حتى {until[:10]} وفق سياسة الإلغاء — تواصل مع الدعم")
    if await provider_blocks_paid_work(user):
        raise HTTPException(status_code=400, detail={
            "code": "PROVIDER_NOT_ELIGIBLE",
            "message": "مكتب التوصيل المرتبط بحسابك غير مؤهل حالياً (التحقق أو الاتفاقية غير مكتملة) — تواصل مع مكتبك أو الدعم",
        })
    active = await db.offers.find_one({"worker_id": user["_id"], "request_id": {"$ne": req["_id"]},
                                       "status": {"$in": ACTIVE_JOB_STATUSES}})
    if active:
        raise HTTPException(status_code=400, detail={
            "code": "ACTIVE_JOB",
            "message": "لديك مهمة نشطة حالياً — أكملها أولاً أو ألغِها وفق السياسة قبل قبول فرصة أخرى",
        })
    overlap = await find_overlapping_job(user["_id"], req)
    if overlap:
        raise HTTPException(status_code=400, detail={
            "code": "OVERLAPPING_JOB",
            "message": "لديك مهمة نشطة في نفس الفترة — أكملها أو ألغِها وفق السياسة قبل قبول فرصة أخرى",
            "conflict_title": overlap.get("title"),
            "conflict_date": overlap.get("start_date"),
        })


class AvailabilityIn(BaseModel):
    status: Literal["available", "unavailable"]


class RespondIn(BaseModel):
    action: Literal["accept", "reject"]
    terms: bool = False


class ApplyIn(BaseModel):
    request_id: str
    terms: bool = False


class CancelJobIn(BaseModel):
    reason: str


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
        {"worker_id": user["_id"], "status": {"$in": ACTIVE_JOB_STATUSES}})
    completed = wp.get("jobs_completed", 0)
    jobs = await db.offers.find(
        {"worker_id": user["_id"], "status": {"$in": ACTIVE_JOB_STATUSES}}
    ).sort("created_at", -1).to_list(10)
    pending = 0.0
    for o in jobs:
        await enrich_offer(o)
        if o.get("request") and o["status"] in ("confirmed", "attendance_confirmed", "attended", "driver_completed"):
            pending += o["request"].get("expected_earning", 0)
    pend_settlements = await db.settlements.find(
        {"driver_id": user["_id"], "status": {"$in": ["pending_review", "under_review", "approved"]}}).to_list(500)
    pending += sum(s["net"] for s in pend_settlements)
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
            "cancel_count": wp.get("cancel_count", 0),
            "suspended_until": wp.get("suspended_until"),
            "availability": wp.get("availability", "available")}


@router.patch("/availability")
async def set_availability(body: AvailabilityIn, user: dict = wrk):
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"worker_profile.availability": body.status}})
    return {"ok": True, "availability": body.status}


@router.get("/offers")
async def my_offers(user: dict = wrk):
    has_active = bool(await db.offers.find_one({"worker_id": user["_id"], "status": {"$in": ACTIVE_JOB_STATUSES}}))
    if has_active:
        return {"offers": [], "has_active_job": True}
    offers = await db.offers.find({"worker_id": user["_id"], "status": "offered"}).sort("created_at", -1).to_list(100)
    for o in offers:
        await enrich_offer(o)
    return {"offers": pub_list(offers), "has_active_job": False}


@router.get("/available")
async def available_jobs(user: dict = wrk):
    wp = user.get("worker_profile", {})
    services = wp.get("services", [])
    if not services:
        return {"jobs": []}
    has_active = bool(await db.offers.find_one({"worker_id": user["_id"], "status": {"$in": ACTIVE_JOB_STATUSES}}))
    if has_active:
        return {"jobs": [], "has_active_job": True}
    reqs = await db.requests.find(
        {"service_type": {"$in": services}, "status": {"$in": ["published", "filling"]}}
    ).sort("created_at", -1).to_list(100)
    mine = await db.offers.distinct("request_id", {"worker_id": user["_id"]})
    suspended = bool(wp.get("suspended_until") and wp["suspended_until"] > now_iso())
    jobs = []
    for r in reqs:
        if r["_id"] in mine:
            continue
        accepted = await db.offers.count_documents({"request_id": r["_id"], "status": "accepted"})
        confirmed = await db.offers.count_documents(
            {"request_id": r["_id"], "status": {"$in": ["confirmed", "attendance_confirmed", "attended", "paid"]}})
        if accepted + confirmed >= r["required_count"]:
            continue
        if suspended or await find_overlapping_job(user["_id"], r):
            continue
        b = await db.users.find_one({"_id": r["business_id"]}, {"business_profile.company_name": 1, "name": 1})
        r["business"] = pub(b)
        # driver financial privacy — expose expected net earning only
        share = r["estimated_total"] / max(1, r["required_count"])
        r["expected_earning"] = round(share * (1 - r.get("commission_rate", 0.10)), 2)
        for f in ("rate", "estimated_total", "commission", "commission_rate",
                  "payout_total", "pricing_snapshot", "pricing_version"):
            r.pop(f, None)
        jobs.append(r)
    return {"jobs": pub_list(jobs), "has_active_job": False}


@router.post("/offers/{offer_id}/respond")
async def respond(offer_id: str, body: RespondIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] != "offered":
        raise HTTPException(status_code=404, detail="العرض غير موجود أو انتهى")
    r = await db.requests.find_one({"_id": o["request_id"]})
    if body.action == "reject":
        await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "rejected", "responded_at": now_iso()}})
        return {"ok": True, "status": "rejected"}
    if not body.terms:
        raise HTTPException(status_code=400, detail="يجب الموافقة على الشروط والأحكام قبل قبول الفرصة")
    await ensure_acceptable(user, r)
    if r["status"] not in ("published", "filling"):
        raise HTTPException(status_code=400, detail="انتهت صلاحية هذه الفرصة")
    res = await db.offers.update_one({"_id": offer_id, "status": "offered"},
                                     {"$set": {"status": "accepted", "responded_at": now_iso(),
                                               "terms_accepted_at": now_iso()}})
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="تم حجز هذه الفرصة بالفعل — لم تعد متاحة")
    await audit(user, "driver_accepted", "offer", offer_id,
                after={"request_id": r["_id"], "title": r["title"]})
    await log_event(r["_id"], offer_id, user, "driver_accepted",
                    old_status="offered", new_status="accepted")
    filled = await db.offers.count_documents({"request_id": r["_id"], "status": {"$in": ACTIVE_JOB_STATUSES}})
    if filled >= r.get("required_count", 1):
        await db.offers.update_many({"request_id": r["_id"], "status": "offered"},
                                    {"$set": {"status": "replacement_locked", "locked_at": now_iso()}})
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
    if not body.terms:
        raise HTTPException(status_code=400, detail="يجب الموافقة على الشروط والأحكام قبل قبول الفرصة")
    await ensure_acceptable(user, r)
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


@router.post("/offers/{offer_id}/cancel")
async def cancel_job(offer_id: str, body: CancelJobIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] not in ("accepted", "confirmed"):
        raise HTTPException(status_code=400, detail="لا يمكن إلغاء هذه المهمة في حالتها الحالية")
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="أدخل سبب الإلغاء")
    r = await db.requests.find_one({"_id": o["request_id"]})
    settings = await get_settings()
    was_confirmed = o["status"] == "confirmed"
    await db.offers.update_one({"_id": offer_id},
                               {"$set": {"status": "cancelled", "cancelled_at": now_iso(),
                                         "cancelled_by": "worker", "cancel_reason": reason}})
    await db.cancellations.insert_one({
        "_id": new_id(), "party": "worker", "kind": "cancellation",
        "request_id": r["_id"], "offer_id": offer_id, "worker_id": user["_id"],
        "business_id": r["business_id"], "reason": reason, "created_at": now_iso()})
    count = user.get("worker_profile", {}).get("cancel_count", 0) + 1
    week_key = date.today().isocalendar()  # (year, week, weekday)
    week_id = f"{week_key[0]}-W{week_key[1]:02d}"
    wp_now = user.get("worker_profile", {})
    week_count = (wp_now.get("cancel_count_week", 0) if wp_now.get("cancel_week") == week_id else 0) + 1
    weekly_limit = settings.get("cancel_weekly_limit", 3)
    upd = {"worker_profile.cancel_count": count,
           "worker_profile.cancel_week": week_id,
           "worker_profile.cancel_count_week": week_count}
    if week_count > weekly_limit:
        until = (datetime.now(timezone.utc) + timedelta(days=settings["cancel_suspend_days"])).isoformat()
        upd["worker_profile.suspended_until"] = until
        await notify(user["_id"], "إيقاف مؤقت للحساب",
                     f"تجاوزت حد الإلغاءات الأسبوعي ({weekly_limit}) — تم إيقاف حسابك مؤقتاً حتى {until[:10]} وفق سياسة المنصة",
                     "general", "/app/support")
        await notify_admins("إيقاف مؤقت لمندوب",
                            f"{user['name']} تجاوز حد الإلغاءات الأسبوعي ({week_count}/{weekly_limit}) — موقوف حتى {until[:10]}",
                            "general", "/app/admin/users")
    elif week_count >= weekly_limit or count >= settings["cancel_warning_threshold"]:
        await notify(user["_id"], "تنبيه بشأن الإلغاءات",
                     f"إلغاءاتك هذا الأسبوع: {week_count} من {weekly_limit} — تجاوز الحد يؤدي لإيقاف مؤقت وفق سياسة المنصة",
                     "general", "/app/worker/jobs")
    await db.users.update_one({"_id": user["_id"]}, {"$set": upd})
    req_updates = {"replacement_requested": True}
    if was_confirmed and r["status"] in ("confirmed", "in_progress"):
        req_updates["status"] = "filling"
    await db.requests.update_one({"_id": r["_id"]},
                                 {"$set": req_updates, "$inc": {"replacement_count": 1}})
    matched = 0
    if r["status"] in ("published", "filling", "confirmed", "in_progress"):
        from routers.business import match_workers
        matched = await match_workers({**r, **req_updates})
    await notify(r["business_id"], "المندوب اعتذر عن المهمة",
                 f"{user['name']} ألغى مشاركته في: {r['title']} — السبب: {reason}. أُرسلت {matched} عروض بديلة",
                 "replacement", f"/app/business/requests/{r['_id']}")
    await notify_admins("إلغاء مندوب", f"{user['name']} ألغى مهمة: {r['title']} — السبب: {reason}",
                        "replacement", "/app/admin/requests")
    await audit(user, "driver_cancelled", "offer", offer_id,
                after={"reason": reason, "request_id": r["_id"], "week_count": week_count})
    await log_event(r["_id"], offer_id, user, "driver_cancelled",
                    new_status="cancelled", notes=reason)
    return {"ok": True, "replacement_offers": matched}


# ---------- Provider (courier office) relationship ----------

@router.get("/provider")
async def my_provider(user: dict = wrk):
    wp = user.get("worker_profile", {})
    out = {"provider_type": wp.get("provider_type", "direct"),
           "provider_status": wp.get("provider_status", "direct"),
           "provider_since": wp.get("provider_since"), "office": None}
    if wp.get("provider_id"):
        off = await db.users.find_one({"_id": wp["provider_id"]}, {"name": 1, "office_profile": 1})
        if off:
            out["office"] = {"_id": off["_id"],
                             "name": (off.get("office_profile") or {}).get("office_name") or off["name"],
                             "verification_status": (off.get("office_profile") or {}).get("verification_status")}
    return out


@router.get("/provider-invites")
async def provider_invites(user: dict = wrk):
    invites = await db.office_invites.find({"phone": user["phone"], "status": "pending"}) \
        .sort("created_at", -1).to_list(20)
    for iv in invites:
        off = await db.users.find_one({"_id": iv["office_id"]}, {"name": 1, "office_profile": 1})
        iv["office_name"] = ((off or {}).get("office_profile") or {}).get("office_name") or (off or {}).get("name")
    return {"invites": pub_list(invites)}


class InviteRespondIn(BaseModel):
    action: str


@router.post("/provider-invites/{invite_id}/respond")
async def respond_provider_invite(invite_id: str, body: InviteRespondIn, user: dict = wrk):
    iv = await db.office_invites.find_one({"_id": invite_id, "phone": user["phone"], "status": "pending"})
    if not iv:
        raise HTTPException(status_code=404, detail="الدعوة غير موجودة أو انتهت")
    if body.action == "decline":
        await db.office_invites.update_one({"_id": invite_id},
                                           {"$set": {"status": "declined", "responded_at": now_iso()}})
        await notify(iv["office_id"], "اعتذر مندوب عن الدعوة",
                     f"{user['name']} اعتذر عن الانضمام لمكتبك", "general", "/app/office/drivers")
        await audit(user, "provider_invite_declined", "office_invite", invite_id)
        return {"ok": True, "status": "declined"}
    if body.action != "accept":
        raise HTTPException(status_code=400, detail="إجراء غير صالح")
    office = await db.users.find_one({"_id": iv["office_id"], "role": "office"})
    if not office:
        raise HTTPException(status_code=400, detail="المكتب غير موجود")
    wp = user.get("worker_profile", {})
    if wp.get("provider_status") == "linked" and wp.get("provider_id") != iv["office_id"]:
        raise HTTPException(status_code=400, detail="أنت مرتبط بمكتب آخر — ألغِ الارتباط الحالي أولاً")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {
        "worker_profile.provider_id": iv["office_id"], "worker_profile.provider_type": "office",
        "worker_profile.provider_status": "linked", "worker_profile.provider_since": now_iso()}})
    await db.office_invites.update_one({"_id": invite_id}, {"$set": {
        "status": "accepted", "responded_at": now_iso(), "accepted_by": user["_id"]}})
    await notify(iv["office_id"], "مندوب جديد انضم لمكتبك",
                 f"{user['name']} قبل دعوة الارتباط", "general", "/app/office/drivers")
    await audit(user, "provider_linked", "office_invite", invite_id,
                after={"office_id": iv["office_id"]})
    return {"ok": True, "status": "linked"}


@router.post("/offers/{offer_id}/checkin")
async def checkin(offer_id: str, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] != "confirmed":
        raise HTTPException(status_code=400, detail="لا يمكن تسجيل الحضور الآن")
    arrived_at = now_iso()
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "attendance_confirmed",
                                                            "checkin_at": arrived_at,
                                                            "arrived_at": arrived_at}})
    r = await db.requests.find_one({"_id": o["request_id"]})
    await notify(r["business_id"], "وصل المندوب إلى الموقع",
                 f"{user['name']} وصل لطلب: {r['title']} — يرجى تأكيد الحضور من لوحتك",
                 "attendance", f"/app/business/requests/{r['_id']}")
    await audit(user, "driver_arrived", "offer", offer_id,
                after={"request_id": r["_id"], "arrived_at": arrived_at})
    await log_event(r["_id"], offer_id, user, "driver_arrived",
                    old_status="confirmed", new_status="attendance_confirmed")
    return {"ok": True}


class FinishIn(BaseModel):
    delivered_qty: int


@router.post("/offers/{offer_id}/finish")
async def finish_job(offer_id: str, body: FinishIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o["status"] != "attended":
        raise HTTPException(status_code=400, detail="يمكن إنهاء الفرصة بعد تأكيد حضورك من المنشأة")
    if body.delivered_qty is None or body.delivered_qty < 0:
        raise HTTPException(status_code=400, detail="أدخل عدد الشحنات التي تم توصيلها")
    if o.get("loaded_qty") is not None and not o.get("loading_confirmed"):
        raise HTTPException(status_code=400, detail="أكّد كمية الشحنات المحملة أولاً قبل إنهاء الفرصة")
    r = await db.requests.find_one({"_id": o["request_id"]})
    expected = r.get("shipments_per_driver") or 0
    loaded = o.get("loaded_qty") if o.get("loaded_qty") is not None else expected
    await db.offers.update_one({"_id": offer_id}, {"$set": {"status": "delivered_reported",
                                                            "driver_reported_qty": body.delivered_qty,
                                                            "finished_at": now_iso()}})
    await notify(r["business_id"], "المندوب أنهى الفرصة",
                 f"الشحنات المحملة: {loaded} — الشحنات التي أفاد المندوب بتوصيلها: {body.delivered_qty} — يرجى مراجعة العدد وتأكيده.",
                 "completed", f"/app/business/requests/{r['_id']}")
    await audit(user, "driver_finished", "offer", offer_id,
                after={"request_id": r["_id"], "loaded_qty": o.get("loaded_qty"),
                       "driver_reported_qty": body.delivered_qty})
    await log_event(r["_id"], offer_id, user, "driver_finished",
                    old_status="attended", new_status="delivered_reported",
                    notes=f"delivered={body.delivered_qty}, loaded={loaded}")
    return {"ok": True, "status": "delivered_reported"}


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


@router.post("/offers/{offer_id}/confirm-loading")
async def confirm_loading(offer_id: str, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o.get("loaded_qty") is None:
        raise HTTPException(status_code=400, detail="لم تسجّل المنشأة كمية الشحنات بعد")
    if o.get("loading_confirmed") or o.get("loading_disputed"):
        raise HTTPException(status_code=400, detail="تم التعامل مع هذه الكمية مسبقاً")
    await db.offers.update_one({"_id": offer_id},
                               {"$set": {"loading_confirmed": True, "loading_confirmed_at": now_iso()}})
    await audit(user, "loading_confirmed", "offer", offer_id, after={"loaded_qty": o.get("loaded_qty")})
    await log_event(o["request_id"], offer_id, user, "loading_confirmed_by_driver")
    r = await db.requests.find_one({"_id": o["request_id"]})
    await notify(r["business_id"], "المندوب أكّد كمية الشحنات",
                 f"{user['name']} أكّد تحميل {o['loaded_qty']} شحنة — {r['title']}",
                 "attendance", f"/app/business/requests/{r['_id']}")
    return {"ok": True}


class LoadingDisputeIn(BaseModel):
    note: Optional[str] = None


@router.post("/offers/{offer_id}/dispute-loading")
async def dispute_loading(offer_id: str, body: LoadingDisputeIn, user: dict = wrk):
    o = await db.offers.find_one({"_id": offer_id, "worker_id": user["_id"]})
    if not o or o.get("loaded_qty") is None:
        raise HTTPException(status_code=400, detail="لم تسجّل المنشأة كمية الشحنات بعد")
    if o.get("loading_confirmed") or o.get("loading_disputed"):
        raise HTTPException(status_code=400, detail="تم التعامل مع هذه الكمية مسبقاً")
    await db.offers.update_one({"_id": offer_id}, {"$set": {"loading_disputed": True}})
    await audit(user, "loading_disputed", "offer", offer_id, after={"loaded_qty": o.get("loaded_qty")})
    await log_event(o["request_id"], offer_id, user, "loading_disputed_by_driver")
    r = await db.requests.find_one({"_id": o["request_id"]})
    ticket = {
        "_id": new_id(), "user_id": user["_id"],
        "subject": f"اعتراض على عدد الشحنات — {r['title']}",
        "category": "shipment_count_differs",
        "message": body.note or f"أعترض على الكمية المسجلة ({o.get('loaded_qty')}) — الكمية المتوقعة {r.get('shipments_per_driver')}",
        "request_id": r["_id"], "offer_id": offer_id,
        "priority": "urgent", "escalation": "support", "status": "open",
        "activity": [{"action": "created", "by": user["name"], "at": now_iso()}],
        "replies": [], "is_demo": user.get("is_demo", False), "created_at": now_iso(),
    }
    await db.tickets.insert_one(ticket)
    await notify(r["business_id"], "نزاع على عدد الشحنات",
                 f"{user['name']} اعترض على كمية الشحنات المسجلة — {r['title']}",
                 "support", f"/app/business/requests/{r['_id']}")
    await notify_admins("نزاع على كمية الشحنات", f"{user['name']} — {r['title']}",
                        "case", "/app/admin/cases")
    return {"ok": True, "ticket_id": ticket["_id"]}


@router.get("/jobs")
async def my_jobs(user: dict = wrk):
    active = await db.offers.find(
        {"worker_id": user["_id"], "status": {"$in": ACTIVE_JOB_STATUSES}}
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
