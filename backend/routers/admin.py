from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Literal, List
from datetime import date

from db import db
from deps import require_admin, require_staff
from catalog import STAFF_ROLE_PRESETS
from utils import (new_id, now_iso, notify, notify_staff, add_txn, get_wallet,
                   pub, pub_list, get_settings, audit)
from routers.documents import recompute_verification

router = APIRouter(prefix="/api/admin", tags=["admin"])
adm = Depends(require_admin())
p_stats = Depends(require_staff("stats"))
p_users_view = Depends(require_staff("users", "users_view"))
p_users = Depends(require_staff("users"))
p_req_view = Depends(require_staff("requests", "requests_view"))
p_req = Depends(require_staff("requests"))
p_withdraw = Depends(require_staff("withdrawals"))
p_txn = Depends(require_staff("transactions"))
p_ratings = Depends(require_staff("ratings"))
p_docs = Depends(require_staff("documents"))
p_cases = Depends(require_staff("cases"))
p_audit = Depends(require_staff("audit"))


# ---------- Platform settings (Super Admin only) ----------

@router.get("/settings")
async def get_platform_settings(user: dict = adm):
    return {"settings": await get_settings()}


class SettingsIn(BaseModel):
    default_rate: Optional[float] = None
    commission_rate: Optional[float] = None
    vehicle_types: Optional[List[str]] = None
    service_areas: Optional[List[str]] = None
    no_work_compensation_pct: Optional[float] = None
    cancel_warning_threshold: Optional[int] = None
    cancel_suspend_threshold: Optional[int] = None
    cancel_suspend_days: Optional[int] = None
    cancel_weekly_limit: Optional[int] = None
    vat_pct: Optional[float] = None
    enabled_pickup_cities: Optional[List[str]] = None
    enabled_delivery_cities: Optional[List[str]] = None
    warehouse_confirm_pending_min: Optional[int] = None
    replacement_timeout_min: Optional[int] = None
    settlement_pending_hours: Optional[int] = None
    doc_expiry_warn_days: Optional[int] = None
    alert_no_checkin_grace_min: Optional[int] = None
    alert_unfilled_hours: Optional[int] = None
    urgent_unfilled_hours: Optional[int] = None
    terms_version: Optional[str] = None
    terms_business_text: Optional[str] = None
    terms_driver_text: Optional[str] = None


@router.patch("/settings")
async def update_platform_settings(body: SettingsIn, user: dict = adm):
    before = await get_settings()
    updates = {}
    if body.default_rate is not None:
        if body.default_rate <= 0:
            raise HTTPException(status_code=400, detail="السعر الافتراضي يجب أن يكون أكبر من صفر")
        updates["default_rate"] = body.default_rate
    if body.commission_rate is not None:
        if not 0 < body.commission_rate <= 0.5:
            raise HTTPException(status_code=400, detail="العمولة يجب أن تكون بين 1% و 50%")
        updates["commission_rate"] = body.commission_rate
    if body.no_work_compensation_pct is not None:
        if not 0 <= body.no_work_compensation_pct <= 100:
            raise HTTPException(status_code=400, detail="نسبة التعويض بين 0% و 100%")
        updates["no_work_compensation_pct"] = body.no_work_compensation_pct
    for field, lo, hi in (("cancel_warning_threshold", 1, 20),
                          ("cancel_suspend_threshold", 1, 20),
                          ("cancel_suspend_days", 1, 30),
                          ("cancel_weekly_limit", 1, 20)):
        v = getattr(body, field)
        if v is not None:
            if not lo <= v <= hi:
                raise HTTPException(status_code=400, detail="قيمة سياسة الإلغاء خارج النطاق المسموح")
            updates[field] = v
    if body.vat_pct is not None:
        if not 0 <= body.vat_pct <= 30:
            raise HTTPException(status_code=400, detail="نسبة الضريبة بين 0% و 30%")
        updates["vat_pct"] = body.vat_pct
    if body.vehicle_types is not None:
        cleaned = [v.strip() for v in body.vehicle_types if v.strip()]
        if not cleaned:
            raise HTTPException(status_code=400, detail="أضف نوع مركبة واحداً على الأقل")
        updates["vehicle_types"] = cleaned
    if body.service_areas is not None:
        cleaned = [v.strip() for v in body.service_areas if v.strip()]
        if not cleaned:
            raise HTTPException(status_code=400, detail="أضف منطقة خدمة واحدة على الأقل")
        updates["service_areas"] = cleaned
    for field in ("enabled_pickup_cities", "enabled_delivery_cities"):
        v = getattr(body, field)
        if v is not None:
            cleaned = [c.strip() for c in v if c.strip()]
            if not cleaned:
                raise HTTPException(status_code=400, detail="أضف مدينة واحدة على الأقل")
            updates[field] = cleaned
    for field, lo, hi in (("warehouse_confirm_pending_min", 5, 240),
                          ("replacement_timeout_min", 5, 240),
                          ("settlement_pending_hours", 1, 168),
                          ("doc_expiry_warn_days", 1, 180),
                          ("alert_no_checkin_grace_min", 5, 240),
                          ("alert_unfilled_hours", 1, 168),
                          ("urgent_unfilled_hours", 1, 720)):
        v = getattr(body, field)
        if v is not None:
            if not lo <= v <= hi:
                raise HTTPException(status_code=400, detail="قيمة التنبيه خارج النطاق المسموح")
            updates[field] = v
    for field in ("terms_version", "terms_business_text", "terms_driver_text"):
        v = getattr(body, field)
        if v is not None and v.strip():
            updates[field] = v.strip()
    if not updates:
        raise HTTPException(status_code=400, detail="لا توجد تغييرات")
    await db.settings.update_one({"key": "platform"}, {"$set": updates}, upsert=True)
    await audit(user, "settings_updated", "settings", "platform",
                before={k: before.get(k) for k in updates}, after=updates)
    return {"settings": await get_settings()}


