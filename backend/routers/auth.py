import random
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List

from db import db
from security import create_access_token, create_registration_token, decode_token, hash_password, verify_password
from deps import get_current_user
from utils import new_id, now_iso, get_wallet, pub, audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


def normalize_phone(phone: str) -> str:
    p = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if p.startswith("05"):
        p = "+966" + p[1:]
    elif p.startswith("5") and len(p) == 9:
        p = "+966" + p
    return p


class OtpSend(BaseModel):
    phone: str


class OtpVerify(BaseModel):
    phone: str
    code: str


class RegisterIn(BaseModel):
    registration_token: str
    role: str
    name: str
    email: Optional[str] = None
    city: Optional[str] = None
    company_name: Optional[str] = None
    cr_number: Optional[str] = None
    industry: Optional[str] = None
    services: List[str] = []
    national_id: Optional[str] = None
    vehicle_type: Optional[str] = None
    bank_name: Optional[str] = None
    iban: Optional[str] = None


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="none", max_age=7 * 24 * 3600, path="/",
    )


@router.post("/otp/send")
async def send_otp(body: OtpSend):
    phone = normalize_phone(body.phone)
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="رقم الجوال غير صحيح")
    code = f"{random.randint(0, 9999):04d}"
    await db.otps.update_one(
        {"phone": phone},
        {"$set": {
            "code": code,
            "attempts": 0,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }},
        upsert=True,
    )
    return {
        "sent": True,
        "phone": phone,
        "demo_otp": code,
        "notice": "وضع العرض التجريبي: يتم عرض رمز التحقق هنا بدلاً من إرسال رسالة نصية",
    }


@router.post("/otp/verify")
async def verify_otp(body: OtpVerify, response: Response):
    phone = normalize_phone(body.phone)
    doc = await db.otps.find_one({"phone": phone})
    if not doc:
        raise HTTPException(status_code=400, detail="لم يتم طلب رمز تحقق لهذا الرقم")
    if datetime.fromisoformat(doc["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="انتهت صلاحية الرمز — أعد الإرسال")
    if doc.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="محاولات كثيرة — أعد إرسال الرمز")
    if doc["code"] != body.code.strip():
        await db.otps.update_one({"phone": phone}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="رمز التحقق غير صحيح")
    await db.otps.delete_one({"phone": phone})

    user = await db.users.find_one({"phone": phone})
    if user:
        if user.get("status") == "suspended":
            raise HTTPException(status_code=403, detail="الحساب موقوف — تواصل مع الدعم")
        if user["role"] in ("admin", "staff"):
            raise HTTPException(status_code=403, detail="حسابات الإدارة والموظفين تدخل عبر بوابة الإدارة بكلمة المرور")
        token = create_access_token(user)
        set_auth_cookie(response, token)
        return {"is_new": False, "token": token, "user": pub(user)}
    return {"is_new": True, "registration_token": create_registration_token(phone), "phone": phone}


@router.post("/register")
async def register(body: RegisterIn, response: Response):
    try:
        payload = decode_token(body.registration_token)
        if payload.get("type") != "registration":
            raise ValueError
    except Exception:
        raise HTTPException(status_code=400, detail="جلسة التسجيل منتهية — أعد التحقق من رقمك")
    phone = payload["phone"]
    if body.role not in ("business", "worker"):
        raise HTTPException(status_code=400, detail="نوع الحساب غير صالح")
    if await db.users.find_one({"phone": phone}):
        raise HTTPException(status_code=400, detail="هذا الرقم مسجل مسبقاً")

    user = {
        "_id": new_id(),
        "phone": phone,
        "email": (body.email or "").lower() or None,
        "name": body.name.strip(),
        "role": body.role,
        "city": body.city,
        "status": "active",
        "is_demo": False,
        "created_at": now_iso(),
    }
    if body.role == "business":
        user["business_profile"] = {
            "company_name": body.company_name or body.name,
            "cr_number": body.cr_number,
            "industry": body.industry,
            "rating": None,
            "rating_count": 0,
        }
    else:
        user["worker_profile"] = {
            "services": body.services,
            "national_id": body.national_id,
            "vehicle_type": body.vehicle_type,
            "availability": "available",
            "bank_name": body.bank_name,
            "iban": body.iban,
            "rating": None,
            "rating_count": 0,
            "jobs_completed": 0,
        }
    await db.users.insert_one(user)
    await get_wallet(user["_id"])
    token = create_access_token(user)
    set_auth_cookie(response, token)
    return {"token": token, "user": user}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    wallet = await get_wallet(user["_id"])
    return {"user": user, "wallet": wallet}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


# ---------- Super Admin / Staff password authentication ----------

LOCKOUT_AFTER = 5
LOCKOUT_MINUTES = 15


class AdminLoginIn(BaseModel):
    email: str
    password: str


@router.post("/admin/login")
async def admin_login(body: AdminLoginIn, request: Request, response: Response):
    raw = body.email.strip()
    email = raw.lower()
    phone = normalize_phone(raw)
    ip = request.client.host if request.client else "unknown"
    ident = f"{ip}:{email}"
    att = await db.login_attempts.find_one({"_id": ident})
    if att and att.get("locked_until") and \
            datetime.fromisoformat(att["locked_until"]) > datetime.now(timezone.utc):
        raise HTTPException(status_code=429, detail="محاولات كثيرة — الحساب مقفل مؤقتاً، حاول بعد 15 دقيقة")
    user = await db.users.find_one({"role": {"$in": ["admin", "staff"]},
                                    "$or": [{"email": email}, {"phone": phone}]})
    ok = user and user.get("password_hash") and verify_password(body.password, user["password_hash"])
    if not ok:
        count = (att or {}).get("count", 0) + 1
        upd = {"count": count, "last_at": now_iso()}
        if count >= LOCKOUT_AFTER:
            upd["locked_until"] = (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
            upd["count"] = 0
        await db.login_attempts.update_one({"_id": ident}, {"$set": upd}, upsert=True)
        raise HTTPException(status_code=401, detail="بيانات الدخول غير صحيحة")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="الحساب موقوف — تواصل مع مدير المنصة")
    await db.login_attempts.delete_one({"_id": ident})
    token = create_access_token(user)
    set_auth_cookie(response, token)
    await audit(user, "admin_login", "user", user["_id"])
    return {"token": token, "user": pub(user)}


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


@router.post("/change-password")
async def change_password(body: ChangePasswordIn, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="هذه العملية لحسابات الإدارة فقط")
    if not user.get("password_hash") or not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")
    await db.users.update_one({"_id": user["_id"]},
                              {"$set": {"password_hash": hash_password(body.new_password),
                                        "must_change_password": False,
                                        "password_changed_at": now_iso()}})
    await audit(user, "password_changed", "user", user["_id"])
    return {"ok": True}
