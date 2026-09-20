"""Courier Office / Logistics Provider vertical — central DB, RBAC-enforced."""
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel

from catalog import OFFICE_DOC_TYPES, DOC_TYPES
from db import db
from deps import require_roles
from storage import put_object
from utils import new_id, now_iso, pub, pub_list, audit, notify, get_wallet, log_event, record_assignment, compute_offer_sla, get_settings

router = APIRouter(prefix="/api/office", tags=["office"])
office = Depends(require_roles("office"))

OFFICE_DOC_KEYS = [d["key"] for d in OFFICE_DOC_TYPES]
ACTIVE_JOB = ["accepted", "confirmed", "attendance_confirmed", "attended",
              "delivered_reported", "pending_settlement", "qty_disputed"]
SENSITIVE_REQUEST_FIELDS = (
    "rate", "estimated_total", "commission", "commission_rate", "payout_total",
    "pricing_snapshot", "pricing_version",
)
SENSITIVE_SETTLEMENT_FIELDS = (
    "rate", "commission_rate", "commission", "gross", "vat", "vat_pct",
    "reserved_share", "pricing_version",
)


async def _linked_driver_ids(office_id: str) -> List[str]:
    return await db.users.distinct("_id", {"role": "worker",
                                           "worker_profile.provider_id": office_id,
                                           "worker_profile.provider_status": "linked"})


async def _accepted_agreement(office_id: str) -> Optional[dict]:
    return await db.agreements.find_one({"office_id": office_id, "status": "accepted"},
                                        sort=[("created_at", -1)])


async def _require_office_ready(user: dict) -> dict:
    op = user.get("office_profile") or {}
    if op.get("verification_status") not in ("verified", "active"):
        raise HTTPException(status_code=403, detail="حساب المكتب بانتظار توثيق الإدارة")
    agr = await _accepted_agreement(user["_id"])
    if not agr:
        raise HTTPException(status_code=403, detail="يجب قبول اتفاقية JR Logistics قبل استلام الفرص المدفوعة")
    return agr


def _office_request(r: dict, agreement: Optional[dict] = None) -> dict:
    out = pub(r)
    for f in SENSITIVE_REQUEST_FIELDS:
        out.pop(f, None)
    provider_rate = (agreement or {}).get("provider_rate")
    if provider_rate:
        out["provider_rate"] = provider_rate
        qty = r.get("shipments_per_driver") or 0
        out["provider_amount_estimate"] = round(provider_rate * qty, 2) if qty else provider_rate
    return out


async def _driver_eligibility(driver: dict, request: dict, office_id: str) -> list[str]:
    wp = driver.get("worker_profile") or {}
    reasons = []
    if wp.get("provider_id") != office_id or wp.get("provider_status") != "linked":
        reasons.append("المندوب غير مرتبط بهذا المكتب")
    if wp.get("verification_status") != "verified":
        reasons.append("المندوب غير موثّق")
    if wp.get("availability") != "available":
        reasons.append("المندوب غير متاح")
    if request.get("vehicle_type") and wp.get("vehicle_type") != request.get("vehicle_type"):
        reasons.append("نوع المركبة غير متوافق")
    if request.get("temperature_type") and wp.get("vehicle_temperature") != request.get("temperature_type"):
        reasons.append("نوع حرارة المركبة غير متوافق")
    today = date.today().isoformat()
    for dt in [d for d in DOC_TYPES if d.get("required")]:
        doc = await db.driver_documents.find_one(
            {"worker_id": driver["_id"], "type": dt["key"]}, sort=[("uploaded_at", -1)])
        if not doc or doc.get("status") != "verified" or (doc.get("expiry_date") and doc["expiry_date"] < today):
            reasons.append(f"مستند غير صالح: {dt['name']}")
    active = await db.offers.find_one({"worker_id": driver["_id"], "request_id": {"$ne": request["_id"]},
                                       "status": {"$in": ACTIVE_JOB}})
    if active:
        reasons.append("لدى المندوب مهمة نشطة")
    else:
        from routers.worker import find_overlapping_job
        if await find_overlapping_job(driver["_id"], request):
            reasons.append("لدى المندوب مهمة متعارضة زمنياً")
    return reasons


