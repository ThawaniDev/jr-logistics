"use client";
import { MessageSquare } from "lucide-react";
import { EmptyState, Section, Segmented } from "@/components/ui";
import { useUrlState } from "@/components/ui/data";
import { JobChat } from "./chat";
import { Timeline } from "./timeline";
import { useRequest } from "./business-views-request-ctx";
import { HAS_DRIVER } from "./business-views-lib";
import { useI18n } from "@/i18n/provider";

/** Activity: the chat with a driver of the order (pick one when there are several) next to the order's timeline. Needs a <Suspense> above it. */
export function RequestActivity() {
  const { t } = useI18n(); const { r, offers, data } = useRequest();
  const [pick, setPick] = useUrlState("driver");
  const talk = offers.filter((o) => HAS_DRIVER(o.status));
  const chatOffer = talk.find((o) => o.id === pick) ?? talk[0];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-3" data-testid="order-chat">
        {talk.length > 1 && <Segmented label={t("rdz.chat_driver")} value={chatOffer?.id ?? ""} onChange={setPick} options={talk.map((o) => ({ key: o.id, label: o.driver.name }))} />}
        {chatOffer ? (
          <>
            <p className="text-sm text-muted">{t("chat.with", { name: chatOffer.driver.name })}</p>
            <JobChat key={chatOffer.id} offerId={chatOffer.id} closed={["completed", "cancelled"].includes(r.status)} />
          </>
        ) : <EmptyState icon={<MessageSquare className="size-9" aria-hidden />} title={t("rdz.no_chat")} hint={t("rdz.no_chat_hint")} />}
      </div>
      <Section title={t("timeline.title")} className="min-w-0 self-start"><Timeline events={data.timeline} bare /></Section>
    </div>
  );
}
