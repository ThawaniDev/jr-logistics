"""Reporting center + operational alerts. Exports are RBAC-gated and audited."""
import csv
import io
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import Optional
from datetime import date, datetime, timezone, timedelta

from db import db
from deps import require_staff
from utils import pub, pub_list, audit, now_iso, get_settings

router = APIRouter(prefix="/api/admin/reports", tags=["reports"])
p_reports = Depends(require_staff("reports_view", "reports"))
p_export = Depends(require_staff("reports_export", "reports"))


def _date_rng(date_from: Optional[str], date_to: Optional[str]):
    if not (date_from or date_to):
        return {}
    rng = {}
    if date_from:
        rng["$gte"] = date_from
    if date_to:
        rng["$lte"] = date_to + "T23:59:59" if len(date_to) == 10 else date_to
    return rng


async def _report_rows(report_type: str, filters: dict) -> list[dict]:
    if report_type == "businesses":
        rows = []
        async for u in db.users.find({"role": "business"}):
            reqs = await db.requests.count_documents({"business_id": u["_id"]})
            done = await db.requests.count_documents({"business_id": u["_id"], "status": "completed"})
            wallet = await db.wallets.find_one({"user_id": u["_id"]}) or {}
            tickets = await db.tickets.count_documents({"user_id": u["_id"]})
            rows.append({"id": u["_id"], "name": u.get("name"),
                         "company": (u.get("business_profile") or {}).get("company_name"),
                         "phone": u.get("phone"), "city": u.get("city"),
                         "registered": u.get("created_at"), "status": u.get("status"),
                         "requests": reqs, "completed": done,
                         "wallet_available": wallet.get("available", 0),
                         "wallet_reserved": wallet.get("reserved", 0), "tickets": tickets})
        return rows
    if report_type == "drivers":
        rows = []
        async for u in db.users.find({"role": "worker"}):
            wp = u.get("worker_profile") or {}
            offers = await db.offers.find({"worker_id": u["_id"]}).to_list(1000)
            wallet = await db.wallets.find_one({"user_id": u["_id"]}) or {}
            by = {}
            for o in offers:
                by[o["status"]] = by.get(o["status"], 0) + 1
            rows.append({"id": u["_id"], "name": u.get("name"), "phone": u.get("phone"),
                         "city": u.get("city"), "registered": u.get("created_at"),
                         "status": u.get("status"), "availability": wp.get("availability"),
                         "vehicle": wp.get("vehicle_type"),
                         "verification": wp.get("verification_status"),
                         "offers": len(offers), "accepted": by.get("accepted", 0),
                         "completed_paid": by.get("paid", 0), "cancelled": by.get("cancelled", 0),
                         "no_shows": by.get("no_show", 0),
                         "earnings_total": round(sum(o.get("earning") or 0 for o in offers if o["status"] == "paid"), 2),
                         "wallet_available": wallet.get("available", 0),
                         "rating": wp.get("rating"), "cancel_count": wp.get("cancel_count", 0)})
        return rows
    if report_type == "requests":
        query = {}
        rng = _date_rng(filters.get("date_from"), filters.get("date_to"))
        if rng:
            query["created_at"] = rng
        if filters.get("city"):
            query["city"] = filters["city"]
        if filters.get("status"):
            query["status"] = filters["status"]
        rows = []
        async for r in db.requests.find(query).sort("created_at", -1).limit(2000):
            b = await db.users.find_one({"_id": r["business_id"]}, {"name": 1, "business_profile.company_name": 1})
            offers = await db.offers.find({"request_id": r["_id"]}).to_list(500)
            rows.append({"id": r["_id"], "title": r.get("title"),
                         "business": (b or {}).get("business_profile", {}).get("company_name") or (b or {}).get("name"),
                         "city": r.get("city"), "date": r.get("start_date"),
                         "status": r.get("status"), "drivers": r.get("required_count"),
                         "shipments": r.get("shipment_count"), "total": r.get("estimated_total"),
                         "commission": r.get("commission"),
                         "pricing_version": r.get("pricing_version"),
                         "offers": len(offers),
                         "accepted": sum(1 for o in offers if o["status"] in ("accepted", "confirmed", "attended", "paid")),
                         "no_shows": sum(1 for o in offers if o["status"] == "no_show"),
                         "created_at": r.get("created_at")})
        return rows
    if report_type == "finance":
        query = {}
        rng = _date_rng(filters.get("date_from"), filters.get("date_to"))
        if rng:
            query["created_at"] = rng
        if filters.get("type"):
            query["type"] = filters["type"]
        rows = []
        async for t in db.transactions.find(query).sort("created_at", -1).limit(3000):
            rows.append({"id": t["_id"], "user_id": t.get("user_id"), "type": t.get("type"),
                         "amount": t.get("amount"), "direction": t.get("direction"),
                         "status": t.get("status"), "request_id": t.get("request_id"),
                         "settlement_id": t.get("settlement_id"), "note": t.get("note"),
                         "created_at": t.get("created_at")})
        return rows
    if report_type == "operations":
        rows = []
        async for c in db.cancellations.find().sort("created_at", -1).limit(1000):
            rows.append({"id": c["_id"], "party": c.get("party"), "kind": c.get("kind"),
                         "request_id": c.get("request_id"), "worker_id": c.get("worker_id"),
                         "business_id": c.get("business_id"), "reason": c.get("reason"),
                         "created_at": c.get("created_at")})
        return rows
    if report_type == "support":
        rows = []
        async for t in db.tickets.find().sort("created_at", -1).limit(1000):
            rows.append({"id": t["_id"], "subject": t.get("subject"), "category": t.get("category"),
                         "status": t.get("status"), "priority": t.get("priority"),
                         "escalation": t.get("escalation"), "user_id": t.get("user_id"),
                         "request_id": t.get("request_id"), "replies": len(t.get("replies", [])),
                         "created_at": t.get("created_at")})
        return rows
    if report_type == "staff":
        rows = []
        async for u in db.users.find({"role": {"$in": ["staff", "admin"]}}):
            sp = u.get("staff_profile") or {}
            acts = await db.audit_logs.count_documents({"actor_id": u["_id"]})
            rows.append({"id": u["_id"], "name": u.get("name"), "phone": u.get("phone"),
                         "email": u.get("email"), "role": u.get("role"),
                         "staff_role": sp.get("staff_role"), "permissions": ",".join(sp.get("permissions", [])),
                         "status": u.get("status"), "created_at": u.get("created_at"),
                         "last_login": u.get("last_login"), "audit_actions": acts})
        return rows
    if report_type == "offices":
        rows = []
        async for u in db.users.find({"role": "office"}):
            op = u.get("office_profile") or {}
            drivers = await db.users.count_documents(
                {"role": "worker", "worker_profile.provider_id": u["_id"],
                 "worker_profile.provider_status": "linked"})
            sts = await db.settlements.find({"office_id": u["_id"]}).to_list(500)
            rows.append({"id": u["_id"], "name": u.get("name"),
                         "office_name": op.get("office_name"), "cr_number": op.get("cr_number"),
                         "phone": u.get("phone"), "city": u.get("city"),
                         "registered": u.get("created_at"), "status": u.get("status"),
                         "verification": op.get("verification_status"),
                         "drivers": drivers,
                         "settlements_count": len(sts),
                         "receivables_pending": round(sum(x["net"] for x in sts if x["status"] in ("pending_review", "under_review", "approved")), 2),
                         "paid_total": round(sum(x["net"] for x in sts if x["status"] == "paid"), 2)})
        return rows
    if report_type == "agreements":
        rows = []
        async for a in db.agreements.find().sort("created_at", -1).limit(1000):
            o = await db.users.find_one({"_id": a["office_id"]}, {"name": 1, "office_profile": 1})
            rows.append({"id": a["_id"], "office": ((o or {}).get("office_profile") or {}).get("office_name") or (o or {}).get("name"),
                         "version": a.get("version"), "status": a.get("status"),
                         "effective_date": a.get("effective_date"), "expiry_date": a.get("expiry_date"),
                         "accepted_at": a.get("accepted_at"),
                         "accepted_by": (a.get("accepted_by") or {}).get("name"),
                         "created_at": a.get("created_at")})
        return rows
    raise HTTPException(status_code=400, detail="نوع تقرير غير صالح")


