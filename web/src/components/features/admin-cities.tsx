"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Input, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/provider";

export interface CityRow { key: string; ar: string; en: string; ur: string; lat: number; lng: number; pickup: boolean; delivery: boolean }

/** Problems that would make the server reject the list (checked client-side so the Save button can say why). */
export function cityProblems(cities: CityRow[]): string[] {
  const out: string[] = [];
  if (cities.length === 0) out.push("adm.cities_none");
  const keys = cities.map((c) => c.key.trim());
  if (keys.some((k) => !/^[a-z][a-z0-9_]{1,30}$/.test(k))) out.push("adm.cities_bad_key");
  if (new Set(keys).size !== keys.length) out.push("adm.cities_dup_key");
  if (cities.some((c) => !c.ar.trim() || !c.en.trim() || !c.ur.trim())) out.push("adm.cities_names");
  if (cities.some((c) => !Number.isFinite(c.lat) || !Number.isFinite(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180)) out.push("adm.cities_coords");
  if (cities.length && !cities.some((c) => c.pickup)) out.push("adm.cities_no_pickup");
  if (cities.length && !cities.some((c) => c.delivery)) out.push("adm.cities_no_delivery");
  return out;
}

export function CitiesEditor({ value, onChange, disabled }: { value: CityRow[]; onChange: (v: CityRow[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<CityRow>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const problems = cityProblems(value);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("adm.cities_hint")}</p>
      {problems.length > 0 && <Notice tone="warn"><ul className="list-disc ps-5">{problems.map((p) => <li key={p}>{t(p)}</li>)}</ul></Notice>}
      <div className="space-y-3">
        {value.map((c, i) => (
          <fieldset key={i} className="space-y-3 rounded-xl border border-line p-3" disabled={disabled}>
            <legend className="px-1 text-xs text-muted"><span className="ltr-num">{c.key || t("adm.city_new")}</span></legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input label={t("adm.city_key")} ltr value={c.key} onChange={(e) => set(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
              <Input label={t("adm.city_name_ar")} dir="rtl" value={c.ar} onChange={(e) => set(i, { ar: e.target.value })} />
              <Input label={t("adm.city_name_en")} dir="ltr" value={c.en} onChange={(e) => set(i, { en: e.target.value })} />
              <Input label={t("adm.city_name_ur")} dir="rtl" value={c.ur} onChange={(e) => set(i, { ur: e.target.value })} />
              <Input label={t("adm.city_lat")} type="number" step="0.0001" min={-90} max={90} ltr value={Number.isFinite(c.lat) ? c.lat : ""} onChange={(e) => set(i, { lat: e.target.value === "" ? NaN : Number(e.target.value) })} />
              <Input label={t("adm.city_lng")} type="number" step="0.0001" min={-180} max={180} ltr value={Number.isFinite(c.lng) ? c.lng : ""} onChange={(e) => set(i, { lng: e.target.value === "" ? NaN : Number(e.target.value) })} />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 self-end pb-2 lg:col-span-2">
                <Checkbox checked={c.pickup} onChange={(e) => set(i, { pickup: e.target.checked })} label={t("adm.city_pickup")} />
                <Checkbox checked={c.delivery} onChange={(e) => set(i, { delivery: e.target.checked })} label={t("adm.city_delivery")} />
                {!disabled && <Button type="button" size="sm" variant="ghost" className="ms-auto" aria-label={t("adm.city_remove")} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>}
              </div>
            </div>
          </fieldset>))}
      </div>
      {!disabled && <Button type="button" variant="secondary" onClick={() => onChange([...value, { key: "", ar: "", en: "", ur: "", lat: 24.7136, lng: 46.6753, pickup: false, delivery: true }])}><Plus className="size-4" />{t("adm.city_add")}</Button>}
    </div>
  );
}
