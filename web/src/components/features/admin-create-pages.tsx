"use client";
import Link from "next/link";
import { ArrowLeft, Building2, Check, ChevronRight, Factory, Pencil, Plus, ShieldAlert, Truck, UserPlus, UserRoundCog, Users, type LucideIcon } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { LinkButton } from "./admin-common";
import { AccountForm } from "./admin-create-form";
import { LIST_HREF, formFromAccount, type Kind } from "./admin-create-lib";

const META: Record<Kind, { icon: LucideIcon; add: string; edit: string; sub: string; list: string; slug: string }> = {
  business: { icon: Factory, add: "acr.add_company", edit: "acr.edit_company", sub: "acr.add_company_sub", list: "nav.companies", slug: "company" },
  office: { icon: Building2, add: "acr.add_office", edit: "acr.edit_office", sub: "acr.add_office_sub", list: "nav.offices", slug: "office" },
  driver: { icon: Truck, add: "acr.add_driver", edit: "acr.edit_driver", sub: "acr.add_driver_sub", list: "nav.drivers", slug: "driver" },
};

/** "Add company" / "Add courier office" / "Add driver" / "Add user" in the header of the list pages. Shown only to staff who hold `accounts.create`. */
export function AddAccountButton({ kind }: { kind: Kind | "user" }) {
  const { t } = useI18n(); const me = useUser();
  if (!hasPerm(me, "accounts.create")) return null;
  const href = kind === "user" ? "/admin/users/new" : `${LIST_HREF[kind]}/new`;
  return <LinkButton href={href} variant="primary" data-testid={`acr-add-${kind === "user" ? "user" : META[kind].slug}`}><Plus className="size-4" aria-hidden />{t(kind === "user" ? "acr.add_user" : META[kind].add)}</LinkButton>;
}
/** "Edit" in the header of a company / office / driver (needs `accounts.edit`). */
export function EditAccountButton({ kind, id }: { kind: Kind; id: string }) {
  const { t } = useI18n(); const me = useUser();
  if (!hasPerm(me, "accounts.edit")) return null;
  return <LinkButton href={`${LIST_HREF[kind]}/${id}/edit`} variant="secondary" size="sm" data-testid={`acr-edit-${META[kind].slug}`}><Pencil className="size-4" aria-hidden />{t("common.edit")}</LinkButton>;
}

function NoAccess({ kind }: { kind: Kind | "user" }) {
  const { t } = useI18n(); const href = kind === "user" ? "/admin/users" : LIST_HREF[kind];
  return <div data-testid="acr-no-access"><EmptyState icon={<ShieldAlert className="size-9" aria-hidden />} title={t("acr.no_access")} hint={t("acr.no_access_hint")} action={<Link href={href}><Button variant="secondary">{t("common.back")}</Button></Link>} /></div>;
}

/** `/admin/{companies,offices,drivers}/new`. */
export function NewAccount({ kind }: { kind: Kind }) {
  const { t } = useI18n(); const me = useUser(); const m = META[kind]; const Icon = m.icon;
  return (
    <>
      <PageHeader title={t(m.add)} subtitle={t(m.sub)} icon={<Icon className="size-5" />} breadcrumbs={[{ label: t(m.list), href: LIST_HREF[kind] }, { label: t(m.add) }]} />
      {hasPerm(me, "accounts.create") ? <AccountForm kind={kind} mode="create" /> : <NoAccess kind={kind} />}
    </>
  );
}

