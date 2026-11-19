"use client";
import { Section } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { WarehouseOpsPanel } from "./admin-warehouse";
import { useCompany, useRefreshCompanies } from "./admin-companies-ctx";

/** Warehouse tab: the pin and the four per-warehouse switches (same panel, same `foa-wh-*` test ids the old dialog had), as a page section. */
export function CompanyWarehouse() {
  const { t } = useI18n(); const c = useCompany(); const refresh = useRefreshCompanies();
  return (
    <Section title={t("foa.wh_title")} description={t("foa.wh_intro")}>
      <div data-testid="foa-wh-section"><WarehouseOpsPanel key={c.id} businessId={c.id} embedded wide onSaved={refresh} /></div>
    </Section>
  );
}
