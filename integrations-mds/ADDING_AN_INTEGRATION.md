# Adding another warehouse system (developer guide)

The core never changes: one adapter file + registry line + copy + tests. Read `memory/INTEGRATIONS_API.md` first.

## 0. Read the vendor's real documentation
Save a snapshot under `integrations-mds/vendor-docs/`. Decide the **mode**:
- the system can send orders to a courier and wants statuses back → **carrier** (like `fastcoo.ts`; if JR must *implement* an API the
  vendor calls, add a `carrier-<vendor>.ts` like `carrier-omniful.ts` and its public routes in `server/api/routes/partners.ts`);
- JR uses the merchant's own key to read / cancel → **merchant** (like `logestechs.ts`, `shipox.ts`, `fizzpa.ts`).
Never implement a call the vendor does not document; list what is missing in the guide instead.

## 1. The adapter — `web/src/server/partners/<vendor>.ts`
```ts
export const vendor: Adapter = {
  key: "vendor", label: "Vendor", description: "…", docsUrl: "…",
  fields: [ /* config + secrets (secret: true → encrypted, write-only), advanced: true for rarely changed ones */ ],
  capabilities: { mode, lookup, webhookIn, webhookAuth: "header" | "url", registerWebhook, importOrders, pollOrders, track, push: [...JrEvent], label, carrierApi },
  inboundTokenHeaders: [...],              // headers the vendor can carry JR's token in
  defaults: { sync, statusOut, importNew, pollMinutes },
  statusOut: [...documented codes], statusIn: [...documented inbound statuses with their meaning], classify(status) { … },
  test(ctx), lookup?(ctx, ref), parseWebhook?(body, ctx, headers) → { events?, orders? },
  registerWebhook?(ctx, url, token), push?(ctx, job), makeLabel?(ctx, refs), pollOrders?(ctx, since), track?(ctx, ref),
};
```
Rules: network only through `ctx.http` (SSRF-pinned, timeouts); map HTTP failures with `failFrom` (auth / not_found / rejected / unavailable —
only *unavailable* is retried); never return or log secrets; keep only non-sensitive fields in `summary`; rotate tokens with
`ctx.saveSecrets`, runtime state with `ctx.saveMeta`; `push` returns `{ok:true, skipped:"reason"}` when the vendor has nothing to receive.

## 2. Register + copy
- `web/src/server/partners/registry.ts`: add it to the list.
- i18n: provider name/description/field labels in a fragment (`intg.provider.<key>.label|desc`, `partners.field.<key>.<field>`), en/ar/ur,
  then `npm run i18n:export`.
- Guide: `integrations-mds/<vendor>.md` (what is documented → what JR does, set-up, limits, go-live checklist).

## 3. Tests
- `web/tests/unit/partners-adapters.test.ts`: parse the vendor's **published sample payloads verbatim**; the registry consistency test checks
  your defaults use documented codes only.
- `web/tests/integration/partners-v2.test.ts`: the local fake server speaks the vendor's contract — cover test, import, the full JR journey
  write-back in order, cancellation both ways, auth failure and retry.
Run: `npx vitest run tests/unit/partners-adapters.test.ts tests/integration/partners-v2.test.ts tests/integration/partners.test.ts`.

Nothing else changes: Incoming orders, the outbox (ordering, retries, dead-letter), scheduling, the staff screens, audit, the mapping editor
and the UI forms are all generated from the adapter.