async def _broadcast_request(request: dict, user: dict) -> int:
    from routers.business import match_workers
    matched = await match_workers(request)
    await db.requests.update_one({"_id": request["_id"]}, {"$set": {
        "office_assignment_status": "broadcast", "office_broadcast_at": now_iso(),
        "office_broadcast_by": user["_id"]}})
    await audit(user, "office_opportunity_broadcast", "request", request["_id"],
                after={"matched": matched})
    await log_event(request["_id"], None, user, "office_opportunity_broadcast",
                    notes=f"matched={matched}")
    return matched


@router.get("/dashboard")
async def office_dashboard(user: dict = office):
    ids = await _linked_driver_ids(user["_id"])
    drivers = await db.users.find({"_id": {"$in": ids}}).to_list(500) if ids else []
    busy = set(await db.offers.distinct("worker_id", {"status": {"$in": ACTIVE_JOB}}))
    d_avail = sum(1 for d in drivers
                  if (d.get("worker_profile") or {}).get("availability") == "available" and d["_id"] not in busy)
    d_busy = sum(1 for d in drivers if d["_id"] in busy)
    active_jobs = await db.offers.count_documents({"worker_id": {"$in": ids}, "status": {"$in": ACTIVE_JOB}}) if ids else 0
    completed_jobs = await db.offers.count_documents({"worker_id": {"$in": ids}, "status": "paid"}) if ids else 0
    sts = await db.settlements.find({"office_id": user["_id"]}).to_list(1000)

    def ssum(*statuses):
        return round(sum(x["net"] for x in sts if x["status"] in statuses), 2)

    op = user.get("office_profile", {})
    agr = await db.agreements.find_one({"office_id": user["_id"]}, sort=[("created_at", -1)])
    open_opps = await db.requests.count_documents({
        "preferred_office_id": user["_id"], "status": {"$in": ["published", "filling"]}})
    return {"summary": {
        "drivers_total": len(drivers), "drivers_available": d_avail, "drivers_busy": d_busy,
        "drivers_unavailable": len(drivers) - d_avail - d_busy,
        "open_opportunities": open_opps,
        "active_jobs": active_jobs, "completed_jobs": completed_jobs,
        "settlements_pending": ssum("pending_review", "under_review"),
        "settlements_pending_count": sum(1 for x in sts if x["status"] in ("pending_review", "under_review")),
        "settlements_approved": ssum("approved"),
        "settlements_approved_count": sum(1 for x in sts if x["status"] == "approved"),
        "settlements_paid": ssum("paid"),
        "settlements_paid_count": sum(1 for x in sts if x["status"] == "paid"),
        "total_receivables": ssum("pending_review", "under_review", "approved"),
        "verification_status": op.get("verification_status"),
        "agreement_status": (agr or {}).get("status"),
    }}


class InviteIn(BaseModel):
    name: str
    phone: str
    vehicle_type: Optional[str] = None
    vehicle_temperature: Optional[str] = None


@router.get("/drivers")
async def office_drivers(user: dict = office):
    ids = await _linked_driver_ids(user["_id"])
    drivers = await db.users.find({"_id": {"$in": ids}}).to_list(500) if ids else []
    busy = set(await db.offers.distinct("worker_id", {"status": {"$in": ACTIVE_JOB}}))
    out = []
    for d in drivers:
        wp = d.get("worker_profile", {})
        active = await db.offers.find_one({"worker_id": d["_id"], "status": {"$in": ACTIVE_JOB}},
                                          {"status": 1, "request_id": 1})
        docs = await db.driver_documents.find({"worker_id": d["_id"]}).to_list(20)
        safe_profile = {k: wp.get(k) for k in (
            "services", "vehicle_type", "vehicle_temperature", "availability",
            "verification_status", "provider_status", "provider_since", "jobs_completed", "rating")}
        out.append({"_id": d["_id"], "name": d.get("name"), "phone": d.get("phone"),
                    "city": d.get("city"), "worker_profile": safe_profile,
                    "has_active_job": d["_id"] in busy,
                    "active_job": pub(active) if active else None,
                    "docs": [{"type": x["type"], "status": x["status"], "expiry_date": x.get("expiry_date")}
                             for x in docs],
                    "jobs_completed": wp.get("jobs_completed", 0), "rating": wp.get("rating")})
    invites = await db.office_invites.find({"office_id": user["_id"], "status": "pending"}).to_list(100)
    return {"drivers": out, "pending_invites": pub_list(invites)}


