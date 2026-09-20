"""Structured complaints & disputes linked to jobs, with full action history."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from deps import get_current_user, require_staff, user_permissions
from utils import new_id, now_iso, pub, pub_list, audit, notify, notify_staff

router = APIRouter(prefix="/api/complaints", tags=["complaints"])

COMPLAINT_CATEGORIES = ["delay", "driver_behavior", "service_quality", "payment",
                        "custody", "damage", "no_show", "other"]
COMPLAINT_STATUSES = ["open", "in_progress", "resolved", "closed"]


async def _is_party(user: dict, request_id: str, offer_id: Optional[str]) -> bool:
    r = await db.requests.find_one({"_id": request_id})
    if not r:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    if user["role"] == "business":
        return r["business_id"] == user["_id"]
    o = None
    if offer_id:
        o = await db.offers.find_one({"_id": offer_id, "request_id": request_id})
    elif user["role"] in ("worker", "office"):
        o = await db.offers.find_one({"request_id": request_id,
                                      "worker_id": user["_id"] if user["role"] == "worker" else {"$exists": True}})
    if user["role"] == "worker":
        if o:
            return o["worker_id"] == user["_id"]
        return bool(await db.offers.find_one({"request_id": request_id, "worker_id": user["_id"]}))
    if user["role"] == "office":
        offers = await db.offers.find({"request_id": request_id}).to_list(100)
        for off in offers:
            w = await db.users.find_one({"_id": off["worker_id"]},
                                        {"worker_profile.provider_id": 1,
                                         "worker_profile.provider_status": 1})
            wp = (w or {}).get("worker_profile") or {}
            if wp.get("provider_id") == user["_id"] and wp.get("provider_status") == "linked":
                return True
    return False


class ComplaintIn(BaseModel):
    request_id: str
    offer_id: Optional[str] = None
    category: str
    subject: str
    description: str


@router.post("")
async def create_complaint(body: ComplaintIn, user: dict = Depends(get_current_user)):
    if user["role"] not in ("business", "worker", "office"):
        raise HTTPException(status_code=403, detail="غير مصرح")
    if body.category not in COMPLAINT_CATEGORIES:
        raise HTTPException(status_code=400, detail="تصنيف غير صالح")
    if not body.subject.strip() or not body.description.strip():
        raise HTTPException(status_code=400, detail="أدخل الموضوع والوصف")
    if not await _is_party(user, body.request_id, body.offer_id):
        raise HTTPException(status_code=403, detail="يمكنك تقديم شكوى على مهامك فقط")
    doc = {
        "_id": new_id(), "user_id": user["_id"], "user_role": user["role"],
        "request_id": body.request_id, "offer_id": body.offer_id,
        "category": body.category, "subject": body.subject.strip(),
        "description": body.description.strip(),
        "status": "open",
        "priority": "urgent" if body.category in ("no_show", "damage") else "normal",
        "assigned_to": None, "assigned_to_name": None, "resolution": None, "notes": [],
        "history": [{"action": "created", "by": user["name"], "by_id": user["_id"], "at": now_iso()}],
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.complaints.insert_one(doc)
    await notify_staff("cases", "شكوى جديدة", f"{doc['subject']} — من {user['name']}",
                       "case", "/app/admin/complaints")
    return {"ok": True, "complaint": pub(doc)}


@router.get("")
async def list_complaints(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    if user["role"] in ("admin", "staff"):
        if user["role"] != "admin" and not ({"complaints", "cases"} & user_permissions(user)):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية الوصول")
        query = {}
    else:
        query = {"user_id": user["_id"]}
    if status:
        query["status"] = status
    items = await db.complaints.find(query).sort("created_at", -1).to_list(500)
    for c in items:
        c["user"] = pub(await db.users.find_one({"_id": c["user_id"]}, {"name": 1, "role": 1, "phone": 1}))
        if c.get("request_id"):
            c["request"] = pub(await db.requests.find_one(
                {"_id": c["request_id"]}, {"title": 1, "city": 1, "start_date": 1}))
    return {"complaints": pub_list(items)}


class NoteIn(BaseModel):
    text: str


@router.post("/{cid}/notes")
async def add_note(cid: str, body: NoteIn, user: dict = Depends(get_current_user)):
    c = await db.complaints.find_one({"_id": cid})
    is_staff = user["role"] in ("admin", "staff")
    if not c or (not is_staff and c["user_id"] != user["_id"]):
        raise HTTPException(status_code=404, detail="الشكوى غير موجودة")
    if c["status"] == "closed":
        raise HTTPException(status_code=400, detail="الشكوى مغلقة")
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="الملاحظة فارغة")
    note = {"by": user["name"], "by_id": user["_id"], "role": user["role"],
            "text": body.text.strip(), "at": now_iso()}
    await db.complaints.update_one({"_id": cid}, {
        "$push": {"notes": note,
                  "history": {"action": "note", "by": user["name"], "by_id": user["_id"], "at": now_iso()}},
        "$set": {"updated_at": now_iso()}})
    if is_staff:
        await notify(c["user_id"], "تحديث على شكواك", f"{c['subject']}: {body.text[:80]}",
                     "support", "/app/complaints")
    return {"ok": True}


class AssignIn(BaseModel):
    staff_id: str


@router.post("/{cid}/assign")
async def assign_complaint(cid: str, body: AssignIn, user: dict = Depends(require_staff("complaints", "cases"))):
    c = await db.complaints.find_one({"_id": cid})
    if not c:
        raise HTTPException(status_code=404, detail="الشكوى غير موجودة")
    s = await db.users.find_one({"_id": body.staff_id, "role": {"$in": ["staff", "admin"]}})
    if not s:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    await db.complaints.update_one({"_id": cid}, {
        "$set": {"assigned_to": s["_id"], "assigned_to_name": s["name"],
                 "status": "in_progress" if c["status"] == "open" else c["status"],
                 "updated_at": now_iso()},
        "$push": {"history": {"action": "assigned", "by": user["name"], "by_id": user["_id"],
                              "note": s["name"], "at": now_iso()}}})
    await notify(s["_id"], "أُسندت إليك شكوى", c["subject"], "case", "/app/admin/complaints")
    await audit(user, "complaint_assigned", "complaint", cid, after={"assigned_to": s["_id"]})
    return {"ok": True}


class StatusIn(BaseModel):
    status: str
    resolution: Optional[str] = None


@router.post("/{cid}/status")
async def set_complaint_status(cid: str, body: StatusIn, user: dict = Depends(require_staff("complaints", "cases"))):
    c = await db.complaints.find_one({"_id": cid})
    if not c:
        raise HTTPException(status_code=404, detail="الشكوى غير موجودة")
    if body.status not in COMPLAINT_STATUSES:
        raise HTTPException(status_code=400, detail="حالة غير صالحة")
    if body.status in ("resolved", "closed") and not (body.resolution or c.get("resolution")):
        raise HTTPException(status_code=400, detail="أدخل قرار الحل قبل الإغلاق")
    upd = {"status": body.status, "updated_at": now_iso()}
    if body.resolution:
        upd["resolution"] = body.resolution
    if body.status == "resolved":
        upd["resolved_at"] = now_iso()
    if body.status == "closed":
        upd["closed_at"] = now_iso()
    await db.complaints.update_one({"_id": cid}, {
        "$set": upd,
        "$push": {"history": {"action": f"status_{body.status}", "by": user["name"],
                              "by_id": user["_id"], "note": body.resolution, "at": now_iso()}}})
    await notify(c["user_id"], "تحديث حالة شكواك", f"{c['subject']} — {body.status}",
                 "support", "/app/complaints")
    await audit(user, "complaint_status", "complaint", cid, before=c["status"], after=body.status)
    return {"ok": True}