# ---------- Dashboard stats (all staff) ----------

@router.get("/stats")
async def stats(user: dict = p_stats):
    pipeline = [{"$match": {"status": "completed"}},
                {"$group": {"_id": None, "gmv": {"$sum": "$estimated_total"}}}]
    gmv_res = await db.requests.aggregate(pipeline).to_list(1)
    comm_res = await db.transactions.aggregate(
        [{"$match": {"type": "commission"}}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]).to_list(1)
    by_status = {}
    for st in ["draft", "published", "filling", "confirmed", "in_progress", "completed", "cancelled"]:
        by_status[st] = await db.requests.count_documents({"status": st})
    return {
        "gmv": round(gmv_res[0]["gmv"], 2) if gmv_res else 0,
        "commission": round(comm_res[0]["total"], 2) if comm_res else 0,
        "businesses": await db.users.count_documents({"role": "business"}),
        "workers": await db.users.count_documents({"role": "worker"}),
        "requests_by_status": by_status,
        "pending_withdrawals": await db.withdrawals.count_documents({"status": "pending"}),
        "open_tickets": await db.tickets.count_documents({"status": {"$in": ["open", "in_review"]}}),
        "open_cases": await db.tickets.count_documents(
            {"category": {"$in": ["not_put_to_work", "business_not_ready"]},
             "status": {"$in": ["open", "in_review"]}}),
        "pending_documents": await db.driver_documents.count_documents({"status": "pending"}),
        "no_shows": await db.offers.count_documents({"status": "no_show"}),
        "recent_requests": pub_list(await db.requests.find().sort("created_at", -1).to_list(6)),
        "wallet_balances": round(sum((w.get("available") or 0) for w in
                                     await db.wallets.find({}, {"available": 1}).to_list(2000)), 2),
        "reserved_total": round(sum((w.get("reserved") or 0) for w in
                                    await db.wallets.find({}, {"reserved": 1}).to_list(2000)), 2),
        "driver_earnings": round(sum((t.get("amount") or 0) for t in
                                     await db.transactions.find({"type": "earning"}, {"amount": 1}).to_list(5000)), 2),
        "cancellations_total": await db.cancellations.count_documents({"kind": "cancellation"}),
        "replacement_requests": await db.requests.count_documents({"replacement_count": {"$gt": 0}}),
    }


@router.get("/cancellations")
async def list_cancellations(party: Optional[str] = None, kind: Optional[str] = None,
                             user: dict = p_req_view):
    query = {}
    if party in ("worker", "business"):
        query["party"] = party
    if kind in ("cancellation", "no_show"):
        query["kind"] = kind
    items = await db.cancellations.find(query).sort("created_at", -1).to_list(300)
    for c in items:
        if c.get("worker_id"):
            w = await db.users.find_one({"_id": c["worker_id"]}, {"name": 1, "phone": 1})
            c["worker"] = pub(w)
        if c.get("business_id"):
            b = await db.users.find_one({"_id": c["business_id"]},
                                        {"name": 1, "business_profile.company_name": 1})
            c["business"] = pub(b)
        if c.get("request_id"):
            r = await db.requests.find_one({"_id": c["request_id"]}, {"title": 1, "start_date": 1, "city": 1})
            c["request"] = pub(r)
    return {"cancellations": pub_list(items)}


# ---------- Users ----------