@router.post("/drivers/invite")
async def invite_driver(body: InviteIn, user: dict = office):
    phone = body.phone.strip()
    if not phone.startswith("+"):
        raise HTTPException(status_code=400, detail="أدخل رقم الجوال بالصيغة الدولية مثل +9665...")
    if phone == user.get("phone"):
        raise HTTPException(status_code=400, detail="لا يمكن دعوة رقمك الخاص")
    if await db.office_invites.find_one({"office_id": user["_id"], "phone": phone, "status": "pending"}):
        raise HTTPException(status_code=400, detail="توجد دعوة معلقة لهذا الرقم")
    existing = await db.users.find_one({"phone": phone})
    if existing and existing["role"] != "worker":
        raise HTTPException(status_code=400, detail="هذا الرقم مسجّل بحساب من نوع آخر — لا يمكن ربطه كمندوب")
    if existing and (existing.get("worker_profile") or {}).get("provider_status") == "linked" \
            and (existing.get("worker_profile") or {}).get("provider_id") != user["_id"]:
        raise HTTPException(status_code=400, detail="المندوب مرتبط بمكتب آخر حالياً")
    iv = {"_id": new_id(), "office_id": user["_id"],
          "office_name": (user.get("office_profile") or {}).get("office_name") or user["name"],
          "phone": phone, "name": body.name, "vehicle_type": body.vehicle_type,
          "vehicle_temperature": body.vehicle_temperature, "status": "pending",
          "kind": "link_existing" if existing else "invite_new",
          "created_by": user["_id"], "created_at": now_iso()}
    await db.office_invites.insert_one(iv)
    if existing:
        await notify(existing["_id"], "دعوة ارتباط بمكتب توصيل",
                     f"{iv['office_name']} يدعوك للارتباط بمكتبه — راجع الدعوة في حسابك",
                     "general", "/app/worker")
    await audit(user, "driver_invited", "office_invite", iv["_id"],
                after={"phone": phone, "kind": iv["kind"]})
    return {"ok": True, "invite": pub(iv)}


@router.post("/drivers/{driver_id}/unlink")
async def unlink_driver(driver_id: str, user: dict = office):
    d = await db.users.find_one({"_id": driver_id, "role": "worker"})
    if not d or (d.get("worker_profile") or {}).get("provider_id") != user["_id"]:
        raise HTTPException(status_code=404, detail="المندوب غير مرتبط بمكتبك")
    if await db.offers.find_one({"worker_id": driver_id, "status": {"$in": ACTIVE_JOB}}):
        raise HTTPException(status_code=400, detail="لا يمكن إلغاء الربط أثناء وجود مهمة نشطة")
    await db.users.update_one({"_id": driver_id}, {"$set": {
        "worker_profile.provider_status": "unlinked",
        "worker_profile.provider_type": "direct",
        "worker_profile.provider_ended_at": now_iso()}})
    await notify(driver_id, "تم إلغاء ارتباطك بالمكتب",
                 "أصبحت مندوباً مباشراً مع JR Logistics", "general", "/app/worker")
    await audit(user, "driver_unlinked", "user", driver_id, before={"office_id": user["_id"]})
    return {"ok": True}


@router.get("/opportunities")
async def office_opportunities(user: dict = office):
    agr = await _require_office_ready(user)
    reqs = await db.requests.find({
        "preferred_office_id": user["_id"],
        "status": {"$in": ["published", "filling"]},
    }).sort("created_at", -1).to_list(100)
    ids = await _linked_driver_ids(user["_id"])
    drivers = await db.users.find({"_id": {"$in": ids}}).to_list(500) if ids else []
    out = []
    now = datetime.now(timezone.utc)
    for r in reqs:
        expires = r.get("office_assignment_expires_at")
        if r.get("office_assignment_status") == "pending_office_assignment" and expires:
            try:
                if datetime.fromisoformat(expires) <= now:
                    await _broadcast_request(r, user)
                    r["office_assignment_status"] = "broadcast"
            except ValueError:
                pass
        active_count = await db.offers.count_documents({
            "request_id": r["_id"], "status": {"$in": ACTIVE_JOB + ["offered"]}})
        slots = max(0, r.get("required_count", 1) - active_count)
        if slots <= 0:
            continue
        item = _office_request(r, agr)
        b = await db.users.find_one({"_id": r["business_id"]},
                                    {"name": 1, "business_profile.company_name": 1, "phone": 1})
        item["business"] = pub(b)
        item["available_slots"] = slots
        item["eligible_drivers"] = []
        for d in drivers:
            reasons = await _driver_eligibility(d, r, user["_id"])
            wp = d.get("worker_profile") or {}
            item["eligible_drivers"].append({
                "_id": d["_id"], "name": d.get("name"), "phone": d.get("phone"),
                "vehicle_type": wp.get("vehicle_type"), "vehicle_temperature": wp.get("vehicle_temperature"),
                "eligible": not reasons, "reasons": reasons,
            })
        out.append(item)
    return {"opportunities": out}


