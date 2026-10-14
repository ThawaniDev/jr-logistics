"""Client-specific negotiated pricing with full version history + pricing snapshots."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from db import db
from deps import require_staff
from utils import new_id, now_iso, pub, pub_list, audit, get_client_pricing
from catalog import SERVICE_MAP

router = APIRouter(prefix="/api/admin/pricing", tags=["pricing"])
p_view = Depends(require_staff("pricing_view", "pricing"))
p_edit = Depends(require_staff("pricing_edit", "pricing"))


class PricingIn(BaseModel):
    business_id: str
    rate: float
    commission_rate: float
    effective_date: str
    version: Optional[str] = None
    notes: Optional[str] = None
    reason: Optional[str] = None


@router.get("")
async def list_pricing(business_id: Optional[str] = None, user: dict = p_view):
    query = {"business_id": business_id} if business_id else {}
    items = await db.client_pricing.find(query).sort("created_at", -1).to_list(500)
    for p in items:
        b = await db.users.find_one({"_id": p["business_id"]},
                                    {"name": 1, "phone": 1, "business_profile.company_name": 1})
        p["business"] = pub(b)
    return {"pricing": pub_list(items)}


@router.get("/history/{business_id}")
async def pricing_history(business_id: str, user: dict = p_view):
    items = await db.client_pricing.find({"business_id": business_id}).sort("created_at", -1).to_list(200)
    return {"history": pub_list(items)}


@router.post("")
async def set_pricing(body: PricingIn, user: dict = p_edit):
    if body.rate <= 0:
        raise HTTPException(status_code=400, detail="السعر يجب أن يكون أكبر من صفر")
    if not 0 < body.commission_rate <= 0.5:
        raise HTTPException(status_code=400, detail="نسبة العمولة بين 1% و 50%")
    biz = await db.users.find_one({"_id": body.business_id, "role": "business"})
    if not biz:
        raise HTTPException(status_code=404, detail="المنشأة غير موجودة")
    current = await get_client_pricing(body.business_id)
    await db.client_pricing.update_many(
        {"business_id": body.business_id, "status": "active"},
        {"$set": {"status": "superseded", "superseded_at": now_iso()}})
    doc = {
        "_id": new_id(), "business_id": body.business_id,
        "rate": round(body.rate, 2), "commission_rate": body.commission_rate,
        "effective_date": body.effective_date, "status": "active",
        "version": body.version or f"v-{now_iso()[:10]}",
        "notes": body.notes, "reason": body.reason,
        "old_rate": current["rate"] if current else None,
        "old_commission_rate": current["commission_rate"] if current else None,
        "created_by": {"id": user["_id"], "name": user["name"]},
        "created_at": now_iso(),
    }
    await db.client_pricing.insert_one(doc)
    await audit(user, "pricing_changed", "business", body.business_id,
                before={"rate": doc["old_rate"], "commission_rate": doc["old_commission_rate"]},
                after={"rate": doc["rate"], "commission_rate": doc["commission_rate"],
                       "version": doc["version"]},
                note=body.reason)
    return {"ok": True, "pricing": pub(doc)}


@router.post("/{pricing_id}/deactivate")
async def deactivate_pricing(pricing_id: str, user: dict = p_edit):
    p = await db.client_pricing.find_one({"_id": pricing_id})
    if not p:
        raise HTTPException(status_code=404, detail="غير موجود")
    await db.client_pricing.update_one({"_id": pricing_id},
                                       {"$set": {"status": "inactive", "deactivated_at": now_iso()}})
    await audit(user, "pricing_deactivated", "business", p["business_id"],
                before={"rate": p["rate"], "version": p.get("version")})
    return {"ok": True}


# ---------- Route-based pricing rules (vehicle + temperature + pickup + delivery) ----------

class PricingRuleIn(BaseModel):
    business_id: Optional[str] = None  # null = global rule
    vehicle_type: str
    temperature_type: Optional[str] = None
    pickup_city: str
    delivery_city: str
    price: float
    effective_date: str
    expiry_date: Optional[str] = None
    service_type: Optional[str] = None  # null = applies to all vehicle services
    notes: Optional[str] = None
    agreement_ref: Optional[str] = None
    version: Optional[str] = None


@router.get("/rules")
async def list_rules(business_id: Optional[str] = None, user: dict = p_view):
    query = {"business_id": business_id} if business_id else {}
    items = await db.pricing_rules.find(query).sort("created_at", -1).to_list(500)
    for p in items:
        if p.get("business_id"):
            b = await db.users.find_one({"_id": p["business_id"]},
                                        {"name": 1, "business_profile.company_name": 1})
            p["business"] = pub(b) if b else None
    return {"rules": pub_list(items)}


@router.post("/rules")
async def create_rule(body: PricingRuleIn, user: dict = p_edit):
    if body.price <= 0:
        raise HTTPException(status_code=400, detail="السعر يجب أن يكون أكبر من صفر")
    if body.vehicle_type not in ("sedan", "dokker", "hiace", "van", "dyna"):
        raise HTTPException(status_code=400, detail="نوع المركبة غير صالح")
    if body.vehicle_type in ("van", "dyna"):
        if body.temperature_type not in ("dry", "cold"):
            raise HTTPException(status_code=400, detail="حدد نوع الحرارة (جاف/مبرد) لمركبات الفان والدينا")
    else:
        body.temperature_type = None
    if body.service_type and body.service_type not in SERVICE_MAP:
        raise HTTPException(status_code=400, detail="نوع الخدمة غير صالح")
    if body.expiry_date:
        from datetime import date as _date
        try:
            if _date.fromisoformat(body.expiry_date) < _date.fromisoformat(body.effective_date):
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="تاريخ الانتهاء يجب أن يكون بعد تاريخ السريان")
    if body.business_id:
        biz = await db.users.find_one({"_id": body.business_id, "role": "business"})
        if not biz:
            raise HTTPException(status_code=404, detail="المنشأة غير موجودة")
    dup_q = {"business_id": body.business_id, "vehicle_type": body.vehicle_type,
             "temperature_type": body.temperature_type, "pickup_city": body.pickup_city,
             "delivery_city": body.delivery_city, "service_type": body.service_type,
             "status": "active"}
    await db.pricing_rules.update_many(dup_q, {"$set": {"status": "superseded", "superseded_at": now_iso()}})
    doc = {"_id": new_id(), **body.model_dump(), "status": "active",
           "version": body.version or f"v-{now_iso()[:10]}",
           "created_by": {"id": user["_id"], "name": user["name"]}, "created_at": now_iso()}
    await db.pricing_rules.insert_one(doc)
    await audit(user, "pricing_rule_created", "pricing_rule", doc["_id"],
                after={"vehicle_type": doc["vehicle_type"], "temperature_type": doc["temperature_type"],
                       "pickup_city": doc["pickup_city"], "delivery_city": doc["delivery_city"],
                       "price": doc["price"], "version": doc["version"],
                       "business_id": doc["business_id"], "agreement_ref": doc["agreement_ref"]})
    return {"ok": True, "rule": pub(doc)}


@router.post("/rules/{rule_id}/deactivate")
async def deactivate_rule(rule_id: str, user: dict = p_edit):
    p = await db.pricing_rules.find_one({"_id": rule_id})
    if not p:
        raise HTTPException(status_code=404, detail="غير موجود")
    await db.pricing_rules.update_one({"_id": rule_id},
                                      {"$set": {"status": "inactive", "deactivated_at": now_iso()}})
    await audit(user, "pricing_rule_deactivated", "pricing_rule", rule_id,
                before={"price": p["price"], "version": p.get("version")})
    return {"ok": True}
