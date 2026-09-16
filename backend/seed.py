from utils import new_id, now_iso
from db import db

ADMIN = {
    "_id": "u_admin",
    "phone": "+966500000001",
    "email": "emadabuharb1993@gmail.com",
    "name": "مدير المنصة",
    "role": "admin",
    "city": "الرياض",
    "status": "active",
    "is_demo": False,
}

BUSINESSES = [
    {"_id": "u_b1", "phone": "+966500000101", "name": "م. سعود العتيبي", "email": "ops@imdad-demo.sa",
     "role": "business", "city": "الرياض", "status": "active", "is_demo": True,
     "business_profile": {"company_name": "شركة الإمداد السريع للخدمات اللوجستية", "cr_number": "1010555666",
                          "industry": "تجارة إلكترونية", "rating": 4.6, "rating_count": 12}},
    {"_id": "u_b2", "phone": "+966500000102", "name": "م. ريم الحربي", "email": "ops@jeddah-retail-demo.sa",
     "role": "business", "city": "جدة", "status": "active", "is_demo": True,
     "business_profile": {"company_name": "متاجر جدة للتجزئة", "cr_number": "4030222333",
                          "industry": "تجزئة", "rating": 4.2, "rating_count": 8}},
    {"_id": "u_b3", "phone": "+966500000103", "name": "أ. ليان الدوسري", "email": "events@afaq-demo.sa",
     "role": "business", "city": "الرياض", "status": "active", "is_demo": True,
     "business_profile": {"company_name": "مؤسسة آفاق لتنظيم الفعاليات", "cr_number": "1010777888",
                          "industry": "فعاليات ومؤتمرات", "rating": None, "rating_count": 0}},
]

WORKERS = [
    {"_id": "u_w1", "phone": "+966500000201", "name": "محمد العتيبي", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "vehicle_type": "دراجة نارية",
     "rating": 4.8, "rating_count": 21, "jobs_completed": 21},
    {"_id": "u_w2", "phone": "+966500000202", "name": "خالد الشمري", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "vehicle_type": "سيارة",
     "rating": 4.9, "rating_count": 15, "jobs_completed": 15},
    {"_id": "u_w3", "phone": "+966500000203", "name": "عبدالله القحطاني", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "vehicle_type": "دراجة نارية",
     "rating": 4.5, "rating_count": 9, "jobs_completed": 9},
    {"_id": "u_w4", "phone": "+966500000204", "name": "سعد الدوسري", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "vehicle_type": "سيارة",
     "rating": 4.7, "rating_count": 13, "jobs_completed": 13},
    {"_id": "u_w5", "phone": "+966500000205", "name": "فهد المطيري", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "vehicle_type": "فان صغير",
     "rating": 4.4, "rating_count": 7, "jobs_completed": 7},
    {"_id": "u_w6", "phone": "+966500000206", "name": "ياسر الحربي", "role": "worker", "city": "جدة",
     "status": "active", "is_demo": True, "vehicle_type": "سيارة",
     "rating": 4.1, "rating_count": 5, "jobs_completed": 5},
    {"_id": "u_w7", "phone": "+966500000207", "name": "تركي الغامدي", "role": "worker", "city": "جدة",
     "status": "active", "is_demo": True, "vehicle_type": "دراجة نارية", "availability": "unavailable",
     "rating": 4.3, "rating_count": 11, "jobs_completed": 11},
    {"_id": "u_w8", "phone": "+966500000208", "name": "ناصر العنزي", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "vehicle_type": "سيارة",
     "rating": 4.6, "rating_count": 10, "jobs_completed": 10,
     "bank_name": "مصرف الراجحي", "iban": "SA44 8000 0000 6080 1016 7519"},
]