class AssignIn(BaseModel):
    driver_id: str


@router.post("/opportunities/{request_id}/assign")
async def assign_driver(request_id: str, body: AssignIn, user: dict = office):
    await _require_office_ready(user)
    r = await db.requests.find_one({"_id": request_id, "preferred_office_id": user["_id"]})
    if not r or r.get("status") not in ("published", "filling"):
        raise HTTPException(status_code=404, detail="الفرصة غير متاحة لهذا المكتب")
    d = await db.users.find_one({"_id": body.driver_id, "role": "worker"})
    if not d:
        raise HTTPException(status_code=404, detail="المندوب غير موجود")
    reasons = await _driver_eligibility(d, r, user["_id"])
    if reasons:
        raise HTTPException(status_code=400, detail={"code": "DRIVER_NOT_ELIGIBLE", "reasons": reasons})
    if await db.offers.find_one({"request_id": request_id, "worker_id": body.driver_id}):
        raise HTTPException(status_code=400, detail="للمندوب عرض مسبق على هذه الفرصة")
    active_count = await db.offers.count_documents({
        "request_id": request_id, "status": {"$in": ACTIVE_JOB + ["offered"]}})
    if active_count >= r.get("required_count", 1):
        raise HTTPException(status_code=400, detail="اكتمل عدد المناديب المطلوب لهذه الفرصة")
    offer = {"_id": new_id(), "request_id": request_id, "worker_id": body.driver_id,
             "business_id": r["business_id"], "status": "offered", "is_replacement": False,
             "assigned_by_office_id": user["_id"], "office_assigned_at": now_iso(),
             "earning": 0, "created_at": now_iso(), "responded_at": None}
    await db.offers.insert_one(offer)
    await record_assignment(request_id, offer["_id"], body.driver_id, "office_assigned", user)
    new_count = active_count + 1
    await db.requests.update_one({"_id": request_id}, {"$set": {
        "office_assignment_status": "assigned" if new_count >= r.get("required_count", 1) else "partially_assigned",
        "office_assigned_at": now_iso()}})
    await notify(body.driver_id, "فرصة محددة من مكتبك",
                 f"عيّنك مكتبك على فرصة: {r['title']} — راجعها واقبلها من حسابك",
                 "offer", "/app/worker/opportunities")
    await audit(user, "office_driver_assigned", "offer", offer["_id"],
                after={"request_id": request_id, "driver_id": body.driver_id})
    await log_event(request_id, offer["_id"], user, "office_driver_assigned",
                    notes=f"driver={body.driver_id}")
    return {"ok": True, "offer": pub(offer)}


@router.post("/opportunities/{request_id}/broadcast")
async def broadcast_opportunity(request_id: str, user: dict = office):
    await _require_office_ready(user)
    r = await db.requests.find_one({"_id": request_id, "preferred_office_id": user["_id"]})
    if not r or r.get("status") not in ("published", "filling"):
        raise HTTPException(status_code=404, detail="الفرصة غير متاحة لهذا المكتب")
    matched = await _broadcast_request(r, user)
    await notify(user["_id"], "تم تعميم الفرصة على مناديبك",
                 f"أُرسلت الفرصة إلى {matched} مندوب مؤهل", "general", "/app/office/opportunities")
    return {"ok": True, "matched": matched}


