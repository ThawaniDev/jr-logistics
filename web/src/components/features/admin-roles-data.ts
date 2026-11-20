"use client";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { roleLabel, type CatalogGroup, type RoleItem, type RoleStats } from "./admin-roles-lib";

/** The role list (`GET /admin/roles`), shared through the SWR cache by the Roles page, the Staff page and the user page. `enabled = false` makes no request. */
export function useRoleList(enabled = true) {
  return useApi<{ items: RoleItem[]; stats: RoleStats }>(enabled ? "/admin/roles" : null);
}
export function useCatalog() {
  return useApi<{ groups: CatalogGroup[]; total: number }>("/admin/roles/catalog");
}

/**
 * Role names for display: a system role by its translated `preset.<key>` label (right away, before the list has loaded), a custom role by its own name.
 * A key that matches no role (older data) is shown as it is.
 */
export function useRoleNames(enabled = true) {
  const { t } = useI18n();
  const { data } = useRoleList(enabled);
  const byKey = new Map((data?.items ?? []).map((r) => [r.key, r]));
  return {
    roles: data?.items ?? [],
    find: (key: string | null | undefined) => (key ? byKey.get(key) ?? null : null),
    label: (key: string | null | undefined): string => {
      if (!key) return t("staff.custom");
      const r = byKey.get(key);
      if (r) return roleLabel(t, r);
      const v = t(`preset.${key}`);
      return v === `preset.${key}` ? key : v;
    },
  };
}