REQUESTS = [
    {"_id": "req_1", "business_id": "u_b1", "service_type": "delivery_driver",
     "title": "مندوبو توصيل — حملة نهاية الأسبوع", "city": "الرياض",
     "address": "حي العليا والنرجس والياسمين", "required_count": 3,
     "start_date": "2026-06-13", "start_time": "08:00", "duration_type": "one_day", "duration_days": 1,
     "rate": 7, "shipments_per_driver": 50, "shipment_count": 150,
     "vehicle_type": "دراجة نارية أو سيارة",
     "requirements": "يفضل مندوبون بخبرة في تطبيقات التوصيل وجوالات حديثة",
     "estimated_total": 1050, "commission": 105, "payout_total": 945,
     "status": "published", "replacement_count": 0, "is_demo": True},
    {"_id": "req_d1", "business_id": "u_b1", "service_type": "delivery_driver",
     "title": "توصيل طلبات المتجر الإلكتروني — وردية صباحية", "city": "الرياض",
     "address": "حي السليمانية ومحيطها", "required_count": 2,
     "start_date": "2026-06-10", "start_time": "09:00", "duration_type": "one_day", "duration_days": 1,
     "rate": 7, "shipments_per_driver": 40, "shipment_count": 80,
     "vehicle_type": "دراجة نارية",
     "requirements": "الالتزام بمواعيد التسليم للعملاء",
     "estimated_total": 560, "commission": 56, "payout_total": 504,
     "status": "completed", "replacement_count": 0, "is_demo": True},
    {"_id": "req_d2", "business_id": "u_b1", "service_type": "delivery_driver",
     "title": "مندوبان — تغطية منطقة العليا والنخيل", "city": "الرياض",
     "address": "حي العليا والنخيل", "required_count": 2,
     "start_date": "2026-06-16", "start_time": "08:30", "duration_type": "one_day", "duration_days": 1,
     "rate": 8, "shipments_per_driver": 35, "shipment_count": 70,
     "vehicle_type": "سيارة",
     "requirements": "شحنات تحتاج عناية (مواد غذائية)",
     "estimated_total": 560, "commission": 56, "payout_total": 504,
     "status": "in_progress", "replacement_count": 0, "is_demo": True},
    {"_id": "req_d3", "business_id": "u_b3", "service_type": "delivery_driver",
     "title": "توصيل مواد وهدايا معرض الرياض التقني", "city": "الرياض",
     "address": "واجهة الرياض — توزيع على أحياء الشمال", "required_count": 2,
     "start_date": "2026-06-18", "start_time": "13:00", "duration_type": "one_day", "duration_days": 1,
     "rate": 9, "shipments_per_driver": 25, "shipment_count": 50,
     "vehicle_type": "سيارة أو فان",
     "requirements": "مظهر لائق والتزام ببروتوكول الفعالية",
     "estimated_total": 450, "commission": 45, "payout_total": 405,
     "status": "published", "replacement_count": 0, "is_demo": True},
]

OFFERS = [
    {"_id": "off_1", "request_id": "req_1", "worker_id": "u_w1", "business_id": "u_b1",
     "status": "offered", "is_replacement": False, "earning": 0},
    {"_id": "off_d1a", "request_id": "req_d1", "worker_id": "u_w1", "business_id": "u_b1",
     "status": "paid", "is_replacement": False, "earning": 252},
    {"_id": "off_d1b", "request_id": "req_d1", "worker_id": "u_w3", "business_id": "u_b1",
     "status": "paid", "is_replacement": False, "earning": 252},
    {"_id": "off_d2a", "request_id": "req_d2", "worker_id": "u_w4", "business_id": "u_b1",
     "status": "confirmed", "is_replacement": False, "earning": 0},
    {"_id": "off_d2b", "request_id": "req_d2", "worker_id": "u_w5", "business_id": "u_b1",
     "status": "attendance_confirmed", "is_replacement": False, "earning": 0},
    {"_id": "off_d3a", "request_id": "req_d3", "worker_id": "u_w8", "business_id": "u_b3",
     "status": "offered", "is_replacement": False, "earning": 0},
]

WALLETS = [
    {"_id": "wal_b1", "user_id": "u_b1", "available": 18880, "reserved": 560, "currency": "SAR"},
    {"_id": "wal_b2", "user_id": "u_b2", "available": 5000, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_b3", "user_id": "u_b3", "available": 8000, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w1", "user_id": "u_w1", "available": 252, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w2", "user_id": "u_w2", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w3", "user_id": "u_w3", "available": 252, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w4", "user_id": "u_w4", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w5", "user_id": "u_w5", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w6", "user_id": "u_w6", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w7", "user_id": "u_w7", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w8", "user_id": "u_w8", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_admin", "user_id": "u_admin", "available": 0, "reserved": 0, "currency": "SAR"},
]

