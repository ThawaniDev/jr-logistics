import os
from utils import new_id, now_iso, add_txn, notify
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
                          "industry": "خدمات لوجستية", "rating": 4.6, "rating_count": 12}},
    {"_id": "u_b2", "phone": "+966500000102", "name": "م. ريم الحربي", "email": "hr@jeddah-wh-demo.sa",
     "role": "business", "city": "جدة", "status": "active", "is_demo": True,
     "business_profile": {"company_name": "مستودعات جدة المركزية", "cr_number": "4030222333",
                          "industry": "تخزين ومستودعات", "rating": 4.2, "rating_count": 8}},
    {"_id": "u_b3", "phone": "+966500000103", "name": "أ. ليان الدوسري", "email": "events@afaq-demo.sa",
     "role": "business", "city": "الرياض", "status": "active", "is_demo": True,
     "business_profile": {"company_name": "مؤسسة آفاق لتنظيم الفعاليات", "cr_number": "1010777888",
                          "industry": "فعاليات ومؤتمرات", "rating": None, "rating_count": 0}},
]

WORKERS = [
    {"_id": "u_w1", "phone": "+966500000201", "name": "محمد العتيبي", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "services": ["delivery_driver"], "availability": "available",
     "rating": 4.8, "rating_count": 21, "jobs_completed": 21},
    {"_id": "u_w2", "phone": "+966500000202", "name": "خالد الشمري", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "services": ["warehouse_worker", "loading_unloading"],
     "availability": "available", "rating": 4.9, "rating_count": 15, "jobs_completed": 15,
     "bank_name": "مصرف الراجحي", "iban": "SA44 8000 0000 6080 1016 7519"},
    {"_id": "u_w3", "phone": "+966500000203", "name": "عبدالله القحطاني", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "services": ["sorting_packing", "inventory_counting"],
     "availability": "available", "rating": 4.5, "rating_count": 9, "jobs_completed": 9},
    {"_id": "u_w4", "phone": "+966500000204", "name": "سعد الدوسري", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "services": ["car_with_driver", "car_without_driver"],
     "availability": "available", "rating": 4.7, "rating_count": 13, "jobs_completed": 13},
    {"_id": "u_w5", "phone": "+966500000205", "name": "فهد المطيري", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "services": ["events_staff"],
     "availability": "available", "rating": 4.4, "rating_count": 7, "jobs_completed": 7},
    {"_id": "u_w6", "phone": "+966500000206", "name": "ياسر الحربي", "role": "worker", "city": "جدة",
     "status": "active", "is_demo": True, "services": ["warehouse_worker"],
     "availability": "available", "rating": 4.1, "rating_count": 5, "jobs_completed": 5},
    {"_id": "u_w7", "phone": "+966500000207", "name": "تركي الغامدي", "role": "worker", "city": "جدة",
     "status": "active", "is_demo": True, "services": ["delivery_driver"],
     "availability": "unavailable", "rating": 4.3, "rating_count": 11, "jobs_completed": 11},
    {"_id": "u_w8", "phone": "+966500000208", "name": "ناصر العنزي", "role": "worker", "city": "الرياض",
     "status": "active", "is_demo": True, "services": ["loading_unloading", "warehouse_worker"],
     "availability": "available", "rating": 4.6, "rating_count": 10, "jobs_completed": 10},
]

