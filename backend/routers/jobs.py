"""Operations room: job timeline, in-app chat, masked-contact events."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from deps import get_current_user
from utils import new_id, now_iso, pub, pub_list, log_event, notify

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


async def _load_offer_for_user(offer_id: str, user: dict):
    o = await db.offers.find_one({"_id": offer_id})
    if not o:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة")
    if user["role"] not in ("admin", "staff"):
        if user["role"] == "worker" and o["worker_id"] != user["_id"]:
            raise HTTPException(status_code=403, detail="غير مصرح")
        if user["role"] == "business" and o["business_id"] != user["_id"]:
            raise HTTPException(status_code=403, detail="غير مصرح")
    r = await db.requests.find_one({"_id": o["request_id"]})
    return o, r


@router.get("/{offer_id}/timeline")
async def job_timeline(offer_id: str, user: dict = Depends(get_current_user)):
    o, r = await _load_offer_for_user(offer_id, user)
    events = await db.job_events.find(
        {"request_id": o["request_id"], "offer_id": {"$in": [offer_id, None]}}
    ).sort("created_at", 1).to_list(500)
    return {"events": pub_list(events)}


class MessageIn(BaseModel):
    text: str


@router.get("/{offer_id}/messages")
async def get_messages(offer_id: str, user: dict = Depends(get_current_user)):
    o, r = await _load_offer_for_user(offer_id, user)
    msgs = await db.job_messages.find({"offer_id": offer_id}).sort("created_at", 1).to_list(500)
    return {"messages": pub_list(msgs)}


@router.post("/{offer_id}/messages")
async def send_message(offer_id: str, body: MessageIn, user: dict = Depends(get_current_user)):
    o, r = await _load_offer_for_user(offer_id, user)
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="الرسالة فارغة")
    doc = {"_id": new_id(), "offer_id": offer_id, "request_id": o["request_id"],
           "sender_id": user["_id"], "sender_name": user["name"], "sender_role": user["role"],
           "text": text, "created_at": now_iso()}
    await db.job_messages.insert_one(doc)
    other = o["business_id"] if user["role"] == "worker" else o["worker_id"]
    await notify(other, "رسالة جديدة", f"{user['name']}: {text[:80]}", "chat", None)
    await log_event(o["request_id"], offer_id, user, "message_sent")
    return {"ok": True, "message": pub(doc)}


class ContactIn(BaseModel):
    channel: str  # call | chat


@router.post("/{offer_id}/contact")
async def contact(offer_id: str, body: ContactIn, user: dict = Depends(get_current_user)):
    o, r = await _load_offer_for_user(offer_id, user)
    await log_event(o["request_id"], offer_id, user, "contact_initiated", notes=f"channel={body.channel}")
    if body.channel == "call":
        # masked/relay calling integration point — personal numbers are never exposed
        return {"ok": True, "masked": True,
                "message": "المكالمات الصوتية عبر المنصة ستُفعّل عبر مزوّد الاتصال — استخدم المحادثة داخل التطبيق حالياً"}
    return {"ok": True, "masked": True, "message": "استخدم المحادثة داخل التطبيق"}
