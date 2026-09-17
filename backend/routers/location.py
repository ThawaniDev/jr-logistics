"""Live driver location: worker updates only when available & on active job; admin/ops view is audited."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from deps import require_roles, require_staff
from utils import new_id, now_iso, pub, pub_list, audit

router = APIRouter(prefix="/api", tags=["location"])
wrk = Depends(require_roles("worker"))
p_live = Depends(require_staff("live_location_view"))

ACTIVE = ["accepted", "confirmed", "attendance_confirmed", "attended", "driver_completed"]


class LocationIn(BaseModel):
    lat: float
    lng: float


@router.post("/worker/location")
async def update_location(body: LocationIn, user: dict = wrk):
    if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180):
        raise HTTPException(status_code=400, detail="إحداثيات غير صالحة")
    wp = user.get("worker_profile", {})
    if wp.get("availability") != "available":
        raise HTTPException(status_code=400, detail="المشاركة متاحة فقط عندما تكون متاحاً للعمل")
    active = await db.offers.find_one({"worker_id": user["_id"], "status": {"$in": ACTIVE}})
    await db.driver_locations.update_one(
        {"worker_id": user["_id"]},
        {"$set": {"worker_id": user["_id"], "lat": body.lat, "lng": body.lng,
                  "at": now_iso(), "active_request_id": active["request_id"] if active else None},
         "$setOnInsert": {"_id": new_id()}},
        upsert=True)
    return {"ok": True, "at": now_iso()}


@router.delete("/worker/location")
async def stop_location(user: dict = wrk):
    await db.driver_locations.delete_one({"worker_id": user["_id"]})
    return {"ok": True}


@router.get("/admin/locations")
async def live_locations(user: dict = p_live):
    items = await db.driver_locations.find().to_list(500)
    out = []
    for loc in items:
        w = await db.users.find_one({"_id": loc["worker_id"]},
                                    {"name": 1, "phone": 1, "worker_profile.availability": 1})
        if not w:
            continue
        job = None
        if loc.get("active_request_id"):
            r = await db.requests.find_one({"_id": loc["active_request_id"]},
                                           {"title": 1, "city": 1, "status": 1})
            job = pub(r)
        out.append({"worker_id": loc["worker_id"], "name": w["name"], "phone": w.get("phone"),
                    "availability": (w.get("worker_profile") or {}).get("availability"),
                    "lat": loc["lat"], "lng": loc["lng"], "at": loc["at"], "active_job": job})
    await audit(user, "live_location_viewed", "location", None,
                note=f"عرض {len(out)} موقعاً")
    return {"locations": out}