@router.get("/users")
async def list_users(role: Optional[str] = None, q: Optional[str] = None, user: dict = p_users_view):
    query = {"role": {"$in": ["business", "worker"]}}
    if role in ("business", "worker"):
        query = {"role": role}
    users = await db.users.find(query).sort("created_at", -1).to_list(500)
    if q:
        ql = q.lower()
        users = [u for u in users if ql in (u.get("name") or "").lower()
                 or ql in (u.get("phone") or "")
                 or ql in ((u.get("business_profile") or {}).get("company_name") or "").lower()]
    for u in users:
        u["wallet"] = pub(await get_wallet(u["_id"]))
    return {"users": pub_list(users)}


class StatusIn(BaseModel):
    status: Literal["active", "suspended"]


@router.patch("/users/{user_id}/status")
async def set_user_status(user_id: str, body: StatusIn, user: dict = p_users):
    target = await db.users.find_one({"_id": user_id})
    if not target or target["role"] in ("admin", "staff"):
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    await db.users.update_one({"_id": user_id}, {"$set": {"status": body.status}})
    await audit(user, "user_suspended" if body.status == "suspended" else "user_activated",
                "user", user_id, before=target.get("status"), after=body.status)
    await notify(user_id, "تحديث حالة الحساب",
                 "تم تفعيل حسابك" if body.status == "active" else "تم إيقاف حسابك — تواصل مع الدعم",
                 "account")
    return {"ok": True}


@router.post("/users/{user_id}/clear-suspension")
async def clear_cancel_suspension(user_id: str, user: dict = p_users):
    target = await db.users.find_one({"_id": user_id})
    if not target or target["role"] != "worker":
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    before = (target.get("worker_profile") or {}).get("suspended_until")
    await db.users.update_one({"_id": user_id},
                              {"$unset": {"worker_profile.suspended_until": ""},
                               "$set": {"worker_profile.cancel_count_week": 0}})
    await audit(user, "suspension_cleared", "user", user_id,
                before={"suspended_until": before}, note="رفع الإيقاف المؤقت للإلغاءات")
    await notify(user_id, "تم رفع الإيقاف المؤقت",
                 "رفع الإيقاف المؤقت عن حسابك — يمكنك قبول الفرص من جديد",
                 "account", "/app/worker/opportunities")
    return {"ok": True}


# ---------- Requests ----------

@router.get("/requests")
async def list_requests(status: Optional[str] = None, city: Optional[str] = None,
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        user: dict = p_req_view):
    query = {}
    if status:
        query["status"] = status
    if city:
        query["city"] = city
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        query["start_date"] = rng
    reqs = await db.requests.find(query).sort("created_at", -1).to_list(1000)
    for r in reqs:
        b = await db.users.find_one({"_id": r["business_id"]},
                                    {"business_profile.company_name": 1, "name": 1, "phone": 1})
        r["business"] = pub(b)
        r["counts"] = {}
        for st in ["offered", "accepted", "confirmed", "attended", "paid", "no_show"]:
            r["counts"][st] = await db.offers.count_documents({"request_id": r["_id"], "status": st})
    return {"requests": pub_list(reqs)}


@router.get("/requests/{request_id}")
async def request_detail(request_id: str, user: dict = p_req_view):
    r = await db.requests.find_one({"_id": request_id})
    if not r:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    b = await db.users.find_one({"_id": r["business_id"]}, {"business_profile.company_name": 1, "name": 1, "phone": 1})
    offers = await db.offers.find({"request_id": request_id}).to_list(200)
    for o in offers:
        o["worker"] = pub(await db.users.find_one({"_id": o["worker_id"]},
                                                  {"name": 1, "phone": 1, "worker_profile.rating": 1}))
    candidates = await db.users.find(
        {"role": "worker", "status": "active", "worker_profile.availability": "available",
         "worker_profile.verification_status": "verified",
         "worker_profile.services": r["service_type"]}).to_list(50)
    offered_ids = await db.offers.distinct("worker_id", {"request_id": request_id})
    candidates = [c for c in candidates if c["_id"] not in offered_ids]
    return {"request": pub(r), "business": pub(b), "offers": pub_list(offers), "candidates": pub_list(candidates)}


class MatchIn(BaseModel):
    worker_id: str


