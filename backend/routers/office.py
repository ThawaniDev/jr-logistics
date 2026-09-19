"""Courier Office / Logistics Provider vertical — central DB, RBAC-enforced."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel

from catalog import OFFICE_DOC_TYPES
from db import db
from deps import require_roles
from storage import put_object
from utils import new_id, now_iso, pub, pub_list, audit, notify, get_wallet

router = APIRouter(prefix="/api/office", tags=["office"])
office = Depends(require_roles("office"))

OFFICE_DOC_KEYS = [d["key"] for d in OFFICE_DOC_TYPES]
ACTIVE_JOB = ["accepted", "confirmed", "attendance_confirmed", "attended",
              "delivered_reported", "pending_settlement", "qty_disputed"]


async def _linked_driver_ids(office_id: str) -> List[str]:
    return await db.users.distinct("_id", {"role": "worker",
                                           "worker_profile.provider_id": office_id,
                                           "worker_profile.provider_status": "linked"})


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
    return {"summary": {
        "drivers_total": len(drivers), "drivers_available": d_avail, "drivers_busy": d_busy,
        "drivers_unavailable": len(drivers) - d_avail - d_busy,
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
        out.append({**pub(d), "has_active_job": d["_id"] in busy,
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


@router.get("/jobs")
async def office_jobs(user: dict = office):
    ids = await _linked_driver_ids(user["_id"])
    offers = await db.offers.find({"worker_id": {"$in": ids}}).sort("created_at", -1).to_list(300) if ids else []
    for o in offers:
        r = await db.requests.find_one({"_id": o["request_id"]},
                                       {"title": 1, "city": 1, "pickup_city": 1, "start_date": 1, "status": 1})
        o["request"] = pub(r) if r else None
        w = await db.users.find_one({"_id": o["worker_id"]}, {"name": 1})
        o["driver_name"] = (w or {}).get("name")
    return {"jobs": pub_list(offers)}


@router.get("/settlements")
async def office_settlements(user: dict = office):
    items = await db.settlements.find({"office_id": user["_id"]}).sort("created_at", -1).to_list(300)
    for s in items:
        r = await db.requests.find_one({"_id": s["request_id"]}, {"title": 1})
        s["request_title"] = (r or {}).get("title")
        d = await db.users.find_one({"_id": s["driver_id"]}, {"name": 1})
        s["driver_name"] = (d or {}).get("name")
    return {"settlements": pub_list(items)}


@router.get("/payments")
async def office_payments(user: dict = office):
    items = await db.transactions.find({"user_id": user["_id"], "type": "payout"}).sort("created_at", -1).to_list(200)
    wallet = await get_wallet(user["_id"])
    return {"payments": pub_list(items), "wallet": pub(wallet)}


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
            raise HTTPException(status_code=400, detail="تاريخ الانتهاء غير صالح — أدخل تاريخاً صحيحاً")
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
