"use client";
import Link from "next/link";
import { EmptyState, Button } from "@/components/ui";
import { FailedUpdates } from "../../activity";
import { useConnection } from "../../connection-detail";
import { useI18n } from "@/i18n/provider";

export default function Page() {
  const { t } = useI18n(); const { conn, outbox, showOutbox, base } = useConnection();
  if (!showOutbox) return <EmptyState title={t("intg.ob_none")} hint={t("intg.ob_none_hint", { name: conn.name })} action={<Link href={base}><Button variant="secondary">{t("intg.tab_setup")}</Button></Link>} />;
  return <FailedUpdates conn={conn} data={outbox.data} error={outbox.error} reload={() => outbox.mutate()} />;
}