@router.post("/requests/{request_id}/match")
async def manual_match(request_id: str, body: MatchIn, user: dict = p_req):
    r = await db.requests.find_one({"_id": request_id})
    w = await db.users.find_one({"_id": body.worker_id, "role": "worker"})
    if not r or not w:
        raise HTTPException(status_code=404, detail="الطلب أو المندوب غير موجود")
    if r["status"] not in ("published", "filling", "confirmed", "in_progress"):
        raise HTTPException(status_code=400, detail="لا يمكن المطابقة في هذه الحالة")
    if await db.offers.find_one({"request_id": request_id, "worker_id": body.worker_id}):
        raise HTTPException(status_code=400, detail="للمندوب عرض مسبق على هذا الطلب")
    await db.offers.insert_one({
        "_id": new_id(), "request_id": request_id, "worker_id": body.worker_id,
        "business_id": r["business_id"], "status": "offered", "is_replacement": True,
        "earning": 0, "created_at": now_iso(), "responded_at": None,
    })
    await audit(user, "manual_match", "request", request_id, after={"worker_id": body.worker_id})
    await notify(body.worker_id, "فرصة جديدة من فريق المنصة",
                 f"رشّحك فريق إسناد لطلب: {r['title']} في {r['city']}", "offer", "/app/worker/opportunities")
    return {"ok": True}


# ---------- Withdrawals (Finance) ----------

@router.get("/withdrawals")
async def withdrawals(status: Optional[str] = None, user: dict = p_withdraw):
    query = {"status": status} if status else {}
    items = await db.withdrawals.find(query).sort("created_at", -1).to_list(300)
    for w in items:
        w["worker"] = pub(await db.users.find_one({"_id": w["worker_id"]}, {"name": 1, "phone": 1}))
        w["wallet"] = pub(await get_wallet(w["worker_id"]))
    return {"withdrawals": pub_list(items)}


class DecisionIn(BaseModel):
    action: Literal["approve", "reject"]
    note: Optional[str] = None


@router.post("/withdrawals/{wid}/decision")
async def withdrawal_decision(wid: str, body: DecisionIn, user: dict = p_withdraw):
    w = await db.withdrawals.find_one({"_id": wid})
    if not w or w["status"] != "pending":
        raise HTTPException(status_code=404, detail="الطلب غير موجود أو معالج مسبقاً")
    if body.action == "approve":
        wallet = await get_wallet(w["worker_id"])
        if wallet["available"] < w["amount"]:
            raise HTTPException(status_code=400, detail="رصيد المندوب غير كافٍ")
        await db.wallets.update_one({"user_id": w["worker_id"]}, {"$inc": {"available": -w["amount"]}})
        await add_txn(w["worker_id"], "withdrawal", w["amount"], "debit",
                      f"سحب إلى {w['bank_name']} — {w['iban']}")
        new_status = "approved"
    else:
        new_status = "rejected"
    await db.withdrawals.update_one({"_id": wid},
                                    {"$set": {"status": new_status, "processed_at": now_iso(),
                                              "processed_by": user["_id"], "note": body.note}})
    await audit(user, "payment_processed" if new_status == "approved" else "withdrawal_rejected",
                "withdrawal", wid, before="pending", after=new_status, note=body.note)
    await notify(w["worker_id"],
                 "تمت الموافقة على السحب" if new_status == "approved" else "تم رفض طلب السحب",
                 f"طلب سحب بقيمة {w['amount']} ر.س — {new_status == 'approved' and 'تم التحويل (تجريبي)' or (body.note or '')}",
                 "withdrawal", "/app/worker/wallet")
    return {"ok": True, "status": new_status}


# ---------- Transactions (Finance) ----------

@router.get("/transactions")
async def transactions(user: dict = p_txn):
    txns = await db.transactions.find().sort("created_at", -1).to_list(300)
    ids = {t["user_id"] for t in txns if t["user_id"] != "platform"}
    names = {}
    async for u in db.users.find({"_id": {"$in": list(ids)}}, {"name": 1}):
        names[u["_id"]] = u["name"]
    for t in txns:
        t["user_name"] = "المنصة" if t["user_id"] == "platform" else names.get(t["user_id"], "—")
    return {"transactions": pub_list(txns)}


# ---------- Broadcast (Super Admin) ----------

class BroadcastIn(BaseModel):
    title: str
    body: str
    target: Literal["all", "business", "worker"] = "all"


@router.post("/broadcast")
async def broadcast(body: BroadcastIn, user: dict = adm):
    query = {} if body.target == "all" else {"role": body.target}
    users = await db.users.find(query, {"_id": 1}).to_list(1000)
    for u in users:
        if u["_id"] == user["_id"]:
            continue
        await notify(u["_id"], body.title, body.body, "broadcast")
    await audit(user, "broadcast_sent", "notification", None, after={"target": body.target, "sent": len(users) - 1})
    return {"ok": True, "sent": len(users) - 1}


# ---------- Ratings ----------

