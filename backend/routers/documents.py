import uuid
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.responses import Response

from db import db
from deps import get_current_user, require_roles, user_permissions
from catalog import DOC_TYPES
from storage import put_object, get_object, APP_NAME
from utils import new_id, now_iso, notify_staff, pub_list

router = APIRouter(prefix="/api/documents", tags=["documents"])
wrk = Depends(require_roles("worker"))

DOC_TYPE_KEYS = {d["key"] for d in DOC_TYPES}
REQUIRED_KEYS = [d["key"] for d in DOC_TYPES if d["required"]]


async def recompute_verification(worker_id: str) -> str:
    docs = await db.driver_documents.find({"worker_id": worker_id}).to_list(50)
    today = date.today().isoformat()
    status = "verified"
    for key in REQUIRED_KEYS:
        cands = [d for d in docs if d["type"] == key]
        if any(d["status"] == "verified" and (not d.get("expiry_date") or d["expiry_date"] >= today)
               for d in cands):
            continue
        if any(d["status"] == "verified" and d.get("expiry_date") and d["expiry_date"] < today
               for d in cands):
            status = "not_eligible"
            break
        status = "pending"
    await db.users.update_one({"_id": worker_id},
                              {"$set": {"worker_profile.verification_status": status}})
    return status


@router.post("/upload")
async def upload_document(doc_type: str = Form(...), expiry_date: str = Form(None),
                          file: UploadFile = File(...), user: dict = wrk):
    if doc_type not in DOC_TYPE_KEYS:
        raise HTTPException(status_code=400, detail="نوع المستند غير صالح")
    if expiry_date:
        try:
            if len(expiry_date) != 10:
                raise ValueError
            date.fromisoformat(expiry_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="تاريخ الانتهاء غير صالح — أدخل تاريخاً صحيحاً")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="حجم الملف يتجاوز 10MB")
    ct = file.content_type or "application/octet-stream"
    if not (ct.startswith("image/") or ct == "application/pdf"):
        raise HTTPException(status_code=400, detail="يُقبل فقط: صور أو PDF")
    ext = (file.filename.split(".")[-1] if "." in (file.filename or "") else "bin").lower()
    path = f"{APP_NAME}/docs/{user['_id']}/{uuid.uuid4().hex}.{ext}"
    put_object(path, data, ct)
    doc = {
        "_id": new_id(), "worker_id": user["_id"], "type": doc_type,
        "file_path": path, "original_filename": file.filename, "content_type": ct,
        "size": len(data), "expiry_date": expiry_date or None,
        "status": "pending", "uploaded_at": now_iso(),
    }
    await db.driver_documents.insert_one(doc)
    status = await recompute_verification(user["_id"])
    await notify_staff("documents", "مستند جديد للمراجعة",
                       f"{user['name']} رفع مستند: {doc_type}", "document", "/app/admin/documents")
    return {"ok": True, "verification_status": status}


@router.get("/mine")
async def my_documents(user: dict = wrk):
    docs = await db.driver_documents.find({"worker_id": user["_id"]}).sort("uploaded_at", -1).to_list(50)
    today = date.today().isoformat()
    soon = (date.today() + timedelta(days=30)).isoformat()
    missing = [k for k in REQUIRED_KEYS if not any(
        d["type"] == k and d["status"] == "verified"
        and (not d.get("expiry_date") or d["expiry_date"] >= today) for d in docs)]
    expiring = [d for d in docs if d["status"] == "verified" and d.get("expiry_date")
                and today <= d["expiry_date"] <= soon]
    return {
        "documents": pub_list(docs),
        "verification_status": user.get("worker_profile", {}).get("verification_status", "pending"),
        "missing": missing,
        "expiring_soon": pub_list(expiring),
        "doc_types": DOC_TYPES,
    }


@router.get("/{doc_id}/file")
async def download_document(doc_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.driver_documents.find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="المستند غير موجود")
    allowed = (user["_id"] == doc["worker_id"] or user["role"] == "admin"
               or "documents" in user_permissions(user))
    if not allowed:
        raise HTTPException(status_code=403, detail="لا تملك صلاحية عرض هذا المستند")
    try:
        data, ct = get_object(doc["file_path"])
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    return Response(content=data, media_type=doc.get("content_type", ct))