@router.get("/jobs")
async def office_jobs(active: Optional[bool] = None, user: dict = office):
    ids = await _linked_driver_ids(user["_id"])
    query = {"worker_id": {"$in": ids}}
    if active:
        query["status"] = {"$in": ACTIVE_JOB}
    offers = await db.offers.find(query).sort("created_at", -1).to_list(300) if ids else []
    for o in offers:
        r = await db.requests.find_one({"_id": o["request_id"]})
        if r:
            req = _office_request(r)
            b = await db.users.find_one({"_id": r["business_id"]},
                                        {"name": 1, "business_profile.company_name": 1, "phone": 1})
            req["business"] = pub(b)
            o["request"] = req
        else:
            o["request"] = None
        o.pop("earning", None)
        o["office_id"] = user["_id"]
        w = await db.users.find_one({"_id": o["worker_id"]}, {"name": 1})
        o["driver_name"] = (w or {}).get("name")
    return {"jobs": pub_list(offers)}


@router.get("/settlements")
async def office_settlements(status: Optional[str] = None, user: dict = office):
    query = {"office_id": user["_id"]}
    if status:
        query["status"] = status
    items = await db.settlements.find(query).sort("created_at", -1).to_list(300)
    out = []
    for s in items:
        r = await db.requests.find_one({"_id": s["request_id"]}, {"title": 1})
        d = await db.users.find_one({"_id": s["driver_id"]}, {"name": 1})
        item = pub(s)
        for f in SENSITIVE_SETTLEMENT_FIELDS:
            item.pop(f, None)
        item["provider_amount"] = s.get("provider_amount", s.get("net"))
        item["adjustments"] = s.get("adjustments", 0)
        item["request_title"] = (r or {}).get("title")
        item["driver_name"] = (d or {}).get("name")
        out.append(item)
    return {"settlements": out}


class OfficeReplaceIn(BaseModel):
    reason: str


@router.post("/jobs/{offer_id}/replace")
async def office_replace_driver(offer_id: str, body: OfficeReplaceIn, user: dict = office):
    await _require_office_ready(user)
    o = await db.offers.find_one({"_id": offer_id, "assigned_by_office_id": user["_id"]})
    if not o or o["status"] not in ("offered", "accepted"):
        raise HTTPException(status_code=400, detail="يمكن الاستبدال قبل تأكيد المنشأة للمندوب فقط")
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="أدخل سبب الاستبدال")
    r = await db.requests.find_one({"_id": o["request_id"]})
    await db.offers.update_one({"_id": offer_id}, {"$set": {
        "status": "cancelled", "cancelled_at": now_iso(),
        "cancelled_by": "office", "cancel_reason": body.reason.strip()}})
    await record_assignment(o["request_id"], offer_id, o["worker_id"], "replaced", user,
                            body.reason.strip())
    await db.requests.update_one({"_id": o["request_id"]}, {"$set": {
        "office_assignment_status": "pending_office_assignment"}})
    await log_event(o["request_id"], offer_id, user, "driver_replaced",
                    old_status=o["status"], new_status="cancelled",
                    notes=f"by_office reason={body.reason.strip()}")
    await notify(o["worker_id"], "ألغى مكتبك تعيينك",
                 f"ألغى مكتبك تعيينك في: {(r or {}).get('title')} — السبب: {body.reason.strip()}",
                 "general", "/app/worker/jobs")
    await audit(user, "office_driver_replaced", "offer", offer_id,
                after={"reason": body.reason.strip()})
    return {"ok": True}


@router.get("/payments")
async def office_payments(user: dict = office):
    items = await db.transactions.find({"user_id": user["_id"], "type": "payout"}).sort("created_at", -1).to_list(200)
    wallet = await get_wallet(user["_id"])
    return {"payments": pub_list(items), "wallet": pub(wallet)}


