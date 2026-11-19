"use client";
import { ProfilePage } from "@/components/features/profile";
import { WarehouseLocationCard, WarehouseOpsCard } from "@/components/features/business-warehouse";
import { ProfileKpis } from "@/components/features/business-views-profile";
import { useI18n } from "@/i18n/provider";

/** The shared profile form beside what is specific to a warehouse: its map location (E1) and how JR operates it (read-only switches). */
export default function Page() {
  const { t } = useI18n();
  return (
    <ProfilePage title={t("nav.profile_warehouse")} subtitle={t("rdz.pf_sub")} top={<ProfileKpis />}>
      <WarehouseLocationCard />
      <WarehouseOpsCard />
    </ProfilePage>
  );
}