@router.get("/ratings")
async def ratings(user: dict = p_ratings):
    items = await db.ratings.find().sort("created_at", -1).to_list(200)
    ids = {i["from_user"] for i in items} | {i["to_user"] for i in items}
    names = {}
    async for u in db.users.find({"_id": {"$in": list(ids)}}, {"name": 1}):
        names[u["_id"]] = u["name"]
    for i in items:
        i["from_name"] = names.get(i["from_user"], "—")
        i["to_name"] = names.get(i["to_user"], "—")
    return {"ratings": pub_list(items)}


# ---------- Staff management (Super Admin) ----------

@router.get("/staff")
async def list_staff(user: dict = adm):
    staff = await db.users.find({"role": "staff"}).sort("created_at", -1).to_list(100)
    return {"staff": pub_list(staff), "presets": STAFF_ROLE_PRESETS}


class StaffIn(BaseModel):
    name: str
    phone: str
    staff_role: str
    password: str = Field(min_length=8)
    permissions: Optional[List[str]] = None


@router.post("/staff")
async def create_staff(body: StaffIn, user: dict = adm):
    from routers.auth import normalize_phone
    from security import hash_password
    phone = normalize_phone(body.phone)
    if body.staff_role not in STAFF_ROLE_PRESETS:
        raise HTTPException(status_code=400, detail="الدور الوظيفي غير صالح")
    if await db.users.find_one({"phone": phone}):
        raise HTTPException(status_code=400, detail="رقم الجوال مسجل مسبقاً")
    perms = body.permissions or STAFF_ROLE_PRESETS[body.staff_role]
    doc = {
        "_id": new_id(), "phone": phone, "email": None, "name": body.name.strip(),
        "role": "staff", "status": "active", "city": None, "is_demo": False,
        "staff_profile": {"staff_role": body.staff_role, "permissions": perms},
        "password_hash": hash_password(body.password),
        "must_change_password": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await audit(user, "staff_created", "user", doc["_id"],
                after={"name": doc["name"], "staff_role": body.staff_role, "permissions": perms})
    return {"ok": True, "staff": pub(doc)}


class StaffUpdateIn(BaseModel):
    name: Optional[str] = None
    staff_role: Optional[str] = None
    permissions: Optional[List[str]] = None
    status: Optional[Literal["active", "suspended"]] = None
    password: Optional[str] = Field(default=None, min_length=8)


@router.patch("/staff/{sid}")
async def update_staff(sid: str, body: StaffUpdateIn, user: dict = adm):
    target = await db.users.find_one({"_id": sid, "role": "staff"})
    if not target:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    updates = {}
    if body.name:
        updates["name"] = body.name.strip()
    if body.staff_role:
        if body.staff_role not in STAFF_ROLE_PRESETS:
            raise HTTPException(status_code=400, detail="الدور الوظيفي غير صالح")
        updates["staff_profile.staff_role"] = body.staff_role
        if body.permissions is None:
            updates["staff_profile.permissions"] = STAFF_ROLE_PRESETS[body.staff_role]
    if body.permissions is not None:
        updates["staff_profile.permissions"] = body.permissions
    if body.status:
        updates["status"] = body.status
    if body.password:
        from security import hash_password
        updates["password_hash"] = hash_password(body.password)
        updates["must_change_password"] = True
    if not updates:
        raise HTTPException(status_code=400, detail="لا توجد تغييرات")
    await db.users.update_one({"_id": sid}, {"$set": updates})
    await audit(user, "staff_updated", "user", sid,
                before={"role": target.get("staff_profile", {}).get("staff_role"),
                        "status": target.get("status")},
                after=updates)
    return {"ok": True}


# ---------- Driver documents verification ----------

@router.get("/documents")
async def list_documents(status: Optional[str] = None, user: dict = p_docs):
    query = {"status": status} if status else {}
    items = await db.driver_documents.find(query).sort("uploaded_at", -1).to_list(300)
    today = date.today().isoformat()
    for d in items:
        d["worker"] = pub(await db.users.find_one({"_id": d["worker_id"]}, {"name": 1, "phone": 1}))
        d["expired"] = bool(d.get("expiry_date") and d["expiry_date"] < today)
    return {"documents": pub_list(items)}


class ReviewDocIn(BaseModel):
    action: Literal["verify", "reject"]
    note: Optional[str] = None


@router.post("/documents/{doc_id}/review")
async def review_document(doc_id: str, body: ReviewDocIn, user: dict = p_docs):
    doc = await db.driver_documents.find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="المستند غير موجود")
    new_status = "verified" if body.action == "verify" else "rejected"
    await db.driver_documents.update_one({"_id": doc_id},
                                         {"$set": {"status": new_status, "reviewed_by": user["_id"],
                                                   "review_note": body.note, "reviewed_at": now_iso()}})
    vstatus = await recompute_verification(doc["worker_id"])
    await audit(user, "driver_verified" if new_status == "verified" else "document_rejected",
                "document", doc_id, before=doc["status"], after=new_status, note=body.note)
    await notify(doc["worker_id"],
                 "تم توثيق مستندك" if new_status == "verified" else "تم رفض مستندك",
                 f"مستند {doc['type']}: {new_status == 'verified' and 'تم التوثيق بنجاح' or (body.note or 'مرفوض — أعد الرفع')}"
                 + (" — أنت الآن مؤهل لاستقبال الفرص" if vstatus == "verified" else ""),
                 "document", "/app/worker/documents")
    return {"ok": True, "verification_status": vstatus}