@router.get("/{report_type}")
async def get_report(report_type: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                     city: Optional[str] = None, status: Optional[str] = None,
                     type: Optional[str] = None, user: dict = p_reports):
    rows = await _report_rows(report_type, {"date_from": date_from, "date_to": date_to,
                                            "city": city, "status": status, "type": type})
    return {"report": report_type, "count": len(rows), "rows": rows}


@router.get("/{report_type}/export")
async def export_report(report_type: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                        city: Optional[str] = None, status: Optional[str] = None,
                        type: Optional[str] = None, user: dict = p_export):
    rows = await _report_rows(report_type, {"date_from": date_from, "date_to": date_to,
                                            "city": city, "status": status, "type": type})
    await audit(user, "report_exported", "report", report_type,
                note=f"{len(rows)} rows, filters: from={date_from} to={date_to} city={city}")
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={report_type}_{date.today()}.csv"})


@router.get("/alerts/list")
async def operational_alerts(user: dict = p_reports):
    settings = await get_settings()
    alerts = []
    today = date.today().isoformat()
    grace = settings.get("alert_no_checkin_grace_min", 30)
    unfilled_h = settings.get("urgent_unfilled_hours", 24)

    # confirmed but not checked in, start time passed
    async for o in db.offers.find({"status": "confirmed"}):
        r = await db.requests.find_one({"_id": o["request_id"]})
        if r and r["start_date"] <= today:
            alerts.append({"type": "no_checkin", "severity": "high",
                           "request_id": r["_id"], "title": r["title"],
                           "detail": f"مندوب مؤكد ولم يسجل حضوره — {r['start_date']} {r['start_time']}"})
    # published/filling requests starting soon without enough drivers
    threshold = (date.today() + timedelta(days=1)).isoformat()
    async for r in db.requests.find({"status": {"$in": ["published", "filling"]},
                                     "start_date": {"$lte": threshold}}):
        acc = await db.offers.count_documents({"request_id": r["_id"],
                                               "status": {"$in": ["accepted", "confirmed", "attended", "paid"]}})
        if acc < r["required_count"]:
            alerts.append({"type": "unfilled", "severity": "urgent",
                           "request_id": r["_id"], "title": r["title"],
                           "detail": f"طلب يبدأ قريباً وناقص مندوبين ({acc}/{r['required_count']})"})
    # no-shows today
    ns = await db.offers.count_documents({"status": "no_show", "responded_at": {"$gte": today}})
    if ns:
        alerts.append({"type": "no_shows", "severity": "high", "detail": f"{ns} حالة تغيب اليوم"})
    # pending settlements
    pend = await db.settlements.count_documents({"status": {"$in": ["pending_review", "under_review"]}})
    if pend:
        alerts.append({"type": "pending_settlements", "severity": "medium",
                       "detail": f"{pend} تصفية بانتظار مراجعة/اعتماد المحاسب"})
    # expiring documents
    soon = (date.today() + timedelta(days=30)).isoformat()
    expiring = await db.driver_documents.count_documents(
        {"status": "verified", "expiry_date": {"$gte": today, "$lte": soon}})
    if expiring:
        alerts.append({"type": "docs_expiring", "severity": "medium",
                       "detail": f"{expiring} مستند مندوب تنتهي صلاحيته خلال 30 يوماً"})
    # open disputes (shipment disputes)
    disputes = await db.offers.count_documents({"loading_disputed": True, "status": {"$nin": ["paid", "cancelled"]}})
    if disputes:
        alerts.append({"type": "disputes", "severity": "high",
                       "detail": f"{disputes} نزاع على عدد الشحنات يحتاج مراجعة"})
    return {"alerts": alerts}