REQUESTS = [
    {"_id": "req_1", "business_id": "u_b1", "service_type": "delivery_driver",
     "title": "مندوبو توصيل — حملة نهاية الأسبوع", "city": "الرياض",
     "address": "حي العليا، طريق الملك فهد", "required_count": 3,
     "start_date": "2026-06-13", "start_time": "08:00", "duration_type": "one_day", "duration_days": 1,
     "rate": 7, "shipment_count": 150, "vehicle_type": None,
     "requirements": "يفضل سائقون بخبرة في تطبيقات التوصيل وجوالات حديثة",
     "estimated_total": 1050, "commission": 105, "payout_total": 945,
     "status": "published", "replacement_count": 0, "is_demo": True},
    {"_id": "req_2", "business_id": "u_b1", "service_type": "warehouse_worker",
     "title": "عمال مستودع — وردية صباحية", "city": "الرياض",
     "address": "المدينة الصناعية الثانية، مستودع رقم 14", "required_count": 2,
     "start_date": "2026-06-08", "start_time": "07:00", "duration_type": "several_days", "duration_days": 3,
     "rate": 250, "shipment_count": None, "vehicle_type": None,
     "requirements": "القدرة على حمل أوزان تصل إلى 25 كجم",
     "estimated_total": 1500, "commission": 150, "payout_total": 1350,
     "status": "in_progress", "replacement_count": 0, "is_demo": True},
    {"_id": "req_3", "business_id": "u_b2", "service_type": "loading_unloading",
     "title": "تحميل وتنزيل حاويات — ميناء جدة", "city": "جدة",
     "address": "ميناء جدة الإسلامي، بوابة 5", "required_count": 2,
     "start_date": "2026-06-02", "start_time": "06:00", "duration_type": "one_day", "duration_days": 1,
     "rate": 200, "shipment_count": None, "vehicle_type": None,
     "requirements": "خبرة سابقة في مناولة الحاويات",
     "estimated_total": 400, "commission": 40, "payout_total": 360,
     "status": "completed", "replacement_count": 0, "is_demo": True},
    {"_id": "req_4", "business_id": "u_b3", "service_type": "events_staff",
     "title": "طاقم تنظيم — معرض الرياض التقني", "city": "الرياض",
     "address": "واجهة الرياض، القاعة الكبرى", "required_count": 6,
     "start_date": "2026-06-18", "start_time": "15:00", "duration_type": "one_day", "duration_days": 1,
     "rate": 180, "shipment_count": None, "vehicle_type": None,
     "requirements": "مظهر لائق وخبرة في استقبال الزوار",
     "estimated_total": 1080, "commission": 108, "payout_total": 972,
     "status": "published", "replacement_count": 0, "is_demo": True},
    {"_id": "req_5", "business_id": "u_b2", "service_type": "sorting_packing",
     "title": "فرز وتغليف شحنات التجارة الإلكترونية", "city": "جدة",
     "address": "حي الخمرة، مستودع التجزئة", "required_count": 4,
     "start_date": "2026-06-14", "start_time": "09:00", "duration_type": "several_days", "duration_days": 2,
     "rate": 220, "shipment_count": None, "vehicle_type": None,
     "requirements": "دقة وسرعة في الفرز",
     "estimated_total": 1760, "commission": 176, "payout_total": 1584,
     "status": "published", "replacement_count": 0, "is_demo": True},
    {"_id": "req_6", "business_id": "u_b3", "service_type": "car_with_driver",
     "title": "سيارات مع سائقين — نقل كبار الزوار", "city": "الرياض",
     "address": "فندق الريتز كارلتون", "required_count": 2,
     "start_date": "2026-06-18", "start_time": "13:00", "duration_type": "one_day", "duration_days": 1,
     "rate": 350, "shipment_count": None, "vehicle_type": "سيدان حديثة (كامري أو ما يعادلها)",
     "requirements": "سائقون بلباس رسمي وخبرة في بروتوكول كبار الزوار",
     "estimated_total": 700, "commission": 70, "payout_total": 630,
     "status": "published", "replacement_count": 0, "is_demo": True},
]

OFFERS = [
    {"_id": "off_1", "request_id": "req_1", "worker_id": "u_w1", "business_id": "u_b1",
     "status": "offered", "is_replacement": False, "earning": 0},
    {"_id": "off_2", "request_id": "req_2", "worker_id": "u_w2", "business_id": "u_b1",
     "status": "attendance_confirmed", "is_replacement": False, "earning": 0},
    {"_id": "off_3", "request_id": "req_2", "worker_id": "u_w8", "business_id": "u_b1",
     "status": "confirmed", "is_replacement": False, "earning": 0},
    {"_id": "off_4", "request_id": "req_3", "worker_id": "u_w2", "business_id": "u_b2",
     "status": "paid", "is_replacement": False, "earning": 180},
    {"_id": "off_5", "request_id": "req_3", "worker_id": "u_w8", "business_id": "u_b2",
     "status": "paid", "is_replacement": False, "earning": 180},
    {"_id": "off_6", "request_id": "req_4", "worker_id": "u_w5", "business_id": "u_b3",
     "status": "offered", "is_replacement": False, "earning": 0},
    {"_id": "off_7", "request_id": "req_5", "worker_id": "u_w3", "business_id": "u_b2",
     "status": "offered", "is_replacement": False, "earning": 0},
    {"_id": "off_8", "request_id": "req_6", "worker_id": "u_w4", "business_id": "u_b3",
     "status": "offered", "is_replacement": False, "earning": 0},
]