# ---------- Operational cases & compensation ----------

@router.get("/cases")
async def list_cases(user: dict = p_cases):
    items = await db.tickets.find(
        {"category": {"$in": ["not_put_to_work", "business_not_ready", "urgent_help", "shipment_count_differs"]}}
    ).sort("created_at", -1).to_list(200)
    for t in items:
        t["user"] = pub(await db.users.find_one({"_id": t["user_id"]}, {"name": 1, "phone": 1}))
        if t.get("request_id"):
            t["request"] = pub(await db.requests.find_one(
                {"_id": t["request_id"]},
                {"title": 1, "city": 1, "start_date": 1, "estimated_total": 1, "status": 1,
                 "required_count": 1, "commission_rate": 1, "escrow_reserved": 1, "business_id": 1}))
        if t.get("offer_id"):
            t["offer"] = pub(await db.offers.find_one({"_id": t["offer_id"]}))
    return {"cases": pub_list(items)}


class CompensateIn(BaseModel):
    percent: Optional[float] = None
    note: Optional[str] = None


@router.post("/offers/{offer_id}/compensate")
async def compensate_offer(offer_id: str, body: CompensateIn, user: dict = p_cases):
    o = await db.offers.find_one({"_id": offer_id})
    if not o or o["status"] not in ("attended", "attendance_confirmed", "driver_completed"):
        raise HTTPException(status_code=400, detail="لا يمكن صرف تعويض لهذه المهمة")
    r = await db.requests.find_one({"_id": o["request_id"]})
    if not r.get("escrow_reserved"):
        raise HTTPException(status_code=400, detail="لا توجد مبالغ محجوزة لهذا الطلب")
    settings = await get_settings()
    pct = body.percent if body.percent is not None else settings.get("no_work_compensation_pct", 100)
    if not 0 < pct <= 100:
        raise HTTPException(status_code=400, detail="نسبة التعويض بين 1% و 100%")
    share = round(r["estimated_total"] / r["required_count"], 2)
    gross = round(share * pct / 100, 2)
    commission = round(gross * r.get("commission_rate", 0.10), 2)
    net = round(gross - commission, 2)
    remainder = round(share - gross, 2)
    await db.wallets.update_one({"user_id": r["business_id"]},
                                {"$inc": {"reserved": -share, "available": remainder}})
    await db.wallets.update_one({"user_id": o["worker_id"]}, {"$inc": {"available": net}})
    await db.offers.update_one({"_id": offer_id},
                               {"$set": {"status": "paid", "earning": net, "compensation": True}})
    await add_txn(o["worker_id"], "earning", net, "credit",
                  f"تعويض عدم توفير العمل — {r['title']} ({pct}%)", r["_id"])
    await add_txn("platform", "commission", commission, "credit",
                  f"عمولة المنصة — تعويض {r['title']}", r["_id"])
    if remainder > 0:
        await add_txn(r["business_id"], "refund", remainder, "credit",
                      f"استرداد جزء محجوز — تعويض {pct}% لطلب {r['title']}", r["_id"])
    await db.tickets.update_many({"offer_id": offer_id},
                                 {"$set": {"status": "resolved", "resolved_at": now_iso()},
                                  "$push": {"activity": {"action": "compensation_approved",
                                                         "by": user["name"], "at": now_iso(),
                                                         "note": f"{pct}% — {net} ر.س"}}})
    await audit(user, "compensation_approved", "offer", offer_id,
                after={"percent": pct, "gross": gross, "net": net, "commission": commission},
                note=body.note)
    await notify(o["worker_id"], "تم صرف تعويضك",
                 f"تم إيداع {net} ر.س في محفظتك تعويضاً عن مهمة: {r['title']}",
                 "earning", "/app/worker/wallet")
    await notify(r["business_id"], "تمت معالجة حالة عدم توفير العمل",
                 f"طلب: {r['title']} — تعويض {pct}% من حصة المندوب واسترداد المتبقي",
                 "case", f"/app/business/requests/{r['_id']}")
    return {"ok": True, "gross": gross, "net": net, "commission": commission, "refunded": remainder}


