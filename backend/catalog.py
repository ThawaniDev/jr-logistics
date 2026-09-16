COMMISSION_RATE = 0.10

# Platform defaults — the LIVE values live in db.settings ("platform") and are
# editable from the Admin Dashboard without code changes. These are fallbacks.
DEFAULT_RATE = 8
DEFAULT_COMMISSION_RATE = 0.10
DEFAULT_VEHICLE_TYPES = ["سيدان", "فان"]
DEFAULT_SERVICE_AREAS = ["الرياض", "جدة", "الدمام", "الخبر", "مكة المكرمة",
                         "المدينة المنورة", "نيوم", "تبوك", "أبها", "بريدة"]

# Staff role presets (Super Admin = role "admin" with all permissions)
STAFF_ROLE_PRESETS = {
    "support": ["stats", "tickets", "users_view", "requests_view"],
    "operations": ["stats", "requests", "requests_view", "drivers", "documents", "attendance",
                   "replacements", "cases", "tickets", "users_view"],
    "finance": ["stats", "wallets", "withdrawals", "transactions", "reports", "requests_view"],
    "supervisor": ["stats", "requests", "requests_view", "drivers", "documents", "attendance",
                   "replacements", "cases", "tickets", "users", "users_view",
                   "withdrawals", "transactions", "reports", "ratings", "audit"],
}

DOC_TYPES = [
    {"key": "national_id", "name": "الهوية / الإقامة", "required": True},
    {"key": "driving_license", "name": "رخصة القيادة", "required": True},
    {"key": "vehicle_registration", "name": "استمارة المركبة", "required": True},
    {"key": "vehicle_photo", "name": "صورة المركبة", "required": False},
]

TICKET_CATEGORIES = {
    "business": ["driver_no_show", "driver_refused", "shipment_count", "location_issue",
                 "payment_issue", "replacement_request", "urgent", "other"],
    "worker": ["business_not_ready", "not_put_to_work", "shipment_count_differs",
               "location_issue", "task_issue", "attendance_issue", "payment_issue",
               "cancellation", "other"],
}

DURATION_DAYS = {"one_day": 1, "week": 7, "month": 30}

SERVICES = [
    {
        "key": "delivery_driver",
        "name": "مندوب توصيل موثوق",
        "short": "مندوب توصيل",
        "icon": "Bike",
        "unit": "shipment",
        "unit_label": "لكل شحنة",
        "desc": "مندوبو توصيل بمركباتهم لتوصيل الشحنات داخل المدينة",
        "has_shipments": True,
        "needs_vehicle": True,
        "ref_rate": 7,
    },
    {
        "key": "warehouse_worker",
        "name": "عمال مستودعات",
        "short": "عمال مستودعات",
        "icon": "Warehouse",
        "unit": "worker_day",
        "unit_label": "للعامل / اليوم",
        "desc": "عمالة تشغيلية لدعم عمليات المستودعات اليومية",
        "has_shipments": False,
        "needs_vehicle": False,
        "ref_rate": 250,
    },
    {
        "key": "loading_unloading",
        "name": "عمال تحميل وتنزيل",
        "short": "تحميل وتنزيل",
        "icon": "PackageOpen",
        "unit": "worker_day",
        "unit_label": "للعامل / اليوم",
        "desc": "طواقم تحميل وتنزيل للشاحنات والحاويات",
        "has_shipments": False,
        "needs_vehicle": False,
        "ref_rate": 220,
    },
    {
        "key": "sorting_packing",
        "name": "عمال فرز وتغليف",
        "short": "فرز وتغليف",
        "icon": "PackageCheck",
        "unit": "worker_day",
        "unit_label": "للعامل / اليوم",
        "desc": "فرز الشحنات وتغليفها وتجهيزها للشحن",
        "has_shipments": False,
        "needs_vehicle": False,
        "ref_rate": 230,
    },
    {
        "key": "inventory_counting",
        "name": "عمال جرد المخزون",
        "short": "جرد المخزون",
        "icon": "ClipboardList",
        "unit": "worker_day",
        "unit_label": "للعامل / اليوم",
        "desc": "طواقم جرد دورية وسنوية للمخزون والأصول",
        "has_shipments": False,
        "needs_vehicle": False,
        "ref_rate": 260,
    },
    {
        "key": "car_with_driver",
        "name": "سيارات مع سائق",
        "short": "سيارة مع سائق",
        "icon": "CarFront",
        "unit": "vehicle_day",
        "unit_label": "للسيارة / اليوم",
        "desc": "سيارات وسائقون لمهام النقل والتوصيل التشغيلي",
        "has_shipments": False,
        "needs_vehicle": True,
        "ref_rate": 350,
    },
    {
        "key": "car_without_driver",
        "name": "سيارات بدون سائق",
        "short": "سيارة بدون سائق",
        "icon": "Car",
        "unit": "vehicle_day",
        "unit_label": "للسيارة / اليوم",
        "desc": "تأجير سيارات تشغيلية لفريق عملك",
        "has_shipments": False,
        "needs_vehicle": True,
        "ref_rate": 200,
    },
    {
        "key": "events_staff",
        "name": "طاقم فعاليات ومؤتمرات",
        "short": "طاقم فعاليات",
        "icon": "Users",
        "unit": "worker_day",
        "unit_label": "للفرد / اليوم",
        "desc": "كوادر مؤقتة للفعاليات والمعارض والمؤتمرات",
        "has_shipments": False,
        "needs_vehicle": False,
        "ref_rate": 180,
    },
    {
        "key": "other_service",
        "name": "خدمات لوجستية وتشغيلية أخرى",
        "short": "خدمة أخرى",
        "icon": "Boxes",
        "unit": "worker_day",
        "unit_label": "للوحدة / اليوم",
        "desc": "أي احتياج تشغيلي أو لوجستي مؤقت آخر",
        "has_shipments": False,
        "needs_vehicle": False,
        "ref_rate": 200,
    },
]

SERVICE_MAP = {s["key"]: s for s in SERVICES}

# MVP scope: only delivery drivers are visible/active. Other categories stay in
# the catalog and can be enabled by adding their keys here — no schema changes.
ENABLED_SERVICES = ["delivery_driver"]

ACTIVE_SERVICES = [s for s in SERVICES if s["key"] in ENABLED_SERVICES]