TRANSACTIONS = [
    {"user_id": "u_b1", "type": "topup", "amount": 20000, "direction": "credit", "note": "شحن محفظة (أموال تجريبية)"},
    {"user_id": "u_b1", "type": "release", "amount": 560, "direction": "debit",
     "note": "تسوية طلب مكتمل: توصيل طلبات المتجر الإلكتروني — وردية صباحية", "request_id": "req_d1"},
    {"user_id": "u_w1", "type": "earning", "amount": 252, "direction": "credit",
     "note": "أرباح مهمة: توصيل طلبات المتجر الإلكتروني (بعد عمولة المنصة 28 ر.س)", "request_id": "req_d1"},
    {"user_id": "u_w3", "type": "earning", "amount": 252, "direction": "credit",
     "note": "أرباح مهمة: توصيل طلبات المتجر الإلكتروني (بعد عمولة المنصة 28 ر.س)", "request_id": "req_d1"},
    {"user_id": "platform", "type": "commission", "amount": 28, "direction": "credit",
     "note": "عمولة المنصة — طلب: توصيل طلبات المتجر الإلكتروني", "request_id": "req_d1"},
    {"user_id": "platform", "type": "commission", "amount": 28, "direction": "credit",
     "note": "عمولة المنصة — طلب: توصيل طلبات المتجر الإلكتروني", "request_id": "req_d1"},
    {"user_id": "u_b1", "type": "reserve", "amount": 560, "direction": "debit",
     "note": "حجز تكلفة الطلب: مندوبان — تغطية منطقة العليا والنخيل", "request_id": "req_d2"},
    {"user_id": "u_b2", "type": "topup", "amount": 5000, "direction": "credit", "note": "شحن محفظة (أموال تجريبية)"},
    {"user_id": "u_b3", "type": "topup", "amount": 8000, "direction": "credit", "note": "شحن محفظة (أموال تجريبية)"},
]

WITHDRAWALS = [
    {"_id": "wd_1", "worker_id": "u_w1", "amount": 200, "bank_name": "مصرف الراجحي",
     "iban": "SA44 8000 0000 6080 1016 7519", "status": "pending", "is_demo": True},
]

RATINGS = [
    {"_id": "rat_1", "request_id": "req_d1", "offer_id": "off_d1a", "from_user": "u_b1", "to_user": "u_w1",
     "score": 5, "comment": "مندوب ممتاز وملتزم بالمواعيد", "is_demo": True},
    {"_id": "rat_2", "request_id": "req_d1", "offer_id": "off_d1b", "from_user": "u_b1", "to_user": "u_w3",
     "score": 4, "comment": "أداء جيد", "is_demo": True},
]

TICKETS = [
    {"_id": "tkt_1", "user_id": "u_b1", "subject": "استفسار عن آلية حجز المبالغ",
     "category": "wallet", "message": "متى يتم تحرير المبلغ المحجوز إذا تغيّب مندوب؟",
     "status": "in_review", "is_demo": True,
     "replies": [{"from_admin": True, "author": "مدير المنصة",
                  "message": "تُرجع حصة المندوب المتغيب لمحفظتك تلقائياً عند إنهاء الطلب.", "at": "2026-06-09T10:00:00+00:00"}]},
    {"_id": "tkt_2", "user_id": "u_w1", "subject": "مشكلة في تطبيق الجوال",
     "category": "technical", "message": "لا يظهر زر تأكيد الحضور في صفحة مهامي.",
     "status": "open", "is_demo": True, "replies": []},
]

