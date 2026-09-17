"""Finance center: settlements (accountant review/approve/payout), ledger, invoices, platform account."""
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional

from db import db
from deps import require_staff
from utils import (new_id, now_iso, pub, pub_list, audit, add_txn, get_wallet,
                   get_settings, next_invoice_no, notify, ledger_entry)

router = APIRouter(prefix="/api/admin/finance", tags=["finance"])
p_view = Depends(require_staff("settlements_view", "finance_view", "wallets"))
p_review = Depends(require_staff("settlement_review"))
p_approve = Depends(require_staff("settlement_approve"))
p_payout = Depends(require_staff("payout_execute"))


async def _enrich_settlement(s: dict) -> dict:
    s["driver"] = pub(await db.users.find_one({"_id": s["driver_id"]}, {"name": 1, "phone": 1}))
    b = await db.users.find_one({"_id": s["business_id"]},
                                {"name": 1, "phone": 1, "business_profile.company_name": 1})
    s["business"] = pub(b)
    s["request"] = pub(await db.requests.find_one({"_id": s["request_id"]},
                                                  {"title": 1, "city": 1, "start_date": 1, "status": 1}))
    return s


@router.get("/settlements")
async def list_settlements(status: Optional[str] = None, user: dict = p_view):
    query = {"status": status} if status else {}
    items = await db.settlements.find(query).sort("created_at", -1).to_list(500)
    for s in items:
        await _enrich_settlement(s)
    return {"settlements": pub_list(items)}


class ReviewIn(BaseModel):
    note: Optional[str] = None


@router.post("/settlements/{settlement_id}/review")
async def review_settlement(settlement_id: str, body: ReviewIn, user: dict = p_review):
    s = await db.settlements.find_one({"_id": settlement_id})
    if not s or s["status"] not in ("pending_review",):
        raise HTTPException(status_code=400, detail="لا يمكن مراجعة هذه التصفية في حالتها الحالية")
    await db.settlements.update_one({"_id": settlement_id},
                                    {"$set": {"status": "under_review",
                                              "reviewed_by": {"id": user["_id"], "name": user["name"],
                                                              "at": now_iso(), "note": body.note}}})
    await audit(user, "settlement_reviewed", "settlement", settlement_id, note=body.note)
    return {"ok": True}


class ApproveIn(BaseModel):
    note: Optional[str] = None


@router.post("/settlements/{settlement_id}/approve")
async def approve_settlement(settlement_id: str, body: ApproveIn, request: Request, user: dict = p_approve):
    s = await db.settlements.find_one({"_id": settlement_id})
    if not s or s["status"] not in ("pending_review", "under_review"):
        raise HTTPException(status_code=400, detail="لا يمكن اعتماد هذه التصفية في حالتها الحالية")
    # permanent, immutable approval record
    approval = {
        "accountant_id": user["_id"], "accountant_name": user["name"],
        "settlement_id": settlement_id, "request_id": s["request_id"],
        "driver_id": s["driver_id"], "business_id": s["business_id"],
        "final_qty": s["final_qty"], "gross": s["gross"],
        "commission": s["commission"], "net": s["net"], "vat": s["vat"],
        "note": body.note, "ip": request.client.host if request.client else None,
        "at": now_iso(),
    }
    await db.settlements.update_one({"_id": settlement_id},
                                    {"$set": {"status": "approved", "approved": approval}})
    await db.approvals.insert_one({"_id": new_id(), **approval})
    await audit(user, "settlement_approved", "settlement", settlement_id,
                after={"net": s["net"], "commission": s["commission"]}, note=body.note)
    return {"ok": True}


class PayoutIn(BaseModel):
    method: str = "bank_transfer"
    reference: Optional[str] = None
    note: Optional[str] = None