@router.get("/reports")
async def office_reports(user: dict = office):
    ids = await _linked_driver_ids(user["_id"])
    offers = await db.offers.find({"worker_id": {"$in": ids}}).to_list(1000) if ids else []
    settlements = await db.settlements.find({"office_id": user["_id"]}).to_list(1000)
    by_status = {}
    shipments = 0
    for o in offers:
        by_status[o["status"]] = by_status.get(o["status"], 0) + 1
        shipments += o.get("final_qty") or o.get("driver_reported_qty") or o.get("loaded_qty") or 0
    payments = await db.transactions.find({"user_id": user["_id"], "type": "payout"}).to_list(500)
    settings = await get_settings()
    grace = settings.get("alert_no_checkin_grace_min", 30)
    sla_on = sla_late = 0
    for o in offers:
        if o["status"] in ("offered", "rejected", "replacement_locked", "cancelled"):
            continue
        r = await db.requests.find_one({"_id": o["request_id"]},
                                       {"start_date": 1, "start_time": 1, "duration_days": 1})
        if not r:
            continue
        sla = compute_offer_sla(o, r, grace)
        if sla.get("start_status") == "on_time":
            sla_on += 1
        elif sla.get("start_status") in ("late", "missed"):
            sla_late += 1
    audits = await db.audit_logs.find({"$or": [{"actor_id": user["_id"]},
                                                {"entity_id": user["_id"]}]}) \
        .sort("created_at", -1).to_list(20)
    return {"summary": {
        "drivers": len(ids), "jobs_total": len(offers), "active_jobs": by_status.get("accepted", 0) + sum(by_status.get(s, 0) for s in ACTIVE_JOB if s != "accepted"),
        "completed_jobs": by_status.get("paid", 0), "cancelled_jobs": by_status.get("cancelled", 0),
        "no_shows": by_status.get("no_show", 0), "shipments": shipments,
        "settlements_count": len(settlements),
        "pending_amount": round(sum(s["net"] for s in settlements if s["status"] in ("pending_review", "under_review")), 2),
        "approved_amount": round(sum(s["net"] for s in settlements if s["status"] == "approved"), 2),
        "paid_amount": round(sum(s["net"] for s in settlements if s["status"] == "paid"), 2),
        "payments_count": len(payments),
        "sla_on_time": sla_on, "sla_late": sla_late,
        "tickets": await db.tickets.count_documents({"user_id": user["_id"]}),
        "documents": await db.office_documents.count_documents({"office_id": user["_id"]}),
        "agreements": await db.agreements.count_documents({"office_id": user["_id"]}),
    }, "recent_activity": pub_list(audits)}


@router.post("/documents/upload")
async def upload_office_doc(file: UploadFile = File(...), doc_type: str = Form(...),
                            expiry_date: Optional[str] = Form(None), user: dict = office):
    if doc_type not in OFFICE_DOC_KEYS:
        raise HTTPException(status_code=400, detail="نوع المستند غير صالح")
    if expiry_date:
        try:
            if len(expiry_date) != 10:
                raise ValueError
            from datetime import date as _d
            _d.fromisoformat(expiry_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="تاريخ الانتهاء غير صحيح — أدخل تاريخاً صحيحاً")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="الملف كبير جداً")
    path = f"isnad/office-docs/{user['_id']}/{new_id()}-{file.filename}"
    stored = put_object(path, data, file.content_type or "application/octet-stream")
    doc = {"_id": new_id(), "office_id": user["_id"], "type": doc_type,
           "file_path": stored["path"], "original_filename": file.filename,
           "content_type": file.content_type, "size": len(data),
           "expiry_date": expiry_date, "status": "pending", "uploaded_at": now_iso()}
    await db.office_documents.insert_one(doc)
    await audit(user, "office_document_uploaded", "office_document", doc["_id"], after={"type": doc_type})
    return {"ok": True, "document": pub(doc)}


@router.get("/documents")
async def office_documents(user: dict = office):
    docs = await db.office_documents.find({"office_id": user["_id"]}).sort("uploaded_at", -1).to_list(50)
    return {"documents": pub_list(docs)}


@router.get("/agreement")
async def get_agreement(user: dict = office):
    agr = await db.agreements.find_one({"office_id": user["_id"]}, sort=[("created_at", -1)])
    return {"agreement": pub(agr) if agr else None}


@router.post("/agreement/accept")
async def accept_agreement(user: dict = office):
    agr = await db.agreements.find_one({"office_id": user["_id"], "status": "pending_acceptance"},
                                       sort=[("created_at", -1)])
    if not agr:
        raise HTTPException(status_code=400, detail="لا توجد اتفاقية بانتظار القبول")
    await db.agreements.update_one({"_id": agr["_id"]}, {"$set": {
        "status": "accepted", "accepted_at": now_iso(),
        "accepted_by": {"id": user["_id"], "name": user["name"]}}})
    await audit(user, "office_agreement_accepted", "agreement", agr["_id"],
                after={"version": agr.get("version")})
    await notify(user["_id"], "تم قبول الاتفاقية",
                 "اتفاقيتك مع JR Logistics أصبحت سارية", "general", "/app/office/agreement")
    return {"ok": True}
