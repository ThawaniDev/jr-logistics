"use client";
import { useState, type ReactNode } from "react";
import { Clock, Copy, Lock, MapPin, MessageCircle, Navigation, Package, Phone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { addressText, cardDate, codOf, paymentModeOf, piecesOf, statusChip, telHref, type ShipAccess } from "./driver-shipments-lib";
import { mapsUrl, openWhatsApp, type Stop } from "./driver-stops-shared";

/** One labelled line of the card ("Name: Mona Ali"). */
function Line({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <div className="flex min-w-0 gap-1.5" data-testid={testId}><dt className="shrink-0 text-muted">{label}:</dt><dd className="min-w-0 flex-1 font-medium text-ink">{children}</dd></div>;
}

const roundBtn = "relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-95";
const squareBtn = "relative z-10 flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-bg2 text-muted transition hover:border-accent/60 hover:text-ink active:scale-95";

/**
 * One shipment of the run sheet: package + round Call / WhatsApp buttons on the left; the code (accent underline), the status chip, name, address,
 * cash to collect, payment mode, pieces and the date on the right. The whole card opens the shipment (the code is the real button, stretched over
 * the card); the call / WhatsApp / copy / maps buttons sit above it. Finished cards are dimmed, locked ones (routing on) say so.
 */
export function ShipCard({ stop, access, routing, offerId, onOpen }: { stop: Stop; access: ShipAccess; routing: boolean; offerId: string; onOpen: (id: string) => void }) {
  const { t, locale } = useI18n();
  const [wa, setWa] = useState(false);
  const chip = statusChip(stop); const cod = codOf(stop); const pay = paymentModeOf(stop); const pieces = piecesOf(stop); const date = cardDate(stop);
  const tel = telHref(stop.recipientPhone); const done = access === "done"; const locked = access === "locked"; const current = stop.current === true && !done;
  const city = stop.city ? t(`city.${stop.city}`) : null;
  const cash = stop.status === "delivered" ? (stop.codCollectedCents ?? 0) : cod; // a delivered parcel shows what was collected

  const copy = () => navigator.clipboard.writeText(addressText(stop, city)).then(() => toast.success(t("jf2.address_copied")), () => toast.error(t("ubz.copy_failed")));
  const whatsapp = async () => { if (wa) return; setWa(true); try { await openWhatsApp(offerId, stop.id, "contact", locale, t); } finally { setWa(false); } };
  const noContact = t(routing && locked ? "jf2.phone_locked" : "jf2.no_phone");

  return (
    <li data-testid="ship-card" data-code={stop.code} data-status={stop.status} data-access={access} data-current={current ? "1" : "0"} data-payment={pay}
      className={cn("relative flex gap-3 rounded-card border bg-card p-3.5 transition sm:p-4", current ? "border-accent/70 ring-1 ring-accent/30" : "border-line", access === "act" && !current && "hover:border-accent/40", done && "opacity-70", locked && "opacity-80")}>
      <div className="flex w-12 shrink-0 flex-col items-center gap-2.5">
        <span className={cn("flex size-11 items-center justify-center rounded-xl", done ? "bg-bg2 text-muted" : "bg-accent/10 text-accent")} aria-hidden><Package className="size-6" /></span>
        {tel
          ? <a data-testid="ship-call" href={tel} aria-label={t("jf2.call_code", { code: stop.code })} className={cn(roundBtn, "border-cyan/60 bg-cyan/10 text-cyan hover:bg-cyan/20")}><Phone className="size-5" aria-hidden /></a>
          : <span data-testid="ship-call" role="link" aria-disabled="true" aria-label={noContact} title={noContact} className={cn(roundBtn, "cursor-not-allowed border-line bg-bg2 text-muted/50")}><Phone className="size-5" aria-hidden /></span>}
        <button type="button" data-testid="ship-whatsapp" disabled={!tel || wa} aria-label={tel ? t("jf2.wa_code", { code: stop.code }) : noContact} title={tel ? undefined : noContact} onClick={whatsapp}
          className={cn(roundBtn, tel ? "border-[#25d366]/60 bg-[#25d366]/15 text-[#25d366] hover:bg-[#25d366]/25" : "cursor-not-allowed border-line bg-bg2 text-muted/50", wa && "animate-pulse")}><MessageCircle className="size-5" aria-hidden /></button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button type="button" data-testid="ship-code" aria-label={t("jf2.card_open", { code: stop.code })} onClick={() => onOpen(stop.id)}
              className="ltr-num block max-w-full truncate rounded-md text-start text-base font-bold tracking-wide text-ink outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-card focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-accent">{stop.code}</button>
            <span className="mt-1 block h-0.5 w-9 rounded-full bg-accent" aria-hidden />
          </div>
          <span data-testid="ship-status" data-chip={chip.key} className="shrink-0"><Badge tone={chip.tone}>{locked && <Lock className="size-3" aria-hidden />}{t(`jf2.chip_${chip.key}`)}</Badge></span>
        </div>

        {(current || stop.arrivedAt) && !done && (
          <div className="flex flex-wrap gap-1.5">
            {current && routing && <Badge tone="success">{t("jf2.current")}</Badge>}
            {stop.arrivedAt && <Badge tone="info"><MapPin className="size-3" aria-hidden />{t("jf2.arrived")}</Badge>}
          </div>
        )}

        <dl className="space-y-1 text-sm">
          <Line label={t("jf2.f_name")} testId="ship-name">{stop.recipientName ? <span className="break-words">{stop.recipientName}</span> : <span className="font-normal italic text-muted">{t("jf2.name_hidden")}</span>}</Line>
          <Line label={t("jf2.f_address")} testId="ship-address"><span className="line-clamp-2 break-words">{stop.address}{city && <span className="text-muted"> · {city}</span>}</span></Line>
          <Line label={t("jf2.f_cod")} testId="ship-cod">
            {cash > 0
              ? <span className={cn("ltr-num inline-block rounded-lg px-2 py-0.5 font-extrabold", stop.status === "delivered" ? "bg-accent/10 text-accent" : "bg-gold/15 text-gold")}>{fmtMoney(cash, locale)}</span>
              : <span className="ltr-num text-muted">{fmtMoney(0, locale)}</span>}
          </Line>
          <Line label={t("jf2.f_payment")} testId="ship-payment">{t(pay === "cod" ? "jf2.pay_cod" : "jf2.pay_prepaid")}</Line>
          <Line label={t("jf2.f_pieces")} testId="ship-pieces"><span className="ltr-num">{fmtNum(pieces, locale)}</span>{stop.contents && <span className="font-normal text-muted"> · {stop.contents}</span>}</Line>
        </dl>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2.5">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted" data-testid="ship-date" data-kind={date?.kind}>
            <Clock className="size-4 shrink-0" aria-hidden />
            {date ? <span className="truncate" title={t(date.kind === "delivered" ? "jf2.f_delivered_at" : "jf2.f_created", { date: fmtDateTime(date.at, locale) })}>{fmtDateTime(date.at, locale)}</span> : <span>—</span>}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" data-testid="ship-copy" aria-label={t("jf2.copy_address")} title={t("jf2.copy_address")} onClick={copy} className={squareBtn}><Copy className="size-4" aria-hidden /></button>
            <a data-testid="ship-map" href={mapsUrl(stop)} target="_blank" rel="noreferrer" aria-label={t("jf2.map_code", { code: stop.code })} title={t("dstop.open_maps")} className={squareBtn}><Navigation className="size-4 rtl:-scale-x-100" aria-hidden /></a>
          </div>
        </div>
      </div>
    </li>
  );
}
