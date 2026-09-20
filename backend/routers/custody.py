"""Simple custody / asset handover between warehouse (business) and driver."""
from typing import List, Optional, Literal

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from deps import require_roles, get_current_user
from utils import new_id, now_iso, pub, pub_list, audit, notify, log_event

router = APIRouter(prefix="/api/custody", tags=["custody"])

CUSTODY_ITEM_TYPES = ["pos_device", "network_device", "phone", "charger", "bag", "other"]


class CustodyItemIn(BaseModel):
    type: str
    label: Optional[str] = None
    qty: int = 1
    note: Optional[str] = None


class HandoverIn(BaseModel):
    offer_id: str
    items: List[CustodyItemIn]
    note: Optional[str] = None


async def _offer_and_request(offer_id: str):
    o = await db.offers.find_one({"_id": offer_id})
    if not o:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة")
    r = await db.requests.find_one({"_id": o["request_id"]})
    return o, r


@router.post("/handover")
async def create_handover(body: HandoverIn, user: dict = Depends(require_roles("business"))):
    o, r = await _offer_and_request(body.offer_id)
    if r["business_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="غير مصرح")
    if o["status"] not in ("attendance_confirmed", "attended", "delivered_reported", "pending_settlement"):
        raise HTTPException(status_code=400, detail="يمكن تسجيل العهدة بعد وصول المندوب")
    if not body.items:
        raise HTTPException(status_code=400, detail="أضف صنفاً واحداً على الأقل")
    for it in body.items:
        if it.type not in CUSTODY_ITEM_TYPES:
            raise HTTPException(status_code=400, detail="نوع صنف غير صالح")
        if it.qty < 1:
            raise HTTPException(status_code=400, detail="كمية غير صالحة")
    if await db.custody.find_one({"offer_id": body.offer_id,
                                  "status": {"$in": ["pending_confirm", "confirmed"]}}):
        raise HTTPException(status_code=400, detail="توجد عهدة نشطة لهذه المهمة")
    doc = {
        "_id": new_id(), "request_id": r["_id"], "offer_id": o["_id"],
        "business_id": user["_id"], "worker_id": o["worker_id"],
        "items": [it.model_dump() for it in body.items],
        "note": body.note, "status": "pending_confirm",
        "handed_by": {"id": user["_id"], "name": user["name"]}, "handed_at": now_iso(),
        "returns": [], "created_at": now_iso(),
    }
    await db.custody.insert_one(doc)
    await notify(o["worker_id"], "عهدة جديدة بانتظار تأكيدك",
                 f"المنشأة سلّمتك أصنافاً لمهمة: {r['title']} — أكّد الاستلام من صفحة مهامك",
                 "general", "/app/worker/jobs")
    await log_event(r["_id"], o["_id"], user, "custody_handed", notes=f"items={len(body.items)}")
    await audit(user, "custody_handed", "custody", doc["_id"],
                after={"offer_id": o["_id"], "items": len(body.items)})
    return {"ok": True, "custody": pub(doc)}


@router.post("/{custody_id}/confirm")
async def confirm_custody(custody_id: str, user: dict = Depends(require_roles("worker"))):
    c = await db.custody.find_one({"_id": custody_id})
    if not c or c["worker_id"] != user["_id"]:
        raise HTTPException(status_code=404, detail="العهدة غير موجودة")
    if c["status"] != "pending_confirm":
        raise HTTPException(status_code=400, detail="تم تأكيد هذه العهدة مسبقاً")
    await db.custody.update_one({"_id": custody_id},
                                {"$set": {"status": "confirmed", "confirmed_at": now_iso()}})
    await log_event(c["request_id"], c["offer_id"], user, "custody_confirmed")
    await notify(c["business_id"], "المندوب أكّد استلام العهدة",
                 "أكّد المندوب استلام الأصناف المسلّمة له", "general",
                 f"/app/business/requests/{c['request_id']}")
    return {"ok": True}


class ReturnItemIn(BaseModel):
    index: int
    status: Literal["returned", "not_returned", "damaged"]
    note: Optional[str] = None


class ReturnIn(BaseModel):
    items: List[ReturnItemIn]
    note: Optional[str] = None


@router.post("/{custody_id}/return")
async def record_return(custody_id: str, body: ReturnIn, user: dict = Depends(require_roles("business"))):
    c = await db.custody.find_one({"_id": custody_id})
    if not c or c["business_id"] != user["_id"]:
        raise HTTPException(status_code=404, detail="العهدة غير موجودة")
    if c["status"] not in ("confirmed", "pending_confirm"):
        raise HTTPException(status_code=400, detail="هذه العهدة أُقفلت مسبقاً")
    if not body.items:
        raise HTTPException(status_code=400, detail="حدد حالة كل صنف")
    seen = set()
    returns = []
    for ri in body.items:
        if ri.index < 0 or ri.index >= len(c["items"]) or ri.index in seen:
            raise HTTPException(status_code=400, detail="صنف غير صالح في الإرجاع")
        seen.add(ri.index)
        returns.append({"index": ri.index, "type": c["items"][ri.index]["type"],
                        "status": ri.status, "note": ri.note})
    if len(seen) != len(c["items"]):
        raise HTTPException(status_code=400, detail="حدد حالة جميع الأصناف")
    overall = "returned" if all(x["status"] == "returned" for x in returns) else "issue"
    await db.custody.update_one({"_id": custody_id}, {"$set": {
        "status": overall, "returns": returns, "return_note": body.note,
        "returned_by": {"id": user["_id"], "name": user["name"]}, "returned_at": now_iso()}})
    await log_event(c["request_id"], c["offer_id"], user, "custody_returned", notes=f"overall={overall}")
    await notify(c["worker_id"], "تم إقفال العهدة",
                 "سجّلت المنشأة إرجاع الأصناف" if overall == "returned"
                 else "سُجلت أصناف تالفة أو غير مرتجعة — راجع التفاصيل",
                 "general", "/app/worker/jobs")
    await audit(user, "custody_returned", "custody", custody_id, after={"overall": overall})
    return {"ok": True, "status": overall}


@router.get("/offer/{offer_id}")
async def custody_for_offer(offer_id: str, user: dict = Depends(get_current_user)):
    o, r = await _offer_and_request(offer_id)
    allowed = user["role"] in ("admin", "staff")
    if user["role"] == "business":
        allowed = r["business_id"] == user["_id"]
    elif user["role"] == "worker":
        allowed = o["worker_id"] == user["_id"]
    elif user["role"] == "office":
        w = await db.users.find_one({"_id": o["worker_id"]},
                                    {"worker_profile.provider_id": 1,
                                     "worker_profile.provider_status": 1})
        wp = (w or {}).get("worker_profile") or {}
        allowed = wp.get("provider_id") == user["_id"] and wp.get("provider_status") == "linked"
    if not allowed:
        raise HTTPException(status_code=403, detail="غير مصرح")
    items = await db.custody.find({"offer_id": offer_id}).sort("created_at", -1).to_list(50)
    return {"custody": pub_list(items)}


@router.get("/request/{request_id}")
async def custody_for_request(request_id: str, user: dict = Depends(get_current_user)):
    r = await db.requests.find_one({"_id": request_id})
    if not r:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    if user["role"] == "business" and r["business_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="غير مصرح")
    if user["role"] not in ("admin", "staff", "business", "office"):
        raise HTTPException(status_code=403, detail="غير مصرح")
    items = await db.custody.find({"request_id": request_id}).sort("created_at", -1).to_list(200)
    return {"custody": pub_list(items)}
