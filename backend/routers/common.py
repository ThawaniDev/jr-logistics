from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List

from db import db
from deps import get_current_user, require_staff
from catalog import SERVICES, ENABLED_SERVICES, TICKET_CATEGORIES
from utils import new_id, now_iso, notify, get_wallet, pub, pub_list, get_settings, audit

router = APIRouter(prefix="/api", tags=["common"])


@router.get("/health")
async def health():
    return {"status": "ok", "service": "isnad-api"}


@router.get("/catalog/services")
async def catalog_services():
    enabled = [s for s in SERVICES if s["key"] in ENABLED_SERVICES]
    return {"services": enabled}


@router.get("/catalog/defaults")
async def catalog_defaults():
    s = await get_settings()
    return {"default_rate": s["default_rate"], "commission_rate": s["commission_rate"],
            "vehicle_types": s["vehicle_types"], "service_areas": s["service_areas"],
            "enabled_pickup_cities": s.get("enabled_pickup_cities", ["الرياض"]),
            "enabled_delivery_cities": s.get("enabled_delivery_cities", s["service_areas"])}


@router.get("/catalog/terms")
async def catalog_terms():
    s = await get_settings()
    return {"version": s.get("terms_version", "1.0"),
            "business_text": s.get("terms_business_text", ""),
            "driver_text": s.get("terms_driver_text", "")}


class ProfileIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    language: Optional[str] = None
    company_name: Optional[str] = None
    cr_number: Optional[str] = None
    industry: Optional[str] = None
    services: Optional[List[str]] = None
    vehicle_type: Optional[str] = None
    vehicle_temperature: Optional[str] = None
    bank_name: Optional[str] = None
    iban: Optional[str] = None
    national_id: Optional[str] = None


@router.patch("/profile")
async def update_profile(body: ProfileIn, user: dict = Depends(get_current_user)):
    updates = {}
    for f in ("name", "email", "city", "language"):
        v = getattr(body, f)
        if v is not None:
            updates[f] = v
    if user["role"] == "business":
        for f in ("company_name", "cr_number", "industry"):
            v = getattr(body, f)
            if v is not None:
                updates[f"business_profile.{f}"] = v
    if user["role"] == "worker":
        for f in ("services", "bank_name", "iban", "national_id", "vehicle_type", "vehicle_temperature"):
            v = getattr(body, f)
            if v is not None:
                updates[f"worker_profile.{f}"] = v
    if updates:
        await db.users.update_one({"_id": user["_id"]}, {"$set": updates})
    return {"user": pub(await db.users.find_one({"_id": user["_id"]}))}


@router.get("/wallet")
async def wallet(user: dict = Depends(get_current_user)):
    w = await get_wallet(user["_id"])
    txns = await db.transactions.find({"user_id": user["_id"]}).sort("created_at", -1).to_list(200)
    result = {"wallet": pub(w), "transactions": pub_list(txns)}
    if user["role"] == "worker":
        active = await db.offers.find(
            {"worker_id": user["_id"],
             "status": {"$in": ["confirmed", "attendance_confirmed", "attended"]}}).to_list(200)
        pending = 0.0
        for o in active:
            req = await db.requests.find_one({"_id": o["request_id"]})
            if req:
                share = req["estimated_total"] / req["required_count"]
                pending += share * (1 - req.get("commission_rate", 0.10))
        result["pending_earnings"] = round(pending, 2)
        result["paid_earnings"] = round(
            sum(t["amount"] for t in txns if t["type"] == "earning"), 2)
    return result


@router.get("/notifications")
async def notifications(user: dict = Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["_id"]}).sort("created_at", -1).to_list(100)
    unread = await db.notifications.count_documents({"user_id": user["_id"], "read": False})
    return {"notifications": pub_list(items), "unread": unread}


@router.post("/notifications/read-all")
async def read_all(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["_id"]}, {"$set": {"read": True}})
    return {"ok": True}


class TicketIn(BaseModel):
    subject: str
    category: str = "general"
    message: str
    request_id: Optional[str] = None
    priority: Optional[str] = None


class ReplyIn(BaseModel):
    message: str