WALLETS = [
    {"_id": "wal_b1", "user_id": "u_b1", "available": 18500, "reserved": 1500, "currency": "SAR"},
    {"_id": "wal_b2", "user_id": "u_b2", "available": 4600, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_b3", "user_id": "u_b3", "available": 8000, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w1", "user_id": "u_w1", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w2", "user_id": "u_w2", "available": 180, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w3", "user_id": "u_w3", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w4", "user_id": "u_w4", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w5", "user_id": "u_w5", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w6", "user_id": "u_w6", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w7", "user_id": "u_w7", "available": 0, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_w8", "user_id": "u_w8", "available": 180, "reserved": 0, "currency": "SAR"},
    {"_id": "wal_admin", "user_id": "u_admin", "available": 0, "reserved": 0, "currency": "SAR"},
]

TRANSACTIONS = [
    {"user_id": "u_b1", "type": "topup", "amount": 20000, "direction": "credit", "note": "شحن محفظة (أموال تجريبية)"},
    {"user_id": "u_b1", "type": "reserve", "amount": 1500, "direction": "debit",
     "note": "حجز تكلفة الطلب: عمال مستودع — وردية صباحية", "request_id": "req_2"},
    {"user_id": "u_b2", "type": "topup", "amount": 5000, "direction": "credit", "note": "شحن محفظة (أموال تجريبية)"},
    {"user_id": "u_b2", "type": "release", "amount": 400, "direction": "debit",
     "note": "تسوية طلب مكتمل: تحميل وتنزيل حاويات — ميناء جدة", "request_id": "req_3"},
    {"user_id": "u_w2", "type": "earning", "amount": 180, "direction": "credit",
     "note": "أرباح مهمة: تحميل وتنزيل حاويات — ميناء جدة (بعد عمولة المنصة 20 ر.س)", "request_id": "req_3"},
    {"user_id": "u_w8", "type": "earning", "amount": 180, "direction": "credit",
     "note": "أرباح مهمة: تحميل وتنزيل حاويات — ميناء جدة (بعد عمولة المنصة 20 ر.س)", "request_id": "req_3"},
    {"user_id": "platform", "type": "commission", "amount": 20, "direction": "credit",
     "note": "عمولة المنصة — طلب: تحميل وتنزيل حاويات — ميناء جدة", "request_id": "req_3"},
    {"user_id": "platform", "type": "commission", "amount": 20, "direction": "credit",
     "note": "عمولة المنصة — طلب: تحميل وتنزيل حاويات — ميناء جدة", "request_id": "req_3"},
    {"user_id": "u_b3", "type": "topup", "amount": 8000, "direction": "credit", "note": "شحن محفظة (أموال تجريبية)"},
]

WITHDRAWALS = [
    {"_id": "wd_1", "worker_id": "u_w2", "amount": 150, "bank_name": "مصرف الراجحي",
     "iban": "SA44 8000 0000 6080 1016 7519", "status": "pending", "is_demo": True},
]

RATINGS = [
    {"_id": "rat_1", "request_id": "req_3", "offer_id": "off_4", "from_user": "u_b2", "to_user": "u_w2",
     "score": 5, "comment": "التزام ممتاز وسرعة في الإنجاز"},
    {"_id": "rat_2", "request_id": "req_3", "offer_id": "off_5", "from_user": "u_b2", "to_user": "u_w8",
     "score": 4, "comment": "عمل جيد"},
]

TICKETS = [
    {"_id": "tkt_1", "user_id": "u_b1", "subject": "استفسار عن آلية حجز المبالغ",
     "category": "wallet", "message": "متى يتم تحرير المبلغ المحجوز إذا تغيّب عامل؟",
     "status": "in_review", "is_demo": True,
     "replies": [{"from_admin": True, "author": "مدير المنصة",
                  "message": "يتم إرجاع حصة العامل المتغيب لمحفظتك تلقائياً عند إنهاء الطلب.", "at": "2026-06-09T10:00:00+00:00"}]},
    {"_id": "tkt_2", "user_id": "u_w1", "subject": "مشكلة في تطبيق الجوال",
     "category": "technical", "message": "لا يظهر زر تأكيد الحضور في صفحة مهامي.",
     "status": "open", "is_demo": True, "replies": []},
]

NOTIFICATIONS = [
    {"user_id": "u_w1", "title": "فرصة عمل جديدة: سائقو التوصيل والمندوبون",
     "body": "طلب جديد في الرياض — راجع التفاصيل الكاملة قبل القبول", "type": "offer",
     "link": "/app/worker/opportunities", "read": False},
    {"user_id": "u_w5", "title": "فرصة عمل جديدة: طاقم فعاليات ومؤتمرات",
     "body": "طلب جديد في الرياض — راجع التفاصيل الكاملة قبل القبول", "type": "offer",
     "link": "/app/worker/opportunities", "read": False},
    {"user_id": "u_w3", "title": "فرصة عمل جديدة: عمال فرز وتغليف",
     "body": "طلب جديد في جدة — راجع التفاصيل الكاملة قبل القبول", "type": "offer",
     "link": "/app/worker/opportunities", "read": False},
    {"user_id": "u_w4", "title": "فرصة عمل جديدة: سيارات مع سائق",
     "body": "طلب جديد في الرياض — راجع التفاصيل الكاملة قبل القبول", "type": "offer",
     "link": "/app/worker/opportunities", "read": False},
    {"user_id": "u_b1", "title": "عامل سجّل حضوره",
     "body": "خالد الشمري سجّل حضوره لطلب: عمال مستودع — وردية صباحية — أكّد الحضور من لوحتك",
     "type": "attendance", "link": "/app/business/requests/req_2", "read": False},
    {"user_id": "u_w2", "title": "تم تأكيدك للمهمة",
     "body": "تم تأكيدك في طلب: عمال مستودع — وردية صباحية — الرياض بتاريخ 2026-06-08",
     "type": "confirmed", "link": "/app/worker/jobs", "read": True},
    {"user_id": "u_w2", "title": "تم إيداع أرباحك",
     "body": "تم إيداع 180 ر.س في محفظتك عن مهمة: تحميل وتنزيل حاويات — ميناء جدة",
     "type": "earning", "link": "/app/worker/wallet", "read": True},
    {"user_id": "u_admin", "title": "طلب سحب جديد",
     "body": "خالد الشمري طلب سحب 150 ر.س", "type": "withdrawal",
     "link": "/app/admin/withdrawals", "read": False},
]


async def seed_admin():
    existing = await db.users.find_one({"_id": ADMIN["_id"]})
    if not existing:
        doc = {**ADMIN, "created_at": now_iso()}
        await db.users.insert_one(doc)


async def seed_demo():
    if await db.settings.find_one({"key": "seed_v1"}):
        return
    for b in BUSINESSES:
        await db.users.insert_one({**b, "created_at": now_iso()})
    for w in WORKERS:
        doc = {k: v for k, v in w.items() if k not in ("services", "availability", "rating", "rating_count",
                                                        "jobs_completed", "bank_name", "iban")}
        doc["worker_profile"] = {
            "services": w["services"], "availability": w["availability"],
            "rating": w.get("rating"), "rating_count": w.get("rating_count", 0),
            "jobs_completed": w.get("jobs_completed", 0),
            "bank_name": w.get("bank_name"), "iban": w.get("iban"),
            "national_id": None,
        }
        doc["email"] = None
        doc["created_at"] = now_iso()
        await db.users.insert_one(doc)
    for r in REQUESTS:
        await db.requests.insert_one({**r, "created_at": now_iso()})
    for o in OFFERS:
        await db.offers.insert_one({**o, "created_at": now_iso(), "responded_at": now_iso()})
    for w in WALLETS:
        await db.wallets.insert_one(w)
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
    await db.settings.insert_one({"key": "seed_v1", "at": now_iso()})


async def seed_all():
    await seed_admin()
    await seed_demo()
