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
    responsible_person: Optional[str] = None
    address: Optional[str] = None
    tax_number: Optional[str] = None
    compliance_notes: Optional[str] = None
    vehicle_temperature: Optional[str] = None
    terms_accepted: bool = False


def set_auth_cookie(response: Response, token: str):
    # Multi-tab session isolation: Bearer token lives in per-tab sessionStorage;
    # a shared cookie would merge sessions across tabs, so it is intentionally not set.
    return


@router.post("/otp/send")
async def send_otp(body: OtpSend):
    phone = normalize_phone(body.phone)
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="رقم الجوال غير صحيح")
    existing = await db.users.find_one({"phone": phone}, {"role": 1})
    if existing and existing.get("role") in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="حسابات الإدارة والموظفين تدخل عبر بوابة الإدارة بكلمة المرور")
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
async def register(body: RegisterIn, response: Response, request: Request):
    try:
        payload = decode_token(body.registration_token)
        if payload.get("type") != "registration":
            raise ValueError
    except Exception:
        raise HTTPException(status_code=400, detail="جلسة التسجيل منتهية — أعد التحقق من رقمك")
    phone = payload["phone"]
    if body.role not in ("business", "worker", "office"):
        raise HTTPException(status_code=400, detail="نوع الحساب غير صالح")
    if not body.terms_accepted:
        raise HTTPException(status_code=400,
                            detail="يجب الموافقة على الشروط والأحكام واتفاقية استخدام منصة JR Logistics")
    if body.role == "worker" and body.vehicle_type in ("van", "dyna") and \
            body.vehicle_temperature not in ("dry", "cold"):
        raise HTTPException(status_code=400, detail="حدد نوع الحرارة (جاف/مبرد) للمركبة")
    if body.role == "worker" and body.vehicle_type and \
            body.vehicle_type not in ("sedan", "dokker", "hiace", "van", "dyna"):
        raise HTTPException(status_code=400, detail="نوع المركبة غير صالح")
    if body.role == "office" and not (body.company_name or "").strip():
        raise HTTPException(status_code=400, detail="أدخل اسم مكتب/شركة التوصيل")
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
            "vehicle_temperature": body.vehicle_temperature if body.vehicle_type in ("van", "dyna") else None,
            "availability": "available",
            "bank_name": body.bank_name,
            "iban": body.iban,
            "rating": None,
            "rating_count": 0,
            "jobs_completed": 0,
        }
    if body.role == "office":
        user["office_profile"] = {
            "office_name": (body.company_name or "").strip(),
            "cr_number": body.cr_number or "",
            "responsible_person": body.responsible_person or body.name,
            "address": body.address or "",
            "city": body.city or "",
            "bank_name": body.bank_name or "",
            "iban": body.iban or "",
            "tax_number": body.tax_number or "",
            "compliance_notes": body.compliance_notes or "",
            "verification_status": "pending",
        }
    if body.role == "business":
        bp = user.get("business_profile") or {}
        bp["verification_status"] = "pending"
        bp["responsible_person"] = body.responsible_person or body.name
        if body.address:
            bp["address"] = body.address
        user["business_profile"] = bp
    await db.users.insert_one(user)
    await get_wallet(user["_id"])
    from utils import get_settings
    settings = await get_settings()
    await db.terms_consents.insert_one({
        "_id": new_id(), "user_id": user["_id"], "account_type": body.role,
        "terms_version": settings.get("terms_version", "1.0"),
        "document_ref": f"JR-TERMS-{settings.get('terms_version', '1.0')}",
        "status": "accepted", "accepted_at": now_iso(),
        "ip": request.client.host if request.client else None,
    })
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
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login": now_iso()}})
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


class DemoLoginIn(BaseModel):
    user_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


@router.get("/demo-accounts")
async def get_demo_accounts():
    """Returns available demo accounts organized by user type for rapid testing/prototyping."""
    users = await db.users.find({"$or": [{"is_demo": True}, {"_id": {"$regex": "^u_"}}]},
                                 {"password_hash": 0}).sort("role", 1).to_list(100)
    categories = {
        "business": [],
        "worker": [],
        "office": [],
        "admin": [],
        "staff": [],
    }
    for u in users:
        role = u.get("role")
        if role not in categories:
            continue
        info = {
            "_id": u["_id"],
            "name": u.get("name"),
            "role": role,
            "phone": u.get("phone"),
            "email": u.get("email"),
            "city": u.get("city", "الرياض"),
            "status": u.get("status", "active"),
        }
        if role == "business":
            bp = u.get("business_profile") or {}
            info["title"] = bp.get("company_name") or u.get("name")
            info["subtitle"] = f"{bp.get('industry', 'خدمات لوجستية')} • {u.get('city', 'الرياض')}"
            info["badge"] = "منشأة أعمال"
        elif role == "worker":
            wp = u.get("worker_profile") or {}
            vt = wp.get("vehicle_type", "مركبة")
            rating = wp.get("rating", 4.8)
            info["title"] = u.get("name")
            info["subtitle"] = f"{vt} • {rating} ⭐"
            info["badge"] = "سائق / مندوب"
        elif role == "office":
            op = u.get("office_profile") or {}
            info["title"] = op.get("office_name") or u.get("name")
            info["subtitle"] = f"مكتب موثق • {u.get('city', 'الرياض')}"
            info["badge"] = "مكتب توصيل"
        elif role == "staff":
            sp = u.get("staff_profile") or {}
            sr = sp.get("staff_role", "support")
            role_names = {"support": "الدعم وخدمة العملاء", "operations": "مشرف العمليات", "finance": "المحاسبة والمالية"}
            info["title"] = u.get("name")
            info["subtitle"] = role_names.get(sr, sr)
            info["badge"] = "موظف منصة"
            info["staff_role"] = sr
        elif role == "admin":
            info["title"] = u.get("name")
            info["subtitle"] = "صلاحيات كاملة على النظام"
            info["badge"] = "مدير المنصة"

        categories[role].append(info)
    return {"demo_accounts": categories}


@router.post("/demo-login")
async def demo_login(body: DemoLoginIn, response: Response):
    """Direct 1-click login for any demo account to streamline prototyping."""
    query = {}
    if body.user_id:
        query["_id"] = body.user_id
    elif body.phone:
        query["phone"] = normalize_phone(body.phone)
    elif body.email:
        query["email"] = body.email.lower().strip()
    else:
        raise HTTPException(status_code=400, detail="حدد الحساب التجريبي")

    user = await db.users.find_one(query)
    if not user:
        raise HTTPException(status_code=404, detail="الحساب التجريبي غير موجود")

    if not user.get("is_demo") and not user.get("_id", "").startswith("u_"):
        raise HTTPException(status_code=403, detail="هذه الخاصية للحسابات التجريبية فقط")

    token = create_access_token(user)
    set_auth_cookie(response, token)
    await audit(user, "demo_quick_login", "user", user["_id"])
    return {"token": token, "user": pub(user)}