NOTIFICATIONS = [
    {"user_id": "u_w1", "title": "فرصة عمل جديدة: سائقو التوصيل والمندوبون",
     "body": "طلب جديد في الرياض — راجع التفاصيل الكاملة قبل القبول", "type": "offer",
     "link": "/app/worker/opportunities", "read": False},
    {"user_id": "u_w8", "title": "فرصة عمل جديدة: توصيل مواد فعالية",
     "body": "طلب جديد في الرياض — راجع التفاصيل الكاملة قبل القبول", "type": "offer",
     "link": "/app/worker/opportunities", "read": False},
    {"user_id": "u_w5", "title": "تم تأكيدك للمهمة",
     "body": "تم تأكيدك في طلب: مندوبان — تغطية منطقة العليا والنخيل بتاريخ 2026-06-16",
     "type": "confirmed", "link": "/app/worker/jobs", "read": True},
    {"user_id": "u_b1", "title": "مندوب سجّل حضوره",
     "body": "فهد المطيري سجّل حضوره لطلب: مندوبان — تغطية منطقة العليا والنخيل — أكّد الحضور من لوحتك",
     "type": "attendance", "link": "/app/business/requests/req_d2", "read": False},
    {"user_id": "u_w1", "title": "تم إيداع أرباحك",
     "body": "تم إيداع 252 ر.س في محفظتك عن مهمة: توصيل طلبات المتجر الإلكتروني",
     "type": "earning", "link": "/app/worker/wallet", "read": True},
    {"user_id": "u_admin", "title": "طلب سحب جديد",
     "body": "محمد العتيبي طلب سحب 200 ر.س", "type": "withdrawal",
     "link": "/app/admin/withdrawals", "read": False},
]


async def seed_admin():
    existing = await db.users.find_one({"_id": ADMIN["_id"]})
    if not existing:
        await db.users.insert_one({**ADMIN, "created_at": now_iso()})


def worker_doc(w):
    doc = {k: v for k, v in w.items() if k not in ("rating", "rating_count", "jobs_completed",
                                                    "bank_name", "iban", "vehicle_type", "availability")}
    doc["worker_profile"] = {
        "services": ["delivery_driver"],
        "availability": w.get("availability", "available"),
        "vehicle_type": w.get("vehicle_type"),
        "rating": w.get("rating"), "rating_count": w.get("rating_count", 0),
        "jobs_completed": w.get("jobs_completed", 0),
        "bank_name": w.get("bank_name"), "iban": w.get("iban"),
        "national_id": None,
    }
    doc["email"] = None
    doc["created_at"] = now_iso()
    return doc


