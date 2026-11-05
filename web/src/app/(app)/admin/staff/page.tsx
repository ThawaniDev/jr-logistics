"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoading, Select, StatusBadge, Table, Td, useAction, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

export default function Staff() {
  const { t } = useI18n(); const a = useAction(); const me = useUser();
  const { data, error, mutate } = useApi("/admin/staff"); const meta = useApi("/admin/meta");
  const [m, setM] = useState<null | { id?: string }>(null); const [f, setF] = useState<any>({ permissions: [] }); const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data || !meta.data) return <PageLoading />;
  const canManage = hasPerm(me, "staff.manage");
  const preset = (k: string) => setF({ ...f, staffRole: k, permissions: meta.data.presets[k] ?? [] });
  const toggle = (p: string) => setF({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x: string) => x !== p) : [...f.permissions, p] });
  const save = () => a.run("s", () => m?.id ? patch(`/admin/staff/${m.id}`, { name: f.name, staffRole: f.staffRole ?? null, permissions: f.permissions }) : post("/admin/staff", { name: f.name, email: f.email, password: f.password, staffRole: f.staffRole, permissions: f.permissions }), { success: "common.saved", onDone: () => { setM(null); mutate(); }, onError: (e) => setErr(errText(e, t)) });
  return (
    <>
      <PageHeader title={t("nav.staff")} subtitle={t("staff.sub")} actions={canManage && <Button onClick={() => { setF({ permissions: [] }); setErr(null); setM({}); }}><UserPlus className="size-4" />{t("staff.add")}</Button>} />
      {data.items.length === 0 ? <EmptyState title={t("staff.none")} /> : (
        <Table head={[t("common.name"), t("auth.email"), t("staff.preset"), t("staff.perms"), t("common.status"), ""]}>
          {data.items.map((s: any) => <tr key={s.id}><Td className="font-medium">{s.name}</Td><Td className="ltr-num text-muted">{s.email}</Td><Td>{s.staffRole ? <Badge tone="info">{t(`preset.${s.staffRole}`)}</Badge> : "—"}</Td><Td className="tabular-nums">{s.permissions.length}</Td><Td><StatusBadge status={s.status} /></Td>
            <Td>{canManage && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => { setF({ name: s.name, staffRole: s.staffRole, permissions: s.permissions }); setErr(null); setM({ id: s.id }); }}>{t("common.edit")}</Button><Button size="sm" variant={s.status === "active" ? "danger" : "secondary"} onClick={() => a.run(s.id, () => patch(`/admin/staff/${s.id}`, { status: s.status === "active" ? "suspended" : "active" }), { success: "common.saved", onDone: () => mutate() })}>{s.status === "active" ? t("admin.suspend") : t("admin.activate")}</Button></div>}</Td></tr>)}
        </Table>
      )}
      <Modal open={!!m} onClose={() => setM(null)} title={m?.id ? t("common.edit") : t("staff.add")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("s")} disabled={!f.name || (!m?.id && (!f.email || !f.password))} onClick={save}>{t("common.save")}</Button></>}>
        <Input label={t("common.name")} value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} />
        {!m?.id && <><Input label={t("auth.email")} type="email" ltr value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} /><Input label={t("staff.temp_password")} type="password" ltr value={f.password ?? ""} onChange={(e) => setF({ ...f, password: e.target.value })} hint={t("staff.password_hint")} /></>}
        <Select label={t("staff.preset")} placeholder={t("staff.custom")} options={Object.keys(meta.data.presets).map((k) => ({ value: k, label: t(`preset.${k}`) }))} value={f.staffRole ?? ""} onChange={(e) => preset(e.target.value)} />
        <fieldset><legend className="mb-2 text-xs font-medium text-muted">{t("staff.perms")} ({f.permissions.length})</legend><div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-xl border border-line p-3 sm:grid-cols-2">{meta.data.permissions.map((p: string) => <Checkbox key={p} checked={f.permissions.includes(p)} onChange={() => toggle(p)} label={<span className="ltr-num text-xs">{p}</span>} />)}</div></fieldset>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      </Modal>
    </>
  );
}