# ---------- Audit log ----------

@router.get("/audit")
async def audit_log(user: dict = p_audit):
    items = await db.audit_logs.find().sort("created_at", -1).to_list(300)
    return {"logs": pub_list(items)}


# ---------- Courier offices & verification center ----------

p_offices = Depends(require_staff("offices_view", "users_view"))
p_offices_manage = Depends(require_staff("offices_manage", "verification_manage", "users_edit"))


@router.get("/offices")
async def list_offices(user: dict = p_offices):
    offices = await db.users.find({"role": "office"}).sort("created_at", -1).to_list(500)
    out = []
    for o in offices:
        drivers = await db.users.count_documents({"role": "worker",
                                                  "worker_profile.provider_id": o["_id"],
                                                  "worker_profile.provider_status": "linked"})
        settlements = await db.settlements.find({"office_id": o["_id"]}).to_list(500)
        out.append({**pub(o), "drivers_count": drivers,
                    "settlements_total": round(sum(s["net"] for s in settlements), 2),
                    "settlements_pending": sum(1 for s in settlements
                                               if s["status"] in ("pending_review", "under_review"))})
    return {"offices": out}


@router.get("/offices/{oid}")
async def office_detail(oid: str, user: dict = p_offices):
    o = await db.users.find_one({"_id": oid, "role": "office"})
    if not o:
        raise HTTPException(status_code=404, detail="المكتب غير موجود")
    drivers = await db.users.find({"role": "worker", "worker_profile.provider_id": oid}).to_list(500)
    docs = await db.office_documents.find({"office_id": oid}).sort("uploaded_at", -1).to_list(50)
    agr = await db.agreements.find_one({"office_id": oid}, sort=[("created_at", -1)])
    settlements = await db.settlements.find({"office_id": oid}).sort("created_at", -1).to_list(100)
    return {"office": pub(o), "drivers": pub_list(drivers), "documents": pub_list(docs),
            "agreement": pub(agr) if agr else None, "settlements": pub_list(settlements)}


class AccountVerifyIn(BaseModel):
    action: Literal["approve", "reject", "suspend"]
    reason: Optional[str] = None


@router.post("/offices/{oid}/verify")
async def verify_office(oid: str, body: AccountVerifyIn, user: dict = p_offices_manage):
    o = await db.users.find_one({"_id": oid, "role": "office"})
    if not o:
        raise HTTPException(status_code=404, detail="المكتب غير موجود")
    status_map = {"approve": "verified", "reject": "rejected", "suspend": "suspended"}
    await db.users.update_one({"_id": oid}, {"$set": {
        "office_profile.verification_status": status_map[body.action],
        "office_profile.verified_by": user["_id"], "office_profile.verified_at": now_iso(),
        "office_profile.rejection_reason": body.reason}})
    titles = {"approve": "تم توثيق مكتبك", "reject": "تم رفض توثيق مكتبك", "suspend": "تم تعليق مكتبك"}
    await notify(oid, titles[body.action],
                 body.reason or f"حالة التوثيق: {status_map[body.action]}", "general", "/app/office")
    await audit(user, f"office_{body.action}", "user", oid,
                before={"verification_status": (o.get("office_profile") or {}).get("verification_status")},
                after={"verification_status": status_map[body.action]}, note=body.reason)
    return {"ok": True, "verification_status": status_map[body.action]}


@router.post("/accounts/{uid}/verify")
async def verify_business_account(uid: str, body: AccountVerifyIn, user: dict = p_offices_manage):
    target = await db.users.find_one({"_id": uid, "role": "business"})
    if not target:
        raise HTTPException(status_code=404, detail="الحساب غير موجود")
    status_map = {"approve": "verified", "reject": "rejected", "suspend": "suspended"}
    await db.users.update_one({"_id": uid},
                               {"$set": {"business_profile.verification_status": status_map[body.action]}})
    titles = {"approve": "تم توثيق منشأتك", "reject": "تم رفض توثيق منشأتك", "suspend": "تم تعليق منشأتك"}
    await notify(uid, titles[body.action],
                 body.reason or f"حالة التوثيق: {status_map[body.action]}", "general", "/app/business")
    await audit(user, f"business_{body.action}", "user", uid,
                before={"verification_status": (target.get("business_profile") or {}).get("verification_status")},
                after={"verification_status": status_map[body.action]}, note=body.reason)
    return {"ok": True, "verification_status": status_map[body.action]}


