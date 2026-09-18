import mimetypes
import os
import pathlib

import requests
from fastapi import HTTPException

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "isnad"
LOCAL_DIR = pathlib.Path("/app/backend/uploads")

_storage_key = None


def init_storage(force: bool = False) -> str:
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init",
                         json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")}, timeout=30)
    if resp.status_code >= 400:
        raise HTTPException(status_code=503,
                            detail={"code": "STORAGE_UNAVAILABLE",
                                    "message": "خدمة التخزين غير متاحة مؤقتاً — Storage service temporarily unavailable"})
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _local_path(path: str) -> pathlib.Path:
    p = (LOCAL_DIR / path).resolve()
    if not str(p).startswith(str(LOCAL_DIR.resolve())):
        raise HTTPException(status_code=400, detail="مسار غير صالح")
    return p


def put_object(path: str, data: bytes, content_type: str) -> dict:
    try:
        key = init_storage()
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type},
                            data=data, timeout=120)
        if resp.status_code == 404:
            key = init_storage(force=True)
            resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                                headers={"X-Storage-Key": key, "Content-Type": content_type},
                                data=data, timeout=120)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        dest = _local_path(path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return {"path": path, "storage": "local", "size": len(data)}


def get_object(path: str) -> tuple:
    local = _local_path(path)
    if local.exists():
        return local.read_bytes(), mimetypes.guess_type(str(local))[0] or "application/octet-stream"
    try:
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key}, timeout=60)
        if resp.status_code == 404:
            raise FileNotFoundError(path)
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    except FileNotFoundError:
        raise
    except Exception:
        raise FileNotFoundError(path)