@router.post("/tickets")
async def create_ticket(body: TicketIn, user: dict = Depends(get_current_user)):
    allowed = TICKET_CATEGORIES.get(user["role"], []) + ["general"]
    category = body.category if body.category in allowed else "general"
    priority = body.priority if body.priority in ("normal", "urgent") else \
        ("urgent" if category in ("urgent", "driver_no_show", "not_put_to_work") else "normal")
    doc = {
        "_id": new_id(), "user_id": user["_id"], "subject": body.subject,
        "category": category, "message": body.message,
        "request_id": body.request_id, "priority": priority,
        "escalation": "support", "status": "open",
        "activity": [{"action": "created", "by": user["name"], "at": now_iso()}],
        "replies": [], "is_demo": user.get("is_demo", False),
        "created_at": now_iso(),
    }
    await db.tickets.insert_one(doc)
    return {"ticket": pub(doc)}


@router.get("/tickets")
async def list_tickets(user: dict = Depends(get_current_user)):
    if user["role"] in ("admin", "staff"):
        from deps import user_permissions
        if user["role"] != "admin" and "tickets" not in user_permissions(user):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية الوصول")
        query = {}
    else:
        query = {"user_id": user["_id"]}
    items = await db.tickets.find(query).sort("created_at", -1).to_list(200)
    for t in items:
        t["user"] = pub(await db.users.find_one({"_id": t["user_id"]}, {"name": 1, "role": 1, "phone": 1}))
        if t.get("request_id"):
            t["request"] = pub(await db.requests.find_one(
                {"_id": t["request_id"]},
                {"title": 1, "city": 1, "start_date": 1, "estimated_total": 1, "status": 1}))
    return {"tickets": pub_list(items)}


@router.post("/tickets/{ticket_id}/reply")
async def reply_ticket(ticket_id: str, body: ReplyIn, user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"_id": ticket_id})
    if not t or (user["role"] not in ("admin", "staff") and t["user_id"] != user["_id"]):
        raise HTTPException(status_code=404, detail="التذكرة غير موجودة")
    is_staff = user["role"] in ("admin", "staff")
    reply = {"from_admin": is_staff, "author": user["name"],
             "message": body.message, "at": now_iso()}
    new_status = "in_review" if is_staff else "open"
    await db.tickets.update_one({"_id": ticket_id},
                                {"$push": {"replies": reply,
                                           "activity": {"action": "reply", "by": user["name"],
                                                        "at": now_iso()}},
                                 "$set": {"status": new_status}})
    if is_staff:
        await notify(t["user_id"], "رد جديد على تذكرتك", f"{t['subject']}: {body.message[:80]}", "support", "/app/support")
    return {"ok": True}


class EscalateIn(BaseModel):
    level: str


@router.post("/tickets/{ticket_id}/escalate")
async def escalate_ticket(ticket_id: str, body: EscalateIn, user: dict = Depends(require_staff("tickets"))):
    t = await db.tickets.find_one({"_id": ticket_id})
    if not t:
        raise HTTPException(status_code=404, detail="التذكرة غير موجودة")
    if body.level not in ("support", "operations", "account_manager"):
        raise HTTPException(status_code=400, detail="مستوى تصعيد غير صالح")
    await db.tickets.update_one({"_id": ticket_id},
                                {"$set": {"escalation": body.level},
                                 "$push": {"activity": {"action": "escalated", "by": user["name"],
                                                        "at": now_iso(), "note": body.level}}})
    await audit(user, "ticket_escalated", "ticket", ticket_id,
                before=t.get("escalation"), after=body.level)
    return {"ok": True}


@router.post("/tickets/{ticket_id}/resolve")
async def resolve_ticket(ticket_id: str, user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"_id": ticket_id})
    if not t or (user["role"] not in ("admin", "staff") and t["user_id"] != user["_id"]):
        raise HTTPException(status_code=404, detail="التذكرة غير موجودة")
    await db.tickets.update_one({"_id": ticket_id},
                                {"$set": {"status": "resolved", "resolved_at": now_iso()},
                                 "$push": {"activity": {"action": "resolved", "by": user["name"],
                                                        "at": now_iso()}}})
    if user["role"] in ("admin", "staff"):
        await audit(user, "ticket_resolved", "ticket", ticket_id)
        await notify(t["user_id"], "تم حل تذكرتك", t["subject"], "support", "/app/support")
    return {"ok": True}