class OfficeAgreementIn(BaseModel):
    version: str
    effective_date: str
    expiry_date: Optional[str] = None
    commercial_terms: Optional[str] = None
    provider_rate_note: Optional[str] = None
    commission_pct: Optional[float] = None
    settlement_terms: Optional[str] = None
    payment_terms: Optional[str] = None
    cancellation_rules: Optional[str] = None
    no_show_rules: Optional[str] = None
    replacement_rules: Optional[str] = None
    dispute_rules: Optional[str] = None
    responsibilities: Optional[str] = None
    data_protection: Optional[str] = None


@router.post("/offices/{oid}/agreement")
async def upsert_office_agreement(oid: str, body: OfficeAgreementIn, user: dict = p_offices_manage):
    o = await db.users.find_one({"_id": oid, "role": "office"})
    if not o:
        raise HTTPException(status_code=404, detail="المكتب غير موجود")
    await db.agreements.update_many({"office_id": oid, "status": "pending_acceptance"},
                                    {"$set": {"status": "superseded"}})
    doc = {"_id": new_id(), "office_id": oid, "jr_entity": "JR Logistics",
           **body.model_dump(), "status": "pending_acceptance",
           "created_by": {"id": user["_id"], "name": user["name"]}, "created_at": now_iso()}
    await db.agreements.insert_one(doc)
    await notify(oid, "اتفاقية جديدة بانتظار قبولك",
                 f"أصدرت JR Logistics اتفاقية إصدار {body.version} — راجعها واقبلها لتفعيل العمل المدفوع",
                 "general", "/app/office/agreement")
    await audit(user, "office_agreement_issued", "agreement", doc["_id"], after={"version": body.version})
    return {"ok": True, "agreement": pub(doc)}


@router.get("/verification-center")
async def verification_center(user: dict = p_offices_manage):
    from datetime import timedelta as _td
    pending_businesses = await db.users.find(
        {"role": "business", "business_profile.verification_status": "pending"}).to_list(200)
    pending_offices = await db.users.find(
        {"role": "office", "office_profile.verification_status": "pending"}).to_list(200)
    pending_drivers = await db.users.find(
        {"role": "worker", "worker_profile.verification_status": "pending"}).to_list(200)
    driver_docs = await db.driver_documents.find(
        {"status": {"$in": ["pending", "rejected"]}}).sort("uploaded_at", -1).to_list(300)
    office_docs = await db.office_documents.find(
        {"status": {"$in": ["pending", "rejected"]}}).sort("uploaded_at", -1).to_list(300)
    today = date.today().isoformat()
    warn = (date.today() + _td(days=30)).isoformat()
    expiring = await db.driver_documents.find(
        {"status": "verified", "expiry_date": {"$ne": None, "$gte": today, "$lte": warn}}).to_list(300)
    expired = await db.driver_documents.find(
        {"status": "verified", "expiry_date": {"$ne": None, "$lt": today}}).to_list(200)
    return {"pending_businesses": pub_list(pending_businesses),
            "pending_offices": pub_list(pending_offices),
            "pending_drivers": pub_list(pending_drivers),
            "driver_docs": pub_list(driver_docs), "office_docs": pub_list(office_docs),
            "expiring_docs": pub_list(expiring), "expired_docs": pub_list(expired)}


class OfficeDocReviewIn(BaseModel):
    action: Literal["verify", "reject"]
    reason: Optional[str] = None


@router.post("/office-documents/{doc_id}/review")
async def review_office_document(doc_id: str, body: OfficeDocReviewIn, user: dict = p_offices_manage):
    d = await db.office_documents.find_one({"_id": doc_id})
    if not d:
        raise HTTPException(status_code=404, detail="المستند غير موجود")
    if body.action == "reject" and not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="أدخل سبب الرفض")
    status = "verified" if body.action == "verify" else "rejected"
    await db.office_documents.update_one({"_id": doc_id}, {"$set": {
        "status": status, "reviewed_by": user["_id"], "reviewed_at": now_iso(),
        "rejection_reason": body.reason}})
    await notify(d["office_id"],
                 "تم توثيق مستندك" if status == "verified" else "تم رفض مستندك",
                 f"مستند {d['type']}" + (f" — السبب: {body.reason}" if body.reason else ""),
                 "general", "/app/office/documents")
    await audit(user, f"office_document_{status}", "office_document", doc_id,
                before={"status": d["status"]}, after={"status": status}, note=body.reason)
    return {"ok": True, "status": status}


@router.get("/office-documents/{doc_id}/file")
async def office_document_file(doc_id: str, user: dict = p_offices_manage):
    from fastapi import Response
    from storage import get_object
    d = await db.office_documents.find_one({"_id": doc_id})
    if not d:
        raise HTTPException(status_code=404, detail="المستند غير موجود")
    try:
        data, ct = get_object(d["file_path"])
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    return Response(content=data, media_type=d.get("content_type") or ct)
