COMMISSION_RATE = 0.10

# Platform defaults — the LIVE values live in db.settings ("platform") and are
# editable from the Admin Dashboard without code changes. These are fallbacks.
DEFAULT_RATE = 8
DEFAULT_COMMISSION_RATE = 0.0  # platform commission removed — admin sets selling price & provider cost per business
DEFAULT_VEHICLE_TYPES = ["sedan", "dokker", "hiace", "van", "dyna"]
DEFAULT_SERVICE_AREAS = ["الرياض", "جدة", "الدمام", "الخبر", "مكة المكرمة",
                         "المدينة المنورة", "نيوم", "تبوك", "أبها", "بريدة"]

# Staff role presets (Super Admin = role "admin" with all permissions)
STAFF_ROLE_PRESETS = {
    "support": ["stats", "tickets", "tickets_view", "tickets_manage", "users_view", "requests_view",
                "attendance_view", "complaints"],
    "operations": ["stats", "requests", "requests_view", "requests_edit", "requests_assign",
                   "drivers", "drivers_view", "documents", "attendance", "attendance_view",
                   "attendance_edit", "replacements", "replacement_manage", "cases", "tickets",
                   "tickets_view", "users_view", "live_location_view", "complaints"],
    "operations_supervisor": ["stats", "requests", "requests_view", "requests_edit", "requests_assign",
                              "drivers", "drivers_view", "drivers_sensitive_view", "documents",
                              "attendance", "attendance_view", "attendance_edit", "replacements",
                              "replacement_manage", "cases", "tickets", "tickets_view",
                              "tickets_manage", "users_view", "live_location_view", "reports_view"],
    "finance": ["stats", "wallets", "wallets_view", "withdrawals", "transactions", "reports",
                "reports_view", "requests_view", "finance_view", "settlements_view",
                "settlement_review", "commission_view", "refunds_manage"],
    "hr": ["users_view", "users_edit", "drivers_view", "drivers_sensitive_view", "staff_view",
           "documents", "stats"],
    "account_manager": ["users_view", "users_edit", "requests_view", "tickets_view",
                        "pricing_view", "reports_view", "stats"],
    "reports": ["reports_view", "reports_export", "stats", "audit_view"],
    "platform_manager": ["stats"],
    "supervisor": ["stats", "requests", "requests_view", "drivers", "documents", "attendance",
                   "replacements", "cases", "tickets", "users", "users_view",
                   "withdrawals", "transactions", "reports", "ratings", "audit",
                   "live_location_view", "audit_view"],
}

ALL_PERMISSIONS = [
    "users_view", "users_edit", "drivers_view", "drivers_sensitive_view",
    "requests_view", "requests_edit", "requests_assign",
    "attendance_view", "attendance_edit", "replacement_manage", "live_location_view",
    "tickets_view", "tickets_manage",
    "finance_view", "wallets_view", "wallet_adjust", "payments_manage",
    "settlements_view", "settlement_review", "settlement_approve", "payout_execute",
    "commission_view", "commission_edit", "pricing_view", "pricing_edit", "refunds_manage",
    "reports_view", "reports_export",
    "staff_view", "staff_create", "staff_edit", "staff_suspend",
    "roles_manage", "permissions_manage",
    "offices_view", "offices_manage", "verification_manage",
    "settings_view", "settings_edit", "audit_view", "complaints",
    # legacy coarse keys kept for backward compatibility
    "stats", "users", "requests", "drivers", "documents", "attendance", "replacements",
    "cases", "tickets", "wallets", "withdrawals", "transactions", "reports",
    "ratings", "audit", "staff", "settings", "broadcast",
]

DOC_TYPES = [
    {"key": "national_id", "name": "الهوية / الإقامة", "required": True},
    {"key": "driving_license", "name": "رخصة القيادة", "required": True},
    {"key": "vehicle_registration", "name": "استمارة المركبة", "required": True},
    {"key": "vehicle_photo", "name": "صورة المركبة", "required": False},
]

OFFICE_DOC_TYPES = [
    {"key": "office_cr", "name": "السجل التجاري", "required": True},
    {"key": "office_license", "name": "الترخيص / التصريح", "required": True},
    {"key": "iban_certificate", "name": "شهادة الآيبان", "required": False},
    {"key": "other", "name": "مستند آخر", "required": False},
]

TICKET_CATEGORIES = {
    "business": ["driver_no_show", "driver_refused", "shipment_count", "location_issue",
                 "payment_issue", "replacement_request", "urgent", "other"],
    "worker": ["business_not_ready", "not_put_to_work", "shipment_count_differs",
               "location_issue", "task_issue", "attendance_issue", "payment_issue",
               "cancellation", "other"],
    "office": ["driver_assignment", "driver_availability", "settlement_issue",
               "payment_issue", "agreement", "documents", "operations", "urgent", "other"],
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
        "driverless": True,
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

# Active scope: delivery drivers + vehicle services (with/without driver).
# Other categories stay in the catalog and can be enabled by adding their keys here.
ENABLED_SERVICES = ["delivery_driver", "car_with_driver", "car_without_driver"]

ACTIVE_SERVICES = [s for s in SERVICES if s["key"] in ENABLED_SERVICES]
