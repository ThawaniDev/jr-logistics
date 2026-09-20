"""Company API integration: business API keys + external v1 endpoints with call logging."""
import hashlib
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from db import db
from deps import require_roles
from routers.business import RequestIn, create_request
from utils import new_id, now_iso, pub, pub_list, audit

router = APIRouter(tags=["integrations"])
biz = Depends(require_roles("business"))


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class ApiKeyIn(BaseModel):
    name: str


@router.post("/api/business/api-keys")
async def create_api_key(body: ApiKeyIn, user: dict = biz):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="أدخل اسماً للمفتاح")
    active = await db.api_keys.count_documents({"business_id": user["_id"], "status": "active"})
    if active >= 5:
        raise HTTPException(status_code=400, detail="الحد الأقصى 5 مفاتيح نشطة")
    raw = f"jrk_{secrets.token_urlsafe(32)}"
    doc = {"_id": new_id(), "business_id": user["_id"], "name": body.name.strip(),
           "prefix": raw[:12], "key_hash": _hash_key(raw), "status": "active",
           "created_by": user["_id"], "created_at": now_iso(), "last_used_at": None}
    await db.api_keys.insert_one(doc)
    await audit(user, "api_key_created", "api_key", doc["_id"], after={"name": doc["name"]})
    safe = {k: v for k, v in doc.items() if k != "key_hash"}
    return {"ok": True, "api_key": raw, "key": pub(safe)}


@router.get("/api/business/api-keys")
async def list_api_keys(user: dict = biz):
    items = await db.api_keys.find({"business_id": user["_id"]}, {"key_hash": 0}) \
        .sort("created_at", -1).to_list(50)
    calls = await db.api_logs.count_documents({"business_id": user["_id"]})
    return {"keys": pub_list(items), "total_calls": calls}


@router.post("/api/business/api-keys/{key_id}/revoke")
async def revoke_api_key(key_id: str, user: dict = biz):
    res = await db.api_keys.update_one(
        {"_id": key_id, "business_id": user["_id"], "status": "active"},
        {"$set": {"status": "revoked", "revoked_at": now_iso()}})
    if not res.modified_count:
        raise HTTPException(status_code=404, detail="المفتاح غير موجود")
    await audit(user, "api_key_revoked", "api_key", key_id)
    return {"ok": True}


async def _api_auth(request: Request) -> dict:
    raw = request.headers.get("X-API-Key", "")
    if not raw:
        raise HTTPException(status_code=401, detail="API key required (X-API-Key header)")
    key = await db.api_keys.find_one({"key_hash": _hash_key(raw), "status": "active"})
    if not key:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    business = await db.users.find_one({"_id": key["business_id"], "role": "business", "status": "active"})
    if not business:
        raise HTTPException(status_code=403, detail="Business account not active")
    await db.api_keys.update_one({"_id": key["_id"]}, {"$set": {"last_used_at": now_iso()}})
    return {"key": key, "business": business}


async def _log_api(ctx: dict, request: Request, endpoint: str, status_code: int):
    await db.api_logs.insert_one({
        "_id": new_id(), "api_key_id": ctx["key"]["_id"], "business_id": ctx["business"]["_id"],
        "endpoint": endpoint, "method": request.method, "status_code": status_code,
        "ip": request.client.host if request.client else None, "created_at": now_iso()})


async def _job_status(r: dict) -> dict:
    counts = {}
    for st in ["offered", "accepted", "confirmed", "attendance_confirmed", "attended",
               "delivered_reported", "pending_settlement", "qty_disputed", "paid", "no_show"]:
        counts[st] = await db.offers.count_documents({"request_id": r["_id"], "status": st})
    return {"id": r["_id"], "title": r["title"], "status": r["status"],
            "service_type": r["service_type"], "city": r["city"],
            "start_date": r["start_date"], "start_time": r["start_time"],
            "required_count": r["required_count"],
            "settlement_status": r.get("settlement_status"),
            "created_via": r.get("created_via", "web"),
            "offer_counts": counts, "created_at": r["created_at"]}


@router.post("/api/v1/jobs", status_code=201)
async def api_create_job(body: RequestIn, request: Request):
    ctx = await _api_auth(request)
    body.terms = True  # API usage implies acceptance of current platform terms
    try:
        result = await create_request(body, ctx["business"])
    except HTTPException as e:
        await _log_api(ctx, request, "/api/v1/jobs", e.status_code)
        raise
    rid = result["request"]["_id"]
    await db.requests.update_one({"_id": rid}, {"$set": {"created_via": "api",
                                                          "api_key_id": ctx["key"]["_id"]}})
    await _log_api(ctx, request, "/api/v1/jobs", 201)
    r = await db.requests.find_one({"_id": rid})
    return {"job": await _job_status(r), "matched_workers": result.get("matched_workers", 0)}


@router.get("/api/v1/jobs")
async def api_list_jobs(request: Request, status: Optional[str] = None):
    ctx = await _api_auth(request)
    query = {"business_id": ctx["business"]["_id"]}
    if status:
        query["status"] = status
    reqs = await db.requests.find(query).sort("created_at", -1).to_list(200)
    await _log_api(ctx, request, "/api/v1/jobs", 200)
    return {"jobs": [await _job_status(r) for r in reqs]}


@router.get("/api/v1/jobs/{job_id}")
async def api_job_detail(job_id: str, request: Request):
    ctx = await _api_auth(request)
    r = await db.requests.find_one({"_id": job_id, "business_id": ctx["business"]["_id"]})
    await _log_api(ctx, request, f"/api/v1/jobs/{job_id}", 200 if r else 404)
    if not r:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": await _job_status(r)}


@router.get("/api/v1/jobs/{job_id}/events")
async def api_job_events(job_id: str, request: Request):
    ctx = await _api_auth(request)
    r = await db.requests.find_one({"_id": job_id, "business_id": ctx["business"]["_id"]})
    await _log_api(ctx, request, f"/api/v1/jobs/{job_id}/events", 200 if r else 404)
    if not r:
        raise HTTPException(status_code=404, detail="Job not found")
    events = await db.job_events.find({"request_id": job_id}).sort("created_at", 1).to_list(500)
    return {"events": pub_list(events)}