@router.post("/settlements/{settlement_id}/payout")
async def execute_payout(settlement_id: str, body: PayoutIn, user: dict = p_payout):
    s = await db.settlements.find_one({"_id": settlement_id})
    if not s or s["status"] != "approved":
        raise HTTPException(status_code=400, detail="يجب اعتماد التصفية قبل الصرف")
    r = await db.requests.find_one({"_id": s["request_id"]})
    o = await db.offers.find_one({"_id": s["offer_id"]})
    payment_ref = body.reference or f"PAY-{new_id()[:10].upper()}"
    settings = await get_settings()

    # money movement: driver net, platform commission, business reserved release/refund
    await db.wallets.update_one({"user_id": s["driver_id"]}, {"$inc": {"available": s["net"]}})
    share_reserved = s.get("reserved_share", s["gross"] + s["commission"])
    refund = round(share_reserved - s["gross"] - s["commission"], 2)
    await db.wallets.update_one({"user_id": s["business_id"]},
                                {"$inc": {"reserved": -share_reserved, "available": refund}})
    await db.offers.update_one({"_id": s["offer_id"]},
                               {"$set": {"status": "paid", "earning": s["net"], "paid_at": now_iso()}})
    await db.users.update_one({"_id": s["driver_id"]}, {"$inc": {"worker_profile.jobs_completed": 1}})

    title = (r or {}).get("title", s["request_id"])
    await add_txn(s["driver_id"], "payout", s["net"], "credit",
                  f"صرف أرباح مهمة: {title}", s["request_id"], actor=user, settlement_id=settlement_id)
    await add_txn("platform", "commission", s["commission"], "credit",
                  f"عمولة المنصة — طلب: {title}", s["request_id"], actor=user, settlement_id=settlement_id)
    await add_txn(s["business_id"], "release", s["gross"] + s["commission"], "debit",
                  f"تسوية طلب: {title}", s["request_id"], actor=user, settlement_id=settlement_id)
    if refund > 0:
        await add_txn(s["business_id"], "refund", refund, "credit",
                      f"استرداد فرق المحجوز — {title}", s["request_id"], actor=user,
                      settlement_id=settlement_id)

    invoice_no = await next_invoice_no()
    invoice = {
        "_id": new_id(), "number": invoice_no, "settlement_id": settlement_id,
        "request_id": s["request_id"], "business_id": s["business_id"],
        "driver_id": s["driver_id"], "gross": s["gross"], "commission": s["commission"],
        "vat_pct": s.get("vat_pct", settings.get("vat_pct", 15)), "vat": s["vat"],
        "net": s["net"], "status": "issued", "issued_by": {"id": user["_id"], "name": user["name"]},
        "created_at": now_iso(),
    }
    await db.invoices.insert_one(invoice)

    payout_rec = {"executed_by": {"id": user["_id"], "name": user["name"]},
                  "method": body.method, "reference": payment_ref,
                  "note": body.note, "at": now_iso()}
    await db.settlements.update_one({"_id": settlement_id},
                                    {"$set": {"status": "paid", "payout": payout_rec,
                                              "invoice_no": invoice_no, "paid_at": now_iso()}})
    await audit(user, "payout_executed", "settlement", settlement_id,
                after={"net": s["net"], "method": body.method, "reference": payment_ref},
                note=body.note)
    await notify(s["driver_id"], "تم إيداع أرباحك",
                 f"تم إيداع {s['net']} ر.س في محفظتك عن مهمة: {title}", "earning", "/app/worker/wallet")
    # request settled when all its settlements are paid
    remaining = await db.settlements.count_documents(
        {"request_id": s["request_id"], "status": {"$nin": ["paid", "rejected"]}})
    if remaining == 0:
        await db.requests.update_one({"_id": s["request_id"]},
                                     {"$set": {"settlement_status": "settled", "escrow_reserved": False}})
        await notify(s["business_id"], "اكتملت التسوية",
                     f"تمت تسوية طلب: {title} وصرف مستحقات المندوبين",
                     "completed", f"/app/business/requests/{s['request_id']}")
    return {"ok": True, "reference": payment_ref, "invoice_no": invoice_no}


class RejectIn(BaseModel):
    note: str


