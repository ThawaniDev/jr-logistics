from fastapi import Request, HTTPException
from db import db
from security import decode_token


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="غير مصرح — الرجاء تسجيل الدخول")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="رمز غير صالح")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="رمز غير صالح أو منتهي")
    user = await db.users.find_one({"_id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="المستخدم غير موجود")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="الحساب موقوف — تواصل مع الدعم")
    return user


def require_roles(*roles: str):
    async def checker(request: Request):
        u = await get_current_user(request)
        if u["role"] not in roles:
            raise HTTPException(status_code=403, detail="لا تملك صلاحية الوصول")
        return u
    return checker


def user_permissions(user: dict) -> set:
    if user["role"] == "admin":
        return {"*"}
    if user["role"] == "staff":
        return set((user.get("staff_profile") or {}).get("permissions", []))
    return set()


def require_staff(*perms: str):
    async def checker(request: Request):
        u = await get_current_user(request)
        if u["role"] not in ("admin", "staff"):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية الوصول")
        if u["role"] == "admin":
            return u
        granted = user_permissions(u)
        if any(p in granted for p in perms):
            return u
        raise HTTPException(status_code=403, detail="لا تملك صلاحية الوصول لهذا القسم")
    return checker


def require_admin():
    return require_roles("admin")
