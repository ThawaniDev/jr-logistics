import { env } from "@/lib/env";

export interface Stop { id: string; lat: number; lng: number; label?: string }
export interface RouteResult {
  provider: "google_routes" | "local_heuristic";
  warning?: string;
  order: string[];
  legs: Array<{ from: string; to: string; distanceM: number; durationS: number }>;
  totalDistanceM: number; totalDurationS: number;
  note: string;
}

const R = 6371000;
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const t = (d: number) => (d * Math.PI) / 180;
  const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Nearest-neighbour ordering — a heuristic, clearly labelled; never claimed optimal. */
export function heuristicRoute(origin: { lat: number; lng: number }, stops: Stop[]): RouteResult {
  const left = [...stops]; const order: Stop[] = []; let cur = origin;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => { const d = haversine(cur, s); if (d < bd) { bd = d; bi = i; } });
    const [n] = left.splice(bi, 1); order.push(n); cur = n;
  }
  const legs: RouteResult["legs"] = []; let prev: { lat: number; lng: number; id: string } = { ...origin, id: "origin" };
  for (const s of order) { const d = haversine(prev, s) * 1.3; legs.push({ from: prev.id, to: s.id, distanceM: Math.round(d), durationS: Math.round(d / 9.7) }); prev = s; } // ~35 km/h urban estimate
  return {
    provider: "local_heuristic", order: order.map((s) => s.id), legs,
    totalDistanceM: legs.reduce((a, l) => a + l.distanceM, 0), totalDurationS: legs.reduce((a, l) => a + l.durationS, 0),
    note: "Estimated order using straight-line distances. Not traffic-aware.",
  };
}

/** Google Routes API waypoint optimisation for ≤25 stops; falls back to the heuristic with a visible warning. */
export async function optimizeRoute(origin: { lat: number; lng: number }, stops: Stop[], fetcher: typeof fetch = fetch): Promise<RouteResult> {
  if (stops.length === 0) return { provider: "local_heuristic", order: [], legs: [], totalDistanceM: 0, totalDurationS: 0, note: "No stops" };
  if (stops.length === 1 || !env.googleKey) {
    const h = heuristicRoute(origin, stops);
    return env.googleKey || stops.length === 1 ? h : { ...h, warning: "ROUTING_PROVIDER_NOT_CONFIGURED" };
  }
  if (stops.length > 26) throw Object.assign(new Error("Too many stops"), { code: "VALIDATION" });
  // Destination = the stop farthest from origin; the rest are optimised intermediates.
  const far = stops.reduce((a, s) => (haversine(origin, s) > haversine(origin, a) ? s : a));
  const mids = stops.filter((s) => s.id !== far.id);
  const wp = (s: { lat: number; lng: number }) => ({ location: { latLng: { latitude: s.lat, longitude: s.lng } } });
  try {
    const res = await fetcher("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "x-goog-api-key": env.googleKey, "x-goog-fieldmask": "routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration,routes.distanceMeters,routes.duration" },
      body: JSON.stringify({ origin: wp(origin), destination: wp(far), intermediates: mids.map(wp), travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", optimizeWaypointOrder: true }),
    });
    if (!res.ok) throw new Error(`Google Routes HTTP ${res.status}`);
    const data = await res.json() as { routes?: Array<{ optimizedIntermediateWaypointIndex?: number[]; legs?: Array<{ distanceMeters?: number; duration?: string }> }> };
    const route = data.routes?.[0];
    if (!route) throw new Error("No route returned");
    const idx = route.optimizedIntermediateWaypointIndex ?? mids.map((_, i) => i);
    const ordered = [...idx.map((i) => mids[i]), far];
    const ids = ["origin", ...ordered.map((s) => s.id)];
    const legs = (route.legs ?? []).map((l, i) => ({ from: ids[i], to: ids[i + 1], distanceM: l.distanceMeters ?? 0, durationS: parseInt(l.duration ?? "0", 10) || 0 }));
    return {
      provider: "google_routes", order: ordered.map((s) => s.id), legs, totalDistanceM: legs.reduce((a, l) => a + l.distanceM, 0), totalDurationS: legs.reduce((a, l) => a + l.durationS, 0),
      note: "Suggested order from Google Routes for the stops provided. Review before starting navigation.",
    };
  } catch (e) {
    return { ...heuristicRoute(origin, stops), warning: `ROUTING_PROVIDER_FAILED: ${e instanceof Error ? e.message : "error"}` };
  }
}

// ── WhatsApp hand-off (external app; we never send, track delivery, or read replies) ──
export type WaKind = "contact" | "arriving" | "issue";
const TEMPLATES: Record<string, Record<WaKind, string>> = {
  ar: {
    contact: "السلام عليكم {name}، أنا مندوب التوصيل من JR Logistics بخصوص طلبكم رقم {ref}. هل يمكننا التواصل؟",
    arriving: "السلام عليكم {name}، أنا في الطريق إليكم الآن بخصوص طلبكم رقم {ref}.",
    issue: "السلام عليكم {name}، واجهت مشكلة في توصيل طلبكم رقم {ref}. أرجو الرد لتنسيق التسليم.",
  },
  en: {
    contact: "Hello {name}, I'm your JR Logistics delivery driver regarding order {ref}. Can we coordinate?",
    arriving: "Hello {name}, I'm on my way to you now for order {ref}.",
    issue: "Hello {name}, I had a problem delivering order {ref}. Please reply so we can arrange the handover.",
  },
  ur: {
    contact: "السلام علیکم {name}، میں JR Logistics کا ڈیلیوری ڈرائیور ہوں، آپ کے آرڈر {ref} کے بارے میں۔ کیا ہم رابطہ کر سکتے ہیں؟",
    arriving: "السلام علیکم {name}، میں آپ کے آرڈر {ref} کے لیے ابھی راستے میں ہوں۔",
    issue: "السلام علیکم {name}، آپ کے آرڈر {ref} کی ڈیلیوری میں مسئلہ پیش آیا۔ براہ کرم جواب دیں۔",
  },
};
export function whatsappLink(lang: string, kind: WaKind, vars: { name: string; ref: string; phone: string }) {
  const tpl = (TEMPLATES[lang] ?? TEMPLATES.ar)[kind];
  const text = tpl.replace("{name}", vars.name || "").replace("{ref}", vars.ref);
  const digits = vars.phone.replace(/\D/g, "");
  return { text, url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}` };
}
