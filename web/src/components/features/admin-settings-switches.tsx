"use client";
import { useId, type ReactNode } from "react";
import { Boxes, CheckCircle2, CircleOff, Route as RouteIcon, Zap } from "lucide-react";
import { Badge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { settingValue } from "./admin-fieldops-lib";
import { useSettings } from "./admin-system-settings";

/** A real switch (a native checkbox, so keyboard, screen readers and Playwright `check()` all work). The thumb flips in RTL. */
function Toggle({ testId, labelledBy, checked, disabled, onChange }: { testId: string; labelledBy: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <input type="checkbox" role="switch" data-testid={testId} aria-labelledby={labelledBy} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
      className={cn("relative h-8 w-14 shrink-0 cursor-pointer appearance-none rounded-full border border-line bg-bg2 transition-colors", "disabled:cursor-not-allowed disabled:opacity-60",
        "before:absolute before:start-1 before:top-1 before:size-6 before:rounded-full before:bg-muted before:transition-transform before:content-['']",
        "checked:border-accent checked:bg-accent/25 checked:before:translate-x-6 checked:before:bg-accent rtl:checked:before:-translate-x-6")} />
  );
}

function Bullets({ title, items, active, icon }: { title: string; items: string[]; active: boolean; icon: ReactNode }) {
  return (
    <div className={cn("rounded-xl border p-3.5 transition", active ? "border-accent/50 bg-accent/5" : "border-line bg-bg2/50")}>
      <p className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", active ? "text-accent" : "text-muted")}>{icon}{title}</p>
      <ul className="space-y-1.5 text-sm text-ink/90">
        {items.map((x) => <li key={x} className="flex gap-2"><span className={cn("mt-2 size-1.5 shrink-0 rounded-full", active ? "bg-accent" : "bg-muted/60")} aria-hidden />{x}</li>)}
      </ul>
    </div>
  );
}

interface CardProps { id: "routingEnabled" | "b2bShipmentsEnabled"; testId: string; icon: ReactNode; prefix: "rt" | "b2"; offCount: number; onCount: number }

/** One platform switch: the title and the toggle on top, then what changes when it is off / on, who is affected, and when it applies. */
function SwitchCard({ id, testId, icon, prefix, offCount, onCount }: CardProps) {
  const { t } = useI18n(); const c = useSettings(); const uid = useId();
  const on = !!settingValue(c.data, c.edits, id);
  const list = (kind: "off" | "on", n: number) => Array.from({ length: n }, (_, i) => t(`jf2.${prefix}_${kind}_${i + 1}`));
  return (
    <section data-testid={`${testId}-card`} aria-labelledby={`${uid}-t`} className="space-y-4 rounded-card border border-line bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bg2 text-accent" aria-hidden>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${uid}-t`} className="text-lg font-bold">{t(`jf2.${prefix}_title`)}</h3>
            <Badge tone={on ? "success" : "neutral"}><span data-testid={`${testId}-state`} data-on={on ? "1" : "0"}>{t(on ? "jf2.sw_on" : "jf2.sw_off")}</span></Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{t(`jf2.${prefix}_lead`)}</p>
        </div>
        <Toggle testId={testId} labelledBy={`${uid}-t`} checked={on} disabled={!c.canEdit} onChange={(v) => c.set(id, v)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Bullets title={t("jf2.sw_when_off")} items={list("off", offCount)} active={!on} icon={<CircleOff className="size-3.5" aria-hidden />} />
        <Bullets title={t("jf2.sw_when_on")} items={list("on", onCount)} active={on} icon={<CheckCircle2 className="size-3.5" aria-hidden />} />
      </div>
      <div className="space-y-1 border-t border-line pt-3 text-sm">
        <p><span className="font-semibold">{t("jf2.sw_who")}: </span><span className="text-muted">{t(`jf2.${prefix}_who`)}</span></p>
        {prefix === "rt" && <p className="text-xs text-muted">{t("jf2.rt_note")}</p>}
        <p className="flex items-center gap-1.5 text-xs font-medium text-cyan"><Zap className="size-3.5" aria-hidden />{t("jf2.sw_immediate")}</p>
      </div>
    </section>
  );
}

/** The two platform-wide switches shown at the top of Settings › Field operations (update J2 / J3). Saved with the page's Save bar like every other setting. */
export function PlatformSwitches() {
  const { t } = useI18n(); const c = useSettings();
  return (
    <section aria-label={t("jf2.set_ops_title")} data-testid="jf2-switches" className="space-y-3">
      <div><h2 className="text-lg font-bold">{t("jf2.set_ops_title")}</h2><p className="text-sm text-muted">{t("jf2.set_ops_sub")}{!c.canEdit && ` ${t("jf2.set_ops_readonly")}`}</p></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SwitchCard id="routingEnabled" testId="set-routing-enabled" icon={<RouteIcon className="size-5" />} prefix="rt" offCount={4} onCount={4} />
        <SwitchCard id="b2bShipmentsEnabled" testId="set-b2b-enabled" icon={<Boxes className="size-5" />} prefix="b2" offCount={3} onCount={2} />
      </div>
    </section>
  );
}
