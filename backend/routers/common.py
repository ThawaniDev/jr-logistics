from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List

from db import db
from deps import get_current_user
from catalog import SERVICES
from utils import new_id, now_iso, notify, get_wallet, pub, pub_list

router = APIRouter(prefix="/api", tags=["common"])


@router.get("/health")
async def health():
    return {"status": "ok", "service": "isnad-api"}


@router.get("/catalog/services")
async def catalog_services():
    return {"services": SERVICES}


class ProfileIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    company_name: Optional[str] = None
    cr_number: Optional[str] = None
    industry: Optional[str] = None
    services: Optional[List[str]] = None
    bank_name: Optional[str] = None
    iban: Optional[str] = None
    national_id: Optional[str] = None


@router.patch("/profile")
async def update_profile(body: ProfileIn, user: dict = Depends(get_current_user)):
    updates = {}
    for f in ("name", "email", "city"):
        v = getattr(body, f)
        if v is not None:
            updates[f] = v
    if user["role"] == "business":
        for f in ("company_name", "cr_number", "industry"):
            v = getattr(body, f)
            if v is not None:
                updates[f"business_profile.{f}"] = v
    if user["role"] == "worker":
        for f in ("services", "bank_name", "iban", "national_id"):
            v = getattr(body, f)
            if v is not None:
                updates[f"worker_profile.{f}"] = v
    if updates:
        await db.users.update_one({"_id": user["_id"]}, {"$set": updates})
    return {"user": await db.users.find_one({"_id": user["_id"]})}


@router.get("/wallet")
async def wallet(user: dict = Depends(get_current_user)):
    w = await get_wallet(user["_id"])
    txns = await db.transactions.find({"user_id": user["_id"]}).sort("created_at", -1).to_list(200)
    return {"wallet": pub(w), "transactions": pub_list(txns)}


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


class ReplyIn(BaseModel):
    message: str


@router.post("/tickets")
async def create_ticket(body: TicketIn, user: dict = Depends(get_current_user)):
    doc = {
        "_id": new_id(), "user_id": user["_id"], "subject": body.subject,
        "category": body.category, "message": body.message,
        "status": "open", "replies": [], "is_demo": user.get("is_demo", False),
        "created_at": now_iso(),
    }
    await db.tickets.insert_one(doc)
    return {"ticket": doc}


@router.get("/tickets")
async def list_tickets(user: dict = Depends(get_current_user)):
    query = {} if user["role"] == "admin" else {"user_id": user["_id"]}
    items = await db.tickets.find(query).sort("created_at", -1).to_list(200)
    for t in items:
        t["user"] = await db.users.find_one({"_id": t["user_id"]}, {"name": 1, "role": 1, "phone": 1})
    return {"tickets": items}


@router.post("/tickets/{ticket_id}/reply")
async def reply_ticket(ticket_id: str, body: ReplyIn, user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"_id": ticket_id})
    if not t or (user["role"] != "admin" and t["user_id"] != user["_id"]):
        raise HTTPException(status_code=404, detail="التذكرة غير موجودة")
    reply = {"from_admin": user["role"] == "admin", "author": user["name"],
             "message": body.message, "at": now_iso()}
    new_status = "in_review" if user["role"] == "admin" else "open"
    await db.tickets.update_one({"_id": ticket_id},
                                {"$push": {"replies": reply}, "$set": {"status": new_status}})
    if user["role"] == "admin":
        await notify(t["user_id"], "رد جديد على تذكرتك", f"{t['subject']}: {body.message[:80]}", "support", "/app/support")
    return {"ok": True}


@router.post("/tickets/{ticket_id}/resolve")
async def resolve_ticket(ticket_id: str, user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"_id": ticket_id})
    if not t or (user["role"] != "admin" and t["user_id"] != user["_id"]):
        raise HTTPException(status_code=404, detail="التذكرة غير موجودة")
    await db.tickets.update_one({"_id": ticket_id}, {"$set": {"status": "resolved", "resolved_at": now_iso()}})
    if user["role"] == "admin":
        await notify(t["user_id"], "تم حل تذكرتك", t["subject"], "support", "/app/support")
    return {"ok": True}