async def seed_all():
    await seed_admin()
    if not await db.settings.find_one({"key": "seed_v2"}):
        fresh = not await db.settings.find_one({"key": "seed_v1"})

        if fresh:
            for b in BUSINESSES:
                await db.users.insert_one({**b, "created_at": now_iso()})
            for w in WORKERS:
                await db.users.insert_one(worker_doc(w))
            for w in WALLETS:
                await db.wallets.insert_one(w)
        else:
            # Migrate v1 (multi-service demo) -> v2 (delivery-only MVP)
            old = await db.requests.find({"service_type": {"$ne": "delivery_driver"}}, {"_id": 1}).to_list(100)
            old_ids = [r["_id"] for r in old]
            if old_ids:
                await db.requests.delete_many({"_id": {"$in": old_ids}})
                await db.offers.delete_many({"request_id": {"$in": old_ids}})
            await db.users.update_many(
                {"role": "worker", "is_demo": True},
                {"$set": {"worker_profile.services": ["delivery_driver"]}})
            for w in WALLETS:
                await db.wallets.replace_one({"user_id": w["user_id"]}, w, upsert=True)

        await db.transactions.delete_many({"is_demo": True})
        await db.notifications.delete_many({})
        await db.withdrawals.delete_many({})
        await db.tickets.delete_many({})
        await db.ratings.delete_many({})

        for r in REQUESTS:
            await db.requests.replace_one({"_id": r["_id"]}, {**r, "created_at": now_iso()}, upsert=True)
        for o in OFFERS:
            await db.offers.replace_one({"_id": o["_id"]},
                                        {**o, "created_at": now_iso(), "responded_at": now_iso()}, upsert=True)
        for t in TRANSACTIONS:
            doc = {"_id": new_id(), "status": "completed", "is_demo": True, "created_at": now_iso(),
                   "request_id": t.get("request_id"), **{k: v for k, v in t.items() if k != "request_id"}}
            await db.transactions.insert_one(doc)
        for w in WITHDRAWALS:
            await db.withdrawals.insert_one({**w, "created_at": now_iso()})
        for r in RATINGS:
            await db.ratings.insert_one({**r, "created_at": now_iso()})
        for t in TICKETS:
            await db.tickets.insert_one({**t, "created_at": now_iso()})
        for n in NOTIFICATIONS:
            await db.notifications.insert_one({**n, "_id": new_id(), "created_at": now_iso()})

        await db.settings.update_one({"key": "seed_v2"}, {"$set": {"key": "seed_v2", "at": now_iso()}}, upsert=True)

    if not await db.settings.find_one({"key": "seed_v3"}):
        # backfill vehicle_type for demo drivers (migration path added after v2)
        for w in WORKERS:
            await db.users.update_one({"_id": w["_id"]},
                                      {"$set": {"worker_profile.vehicle_type": w.get("vehicle_type")}})
        await db.settings.update_one({"key": "seed_v3"}, {"$set": {"key": "seed_v3", "at": now_iso()}}, upsert=True)

    if not await db.settings.find_one({"key": "seed_v4"}):
        # platform pricing settings (admin-editable) + normalize vehicles to Sedan/Van
        await db.settings.update_one(
            {"key": "platform"},
            {"$setOnInsert": {"key": "platform", "default_rate": 8, "commission_rate": 0.10,
                              "vehicle_types": ["سيدان", "فان"],
                              "service_areas": ["الرياض", "جدة", "الدمام", "الخبر", "مكة المكرمة",
                                                 "المدينة المنورة", "نيوم", "تبوك", "أبها", "بريدة"]}},
            upsert=True)
        for rid, v in [("req_1", "سيدان"), ("req_d1", "سيدان"), ("req_d2", "فان"), ("req_d3", "فان")]:
            await db.requests.update_one({"_id": rid}, {"$set": {"vehicle_type": v}})
        for i, w in enumerate(WORKERS):
            await db.users.update_one({"_id": w["_id"]},
                                      {"$set": {"worker_profile.vehicle_type": "سيدان" if i % 2 == 0 else "فان"}})
        await db.settings.update_one({"key": "seed_v4"}, {"$set": {"key": "seed_v4", "at": now_iso()}}, upsert=True)

    if not await db.settings.find_one({"key": "seed_v5"}):
        # staff accounts with role presets
        staff = [
            {"_id": "u_s1", "phone": "+966500000301", "name": "أمل الزهراني", "staff_role": "support"},
            {"_id": "u_s2", "phone": "+966500000302", "name": "بدر العنزي", "staff_role": "operations"},
            {"_id": "u_s3", "phone": "+966500000303", "name": "سارة القحطاني", "staff_role": "finance"},
        ]
        from catalog import STAFF_ROLE_PRESETS
        for s in staff:
            if not await db.users.find_one({"_id": s["_id"]}):
                await db.users.insert_one({
                    "_id": s["_id"], "phone": s["phone"], "email": None, "name": s["name"],
                    "role": "staff", "status": "active", "city": "الرياض", "is_demo": True,
                    "staff_profile": {"staff_role": s["staff_role"],
                                      "permissions": STAFF_ROLE_PRESETS[s["staff_role"]]},
                    "created_at": now_iso(),
                })
        # verified documents for all demo drivers
        from datetime import date, timedelta
        expiry = (date.today() + timedelta(days=365)).isoformat()
        for w in WORKERS:
            for dtype in ("national_id", "driving_license", "vehicle_registration"):
                if not await db.driver_documents.find_one({"worker_id": w["_id"], "type": dtype, "status": "verified"}):
                    await db.driver_documents.insert_one({
                        "_id": new_id(), "worker_id": w["_id"], "type": dtype,
                        "file_path": None, "original_filename": f"demo-{dtype}.pdf",
                        "content_type": "application/pdf", "size": 0,
                        "expiry_date": expiry, "status": "verified",
                        "reviewed_by": "u_admin", "uploaded_at": now_iso(), "is_demo": True,
                    })
            await db.users.update_one({"_id": w["_id"]},
                                      {"$set": {"worker_profile.verification_status": "verified"}})
        # compensation policy default
        s = await db.settings.find_one({"key": "platform"})
        if s and "no_work_compensation_pct" not in s:
            await db.settings.update_one({"key": "platform"},
                                         {"$set": {"no_work_compensation_pct": 100}})
        await db.settings.update_one({"key": "seed_v5"}, {"$set": {"key": "seed_v5", "at": now_iso()}}, upsert=True)
