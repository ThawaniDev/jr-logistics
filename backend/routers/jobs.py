"""Operations room: job timeline, in-app chat, masked-contact events."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from deps import get_current_user
from utils import new_id, now_iso, pub, pub_list, log_event, notify

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


async def _offer_office_id(offer: dict) -> str | None:
    worker = await db.users.find_one({"_id": offer["worker_id"]},
                                     {"worker_profile.provider_id": 1,
                                      "worker_profile.provider_status": 1})
    wp = (worker or {}).get("worker_profile") or {}
    return wp.get("provider_id") if wp.get("provider_status") == "linked" else None


async def _load_offer_for_user(offer_id: str, user: dict):
    o = await db.offers.find_one({"_id": offer_id})
    if not o:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة")
    if user["role"] not in ("admin", "staff"):
        if user["role"] == "worker" and o["worker_id"] != user["_id"]:
            raise HTTPException(status_code=403, detail="غير مصرح")
        if user["role"] == "business" and o["business_id"] != user["_id"]:
            raise HTTPException(status_code=403, detail="غير مصرح")
        if user["role"] == "office" and await _offer_office_id(o) != user["_id"]:
            raise HTTPException(status_code=403, detail="غير مصرح")
        if user["role"] not in ("worker", "business", "office"):
            raise HTTPException(status_code=403, detail="غير مصرح")
    r = await db.requests.find_one({"_id": o["request_id"]})
    return o, r


async def _notify_participants(offer: dict, sender: dict, text: str):
    recipients = {offer["business_id"], offer["worker_id"]}
    office_id = await _offer_office_id(offer)
    if office_id:
        recipients.add(office_id)
    recipients.discard(sender["_id"])
    for uid in recipients:
        await notify(uid, "رسالة جديدة", f"{sender['name']}: {text[:80]}", "chat", None)


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
           "office_id": await _offer_office_id(o),
           "text": text, "created_at": now_iso()}
    await db.job_messages.insert_one(doc)
    await _notify_participants(o, user, text)
    await log_event(o["request_id"], offer_id, user, "message_sent")
    return {"ok": True, "message": pub(doc)}


class ContactIn(BaseModel):
    channel: str  # call | chat


@router.post("/{offer_id}/contact")
async def contact(offer_id: str, body: ContactIn, user: dict = Depends(get_current_user)):
    o, r = await _load_offer_for_user(offer_id, user)
    await log_event(o["request_id"], offer_id, user, "contact_initiated", notes=f"channel={body.channel}")
    if body.channel == "call":
        return {"ok": True, "masked": True,
                "message": "المكالمات الصوتية عبر المنصة ستُفعّل عبر مزوّد الاتصال — استخدم المحادثة داخل التطبيق حالياً"}
    return {"ok": True, "masked": True, "message": "استخدم المحادثة داخل التطبيق"}