@router.post("/settlements/{settlement_id}/reject")
async def reject_settlement(settlement_id: str, body: RejectIn, user: dict = p_review):
    s = await db.settlements.find_one({"_id": settlement_id})
    if not s or s["status"] in ("paid",):
        raise HTTPException(status_code=400, detail="لا يمكن رفض تصفية مدفوعة")
    await db.settlements.update_one({"_id": settlement_id},
                                    {"$set": {"status": "rejected",
                                              "rejected_by": {"id": user["_id"], "name": user["name"],
                                                              "note": body.note, "at": now_iso()}}})
    await audit(user, "settlement_rejected", "settlement", settlement_id, note=body.note)
    return {"ok": True}


class CorrectIn(BaseModel):
    new_qty: Optional[float] = None
    amount_delta: Optional[float] = None
    reason: str


@router.post("/settlements/{settlement_id}/correct")
async def correct_settlement(settlement_id: str, body: CorrectIn, user: dict = p_approve):
    s = await db.settlements.find_one({"_id": settlement_id})
    if not s:
        raise HTTPException(status_code=404, detail="التصفية غير موجودة")
    adj = {
        "_id": new_id(), "correction_of": settlement_id, "request_id": s["request_id"],
        "offer_id": s["offer_id"], "driver_id": s["driver_id"], "business_id": s["business_id"],
        "old_qty": s.get("final_qty"), "new_qty": body.new_qty,
        "amount_delta": body.amount_delta or 0, "reason": body.reason,
        "status": "adjustment", "created_by": {"id": user["_id"], "name": user["name"]},
        "created_at": now_iso(),
    }
    await db.settlements.insert_one(adj)
    await ledger_entry("adjustment", body.amount_delta or 0, "credit", user,
                       request_id=s["request_id"], settlement_id=settlement_id,
                       note=f"تعديل على تصفية {settlement_id}: {body.reason}")
    await audit(user, "settlement_correction", "settlement", settlement_id,
                before={"final_qty": s.get("final_qty")},
                after={"new_qty": body.new_qty, "amount_delta": body.amount_delta},
                note=body.reason)
    return {"ok": True, "adjustment_id": adj["_id"]}


@router.get("/ledger")
async def list_ledger(type: Optional[str] = None, user_id: Optional[str] = None, user: dict = p_view):
    query = {}
    if type:
        query["type"] = type
    if user_id:
        query["user_id"] = user_id
    items = await db.ledger.find(query).sort("created_at", -1).to_list(1000)
    return {"ledger": pub_list(items)}


@router.get("/invoices")
async def list_invoices(user: dict = p_view):
    items = await db.invoices.find().sort("created_at", -1).to_list(500)
    for inv in items:
        b = await db.users.find_one({"_id": inv["business_id"]},
                                    {"name": 1, "business_profile.company_name": 1})
        inv["business"] = pub(b)
    return {"invoices": pub_list(items)}


@router.get("/platform")
async def platform_account(user: dict = p_view):
    commissions = await db.transactions.find({"user_id": "platform", "type": "commission"}).to_list(5000)
    commission_total = round(sum(t["amount"] for t in commissions), 2)
    paid_drivers = await db.transactions.find({"type": "payout"}).to_list(5000)
    paid_total = round(sum(t["amount"] for t in paid_drivers), 2)
    owed = await db.settlements.find({"status": {"$in": ["pending_review", "under_review", "approved"]}}).to_list(1000)
    owed_total = round(sum(s["net"] for s in owed), 2)
    wallets = await db.wallets.find({}, {"available": 1, "reserved": 1}).to_list(2000)
    refunds = await db.transactions.find({"type": "refund"}).to_list(5000)
    comp = await db.transactions.find({"note": {"$regex": "تعويض"}}).to_list(5000)
    return {
        "commission_revenue": commission_total,
        "driver_payouts_paid": paid_total,
        "driver_amounts_owed": owed_total,
        "reserved_total": round(sum(w.get("reserved") or 0 for w in wallets), 2),
        "wallets_available_total": round(sum(w.get("available") or 0 for w in wallets), 2),
        "refunds_total": round(sum(t["amount"] for t in refunds), 2),
        "compensation_total": round(sum(t["amount"] for t in comp), 2),
        "net_platform_revenue": commission_total,
    }
