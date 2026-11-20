"use client";
import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Badge, Button, EmptyState, Modal, Section } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

interface Item { key: string; kind: string; src: string; note?: string | null; by?: string | null; at?: string | null }

/** A thumbnail that says so when the picture cannot be loaded (the file may be gone or the viewer may lack access). */
function Thumb({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const [bad, setBad] = useState(false);
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-bg2" data-testid="dv1-evidence-item" data-kind={item.kind}>
      <button type="button" onClick={onOpen} disabled={bad} className="block aspect-[4/3] w-full bg-bg" aria-label={t("dv1.ev_view", { kind: t(`dv1.ev_${item.kind}`) })}>
        {bad ? <span className="flex h-full items-center justify-center gap-2 text-xs text-muted"><ImageOff className="size-4" aria-hidden />{t("dv1.ev_unavailable")}</span>
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin image, not optimisable
          : <img src={item.src} alt={t(`dv1.ev_${item.kind}`)} loading="lazy" onError={() => setBad(true)} className="size-full object-cover" />}
      </button>
      <div className="space-y-0.5 p-2.5 text-xs">
        <Badge tone={item.kind === "fail" ? "danger" : item.kind === "defer" ? "warn" : item.kind === "receipt" ? "info" : "neutral"}>{t(`dv1.ev_${item.kind}`)}</Badge>
        {item.note && <p className="text-ink">“{item.note}”</p>}
        <p className="text-muted">{[item.by, item.at ? fmtDateTime(item.at, locale) : null].filter(Boolean).join(" · ")}</p>
      </div>
    </li>
  );
}

/** Evidence captured for the parcel: the receipt photo, the recipient's signature, and the photos taken when a stop was postponed or failed — each with its note, who took it and when. */
export function ParcelEvidence({ id, code, hasProof, receiverName, media }: { id: string; code: string; hasProof: boolean; receiverName: string | null; media: Array<{ id: string; kind: string; note: string | null; createdAt: string; by: string | null }> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Item | null>(null);
  const items: Item[] = [
    ...(hasProof ? [{ key: "receipt", kind: "receipt", src: `/api/v1/shipments/${id}/proof`, note: receiverName ? t("shipadm.received_by", { name: receiverName }) : null }] : []),
    ...media.map((m) => ({ key: m.id, kind: m.kind, src: `/api/v1/shipments/${id}/media/${m.id}`, note: m.note, by: m.by, at: m.createdAt })),
  ];
  return (
    <Section title={t("dv1.evidence_title")} description={t("dv1.evidence_sub", { n: items.length })} id="parcel-evidence">
      {items.length === 0 ? <EmptyState icon={<ImageOff className="size-9" aria-hidden />} title={t("dv1.evidence_none")} hint={t("dv1.evidence_none_hint")} /> : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="dv1-evidence">{items.map((i) => <Thumb key={i.key} item={i} onOpen={() => setOpen(i)} />)}</ul>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={t("dv1.ev_modal", { kind: open ? t(`dv1.ev_${open.kind}`) : "", code })} footer={<Button variant="ghost" onClick={() => setOpen(null)}>{t("common.close")}</Button>}>
        {open && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin image, not optimisable */}
            <img src={open.src} alt={t(`dv1.ev_${open.kind}`)} className="mx-auto max-h-[70vh] w-auto rounded-xl border border-line" />
            {open.note && <p className="text-sm text-muted">“{open.note}”</p>}
          </>
        )}
      </Modal>
    </Section>
  );
}
