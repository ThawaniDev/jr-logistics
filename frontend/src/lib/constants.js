import {
  Bike, Warehouse, PackageOpen, PackageCheck, ClipboardList,
  CarFront, Car, Users, Boxes,
} from "lucide-react";

export const SERVICES = [
  { key: "delivery_driver", name: "مندوب توصيل موثوق", short: "مندوب توصيل", icon: Bike, unit: "shipment", unit_label: "لكل شحنة", desc: "مندوبو توصيل موثوقون بمركباتهم لتوصيل الشحنات داخل المدينة", has_shipments: true, needs_vehicle: true, ref_rate: 8 },
  { key: "warehouse_worker", name: "عمال مستودعات", short: "عمال مستودعات", icon: Warehouse, unit: "worker_day", unit_label: "للعامل / اليوم", desc: "عمالة تشغيلية لدعم عمليات المستودعات اليومية", has_shipments: false, needs_vehicle: false, ref_rate: 250 },
  { key: "loading_unloading", name: "عمال تحميل وتنزيل", short: "تحميل وتنزيل", icon: PackageOpen, unit: "worker_day", unit_label: "للعامل / اليوم", desc: "طواقم تحميل وتنزيل للشاحنات والحاويات", has_shipments: false, needs_vehicle: false, ref_rate: 220 },
  { key: "sorting_packing", name: "عمال فرز وتغليف", short: "فرز وتغليف", icon: PackageCheck, unit: "worker_day", unit_label: "للعامل / اليوم", desc: "فرز الشحنات وتغليفها وتجهيزها للشحن", has_shipments: false, needs_vehicle: false, ref_rate: 230 },
  { key: "inventory_counting", name: "عمال جرد المخزون", short: "جرد المخزون", icon: ClipboardList, unit: "worker_day", unit_label: "للعامل / اليوم", desc: "طواقم جرد دورية وسنوية للمخزون والأصول", has_shipments: false, needs_vehicle: false, ref_rate: 260 },
  { key: "car_with_driver", name: "سيارات مع سائق", short: "سيارة مع سائق", icon: CarFront, unit: "vehicle_day", unit_label: "للسيارة / اليوم", desc: "سيارات وسائقون لمهام النقل والتوصيل التشغيلي", has_shipments: false, needs_vehicle: true, ref_rate: 350 },
  { key: "car_without_driver", name: "سيارات بدون سائق", short: "سيارة بدون سائق", icon: Car, unit: "vehicle_day", unit_label: "للسيارة / اليوم", desc: "تأجير سيارات تشغيلية لفريق عملك", has_shipments: false, needs_vehicle: true, driverless: true, ref_rate: 200 },
  { key: "events_staff", name: "طاقم فعاليات ومؤتمرات", short: "طاقم فعاليات", icon: Users, unit: "worker_day", unit_label: "للفرد / اليوم", desc: "كوادر مؤقتة للفعاليات والمعارض والمؤتمرات", has_shipments: false, needs_vehicle: false, ref_rate: 180 },
  { key: "other_service", name: "خدمات لوجستية وتشغيلية أخرى", short: "خدمة أخرى", icon: Boxes, unit: "worker_day", unit_label: "للوحدة / اليوم", desc: "أي احتياج تشغيلي أو لوجستي مؤقت آخر", has_shipments: false, needs_vehicle: false, ref_rate: 200 },
];

export const SERVICE_MAP = Object.fromEntries(SERVICES.map((s) => [s.key, s]));

// Active scope: delivery drivers + vehicle services (with / without driver).
export const ENABLED_SERVICE_KEYS = ["delivery_driver", "car_with_driver", "car_without_driver"];
export const ACTIVE_SERVICES = SERVICES.filter((s) => ENABLED_SERVICE_KEYS.includes(s.key));
export const COMING_SOON_SERVICES = SERVICES.filter((s) => !ENABLED_SERVICE_KEYS.includes(s.key));

export const DURATIONS = [
  { key: "one_day", label: "يوم واحد", days: 1 },
  { key: "several_days", label: "عدة أيام", days: null },
  { key: "week", label: "أسبوع", days: 7 },
  { key: "month", label: "شهر", days: 30 },
];

export const CITIES = ["الرياض", "جدة", "الدمام", "الخبر", "مكة المكرمة", "المدينة المنورة", "نيوم", "تبوك", "أبها", "بريدة"];

export const REQUEST_STATUS = {
  draft: { label: "مسودة", cls: "bg-slate-700/40 text-slate-400 border-slate-600/40" },
  published: { label: "منشور — بانتظار القبول", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  filling: { label: "قيد التعبئة", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  confirmed: { label: "مؤكد — مبلغ محجوز", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  in_progress: { label: "قيد التنفيذ", cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" },
  completed: { label: "مكتمل", cls: "bg-green-500/10 text-green-300 border-green-500/30" },
  cancelled: { label: "ملغي", cls: "bg-slate-700/40 text-slate-400 border-slate-600/40" },
};

export const OFFER_STATUS = {
  offered: { label: "عرض جديد", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  accepted: { label: "مقبول — بانتظار التأكيد", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  confirmed: { label: "مؤكد", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  attendance_confirmed: { label: "سجّل حضوره", cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" },
  attended: { label: "حاضر", cls: "bg-green-500/10 text-green-300 border-green-500/30" },
  driver_completed: { label: "أنهى المهمة — بانتظار تأكيد المنشأة", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  delivered_reported: { label: "بانتظار تأكيد المستودع", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  pending_settlement: { label: "بانتظار التسوية", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  qty_disputed: { label: "قيد المراجعة — يوجد اختلاف", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
  paid: { label: "مدفوع", cls: "bg-green-500/10 text-green-300 border-green-500/30" },
  no_show: { label: "لم يحضر", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
  rejected: { label: "مرفوض", cls: "bg-slate-700/40 text-slate-400 border-slate-600/40" },
  cancelled: { label: "ملغي", cls: "bg-slate-700/40 text-slate-400 border-slate-600/40" },
};

export const fmtDate = (iso) => {
  if (!iso) return "";
  const parts = String(iso).slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(iso);
};

export const TXN_LABELS = {
  topup: "شحن محفظة",
  reserve: "حجز تكلفة طلب",
  release: "تسوية طلب",
  refund: "استرداد",
  earning: "أرباح مهمة",
  commission: "عمولة المنصة",
  withdrawal: "سحب رصيد",
};

export const WITHDRAWAL_STATUS = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  approved: { label: "تم التحويل", cls: "bg-green-500/10 text-green-300 border-green-500/30" },
  rejected: { label: "مرفوض", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
};

export const TICKET_STATUS = {
  open: { label: "مفتوحة", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  in_review: { label: "قيد المراجعة", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  resolved: { label: "تم الحل", cls: "bg-green-500/10 text-green-300 border-green-500/30" },
};

export const sar = (n) => `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.س`;

export const DEFAULT_VEHICLE_TYPES = ["sedan", "dokker", "hiace", "van", "dyna"];
export const TEMP_TYPES = ["dry", "cold"];

export const roleHome = (role) =>
  role === "admin" || role === "staff" ? "/app/admin"
    : role === "worker" ? "/app/worker"
    : role === "office" ? "/app/office"
    : "/app/business";

export const ROLE_LABELS = { business: "منشأة", worker: "سائق / مندوب", office: "مكتب توصيل", admin: "مدير المنصة" };