/** `/admin/{companies,offices,drivers}/:id/edit`, rendered under the entity header: loads the editable snapshot and shows the prefilled form. */
export function EditAccount({ kind, id }: { kind: Kind; id: string }) {
  const { t } = useI18n(); const me = useUser(); const m = META[kind];
  const ok = hasPerm(me, "accounts.edit");
  const { data, error, mutate } = useApi(ok ? `/admin/accounts/${id}` : null, { shouldRetryOnError: false, revalidateOnFocus: false });
  const back = `${LIST_HREF[kind]}/${id}`;
  const head = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold" data-testid="acr-edit-title">{t(m.edit)}</h2>
      <LinkButton href={back} variant="ghost" size="sm" data-testid="acr-edit-back"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t(`acr.back_to_${m.slug}`)}</LinkButton>
    </div>
  );
  if (!ok) return <>{head}<NoAccess kind={kind} /></>;
  if (error) return <>{head}{error instanceof ApiError && error.code === "NOT_FOUND" ? <EmptyState title={t("acr.not_editable")} hint={t("acr.not_editable_hint")} /> : <ErrorState error={error} retry={() => mutate()} />}</>;
  if (!data) return <PageLoading />;
  if (data.kind !== kind) return <>{head}<EmptyState title={t("acr.not_editable")} hint={t("acr.not_editable_hint")} /></>;
  return (
    <>
      {head}
      <AccountForm key={`${id}:${data.fields.name}`} kind={kind} mode="edit" initial={formFromAccount(kind, data)}
        edit={{ id, maskedPhone: data.sensitiveAllowed ? null : data.phoneMasked, sensitiveAllowed: data.sensitiveAllowed, officeName: data.office?.name ?? null }} />
    </>
  );
}

const CARDS: Array<{ key: "business" | "office" | "driver" | "staff"; icon: LucideIcon; href: string; perm: string; creates: string[] }> = [
  { key: "business", icon: Factory, href: "/admin/companies/new", perm: "accounts.create", creates: ["acr.card_business_1", "acr.card_business_2", "acr.card_business_3"] },
  { key: "office", icon: Building2, href: "/admin/offices/new", perm: "accounts.create", creates: ["acr.card_office_1", "acr.card_office_2", "acr.card_office_3"] },
  { key: "driver", icon: Truck, href: "/admin/drivers/new", perm: "accounts.create", creates: ["acr.card_driver_1", "acr.card_driver_2", "acr.card_driver_3"] },
  { key: "staff", icon: UserRoundCog, href: "/admin/staff?add=1", perm: "staff.manage", creates: ["acr.card_staff_1", "acr.card_staff_2", "acr.card_staff_3"] },
];
/** `/admin/users/new`: four cards, each saying what it creates. */
export function AccountChooser() {
  const { t } = useI18n(); const me = useUser();
  const cards = CARDS.filter((c) => hasPerm(me, c.perm));
  return (
    <>
      <PageHeader title={t("acr.add_user")} subtitle={t("acr.chooser_sub")} icon={<UserPlus className="size-5" />} breadcrumbs={[{ label: t("nav.users"), href: "/admin/users" }, { label: t("acr.add_user") }]} />
      {cards.length === 0 ? <NoAccess kind="user" /> : (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="acr-chooser">
          {cards.map((c) => { const Icon = c.icon; return (
            <li key={c.key}>
              <Link href={c.href} data-testid={`acr-choose-${c.key}`} className="group flex h-full flex-col rounded-card border border-line bg-card p-5 transition hover:-translate-y-0.5 hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <span className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden><Icon className="size-6" /></span>
                  <span className="min-w-0"><span className="block text-lg font-semibold">{t(`acr.card_${c.key}_t`)}</span><span className="block text-sm text-muted">{t(`acr.card_${c.key}_d`)}</span></span></span>
                <ul className="mt-4 space-y-1.5 text-sm text-muted">
                  {c.creates.map((k) => <li key={k} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{t(k)}</li>)}
                </ul>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent">{t(`acr.card_${c.key}_cta`)}<ChevronRight className="size-4 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden /></span>
              </Link>
            </li>); })}
        </ul>
      )}
      <p className="mt-5 flex items-center gap-2 text-xs text-muted"><Users className="size-4" aria-hidden />{t("acr.chooser_note")}</p>
    </>
  );
}
