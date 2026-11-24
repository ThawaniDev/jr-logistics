# Privacy and personal data — data map, retention and the erasure procedure (L-series, B3 / B10 / O9)

Record of processing for the PDPL file (Saudi Personal Data Protection Law). It says **what personal data the platform holds, where, why, for how long, who can see it, and what happens to it when a person asks to be erased**. It describes the code as built in update L; if you change a table that holds personal data, change this file in the same commit (`tests/integration/privacy-anonymise.test.ts` sweeps the whole database for a person's identifiers after an erasure and fails when a new column keeps them).

* **Controller**: the platform operator. The legal identity (names, VAT, CR, address, support channels, privacy contact) is edited in Settings › **Company** and read through `getCompany()` (`server/company.ts`); the privacy contact is `privacyEmail`.
* **People**: companies (business), courier offices, drivers, staff, administrators; and **third parties the platform never meets** — the recipients of parcels (name, phone, address entered by the company that ships to them).
* **Not legal advice**: the periods below are the owner's defaults (decision O9, `memory/audit/data.md`); the owner's lawyer decides the final ones (Settings › Security › *Privacy and retention*).

## 1. Rights and how they are served

| Right | How | Where |
|---|---|---|
| Access / portability | **Download my data**: one JSON file, any signed-in role, rate-limited (5 / hour), audited (`privacy.export`) | Profile › *Privacy & data* · `GET /privacy/export` |
| Access on behalf (staff) | Export one person's file; needs `privacy.manage`; audited (`privacy.export_staff`) | `/admin/privacy` › *Find a person* · `GET /admin/privacy/export/:userId` |
| Correction | The profile page (name, city, address, bank details, …); staff can edit accounts (`accounts.edit`, audited) | `PATCH /profile`, `/admin/accounts/:id` |
| Erasure | **Request account deletion** → staff decide → anonymisation (section 4). Blockers are shown to the person up-front | `/privacy/status`, `/privacy/delete-request`, `/admin/privacy` |
| Objection / complaint | E-mail to `privacyEmail` (shown on the card and in the policy); staff file the request for the person | `POST /admin/privacy/requests` |
| Information | The privacy policy (`/privacy`, W3) and this record | |

The export never contains: password hash, second-factor secret and recovery codes, session / API-key hashes, the webhook signing secret, stored file paths, **other people's personal data** (parcel recipients, an office's drivers), internal staff notes, the audit trail. Staff notes about a person are only *counted* in the staff copy (`internal`), so staff decide what to disclose.

## 2. Data map

"Erasure" = what `anonymiseUser` does to the row. **Kept** means kept without anything that identifies the person (the account row is blanked, so a foreign key to it identifies nobody).

| Data | Table · column | Whose | Purpose / basis | Retention | Who sees it | Erasure |
|---|---|---|---|---|---|---|
| Name, phone, e-mail, username, language, city | `users` | person | contract (account, sign-in, contact) | while the account exists | the person; staff with `users.view` (phone masked without `drivers.sensitive`) | name → "Deleted account", phone / e-mail / username / password / 2FA cleared, `status = suspended`, `anonymized_at` set; **a database trigger refuses any later re-identification or re-activation** |
| Password hash, 2FA secret, recovery codes | `users` | person | security | while the account exists | nobody (hash / encrypted) | cleared |
| Sign-in history: time, method, IP, device, client | `login_events` | person | security, fraud | 400 days; the *typed name of an unknown account* 30 days | the person (export); staff with `audit.view` / security tabs | `identifier`, `ip`, `user_agent` cleared (row kept for the failure-rate report) |
| Sessions: device, IP, expiry | `sessions` | person | security | until expiry (+1 day) | the person | deleted |
| Company profile: company name, CR, VAT, industry, address, responsible person, warehouse pin, webhook URL / secret | `business_profiles` | company | contract, invoicing | while the account exists | the company; staff (`users.view`; sensitive fields need `drivers.sensitive`) | company name → "Deleted account", everything else cleared |
| Office profile: office name, CR, VAT, address, bank, IBAN, responsible person | `office_profiles` | office | contract, payouts | while the account exists | the office; staff | office name → "Deleted account", rest cleared |
| Driver profile: national ID, plate, bank, IBAN, vehicle, last position | `driver_profiles` | driver | contract, verification, payouts | while the account exists | the driver; staff (`drivers.sensitive` for ID / IBAN) | ID, plate, bank, IBAN, position cleared; office link removed; availability off |
| Uploaded documents (ID, licence, CR …) and their files | `documents` + object store | person | verification | while the account exists; **leftovers and documents of closed accounts after `closedAccountRetentionYears` (5)** | the owner; staff with `documents.review` | rows deleted, **files removed from the store after the commit** (retry list `privacy_requests.pending_storage_keys`) |
| Driver location track | `driver_location_history` | driver | dispatch safety, disputes | **90 days** | staff with `live_location.view` | deleted |
| Availability log | `driver_availability_log` | driver | fleet reports | kept (statistics, no content) | staff | kept (keyed by the blanked account) |
| Notifications | `notifications` | person | service | read: `notificationRetentionDays` (**90**), any: 12 months | the person | deleted; other people's notifications that carry the name as a value are rewritten to "Deleted account" |
| Chat messages | `messages` | both sides | operations | with the request | both parties, staff | the person's messages → "[removed]" |
| Support tickets, replies, attachments | `tickets`, `ticket_replies`, `ticket_attachments` + files | person | support | with the case | the person, staff (`tickets.view`); internal replies staff only | subject and own replies → "[removed]"; staff text naming the person is rewritten; attachments deleted (rows now, files after commit) |
| Complaints, notes | `complaints`, `complaint_notes` | person | quality | with the case | staff (`complaints.manage`) | description and own notes → "[removed]"; resolution text rewritten |
| Ratings (stars + comment) | `ratings` | both | quality | kept | staff | comments removed, stars kept |
| Staff notes about a person | `entity_notes` (`entity = 'user'`) | person | operations | until deleted | staff with `notes.manage` | deleted |
| The person's name, phone, e-mail or username inside **other people's sentences** (staff notes on orders, replies, complaints, the other side of a chat, ledger / withdrawal / settlement / COD notes, cancel reasons, custody notes) | those tables' free-text columns | person | operations | as the row | staff, the other party | the identifiers (full name / company name 5+ characters, every phone spelling, e-mail, username 5+) are replaced by "Deleted account", exact match only |
| Money: wallet, ledger, withdrawals, top-ups, settlements, invoices, COD remittances | `wallet_accounts`, `ledger_entries`, `withdrawals`, `settlements`, `invoices`, `cod_remittances`, `payment_intents`, `bank_transfers` | person | accounting, tax | **kept** (legal accounting duty; the ledger is append-only) | person, staff with `finance.view` | kept; withdrawal IBAN / bank cleared, ledger and note text rewritten of identifiers, bank-transfer payer name cleared. **Open question for the lawyer**: tax invoices normally need the buyer's identity for 6 years; today the buyer block of an erased company reads "Deleted account" |
| Orders and parcels: addresses, recipient name / phone / notes, receiver name, coordinates | `requests`, `shipments` | **the recipient** (third party) and the company | delivery | recipient details **12 months** (`recipientPiiRetentionMonths`) after the order was last active; code, status, timestamps, proof stay | company, assigned driver, staff | for an erased company all recipient details are blanked at once; coordinates keep 2 decimals (≈ 1 km) |
| Job and parcel events | `job_events`, `shipment_events` | both | audit of the delivery | kept; free-text keys (`note`, `error`, `receiverName`, …) removed with the recipient details | staff | actor name → "Deleted account" |
| Proof of delivery photos, signatures | `shipment_media`, `shipments.proof_key` + files | **the recipient** | evidence | kept with the order (**open question**: delete after the dispute window) | company, staff | kept |
| API keys, webhooks, warehouse-system connections and orders | `api_keys`, `webhook_deliveries`, `partner_*` | company | integration | webhook deliveries: delivered **90 days**, dead letters **180 days** | the company | keys revoked, URLs / secrets / payloads cleared, connections disabled, partner orders' recipient data cleared |
| Consent log (terms / privacy accepted: version, language, address, time) | `terms_consents` | person | proof of consent | kept | staff | IP cleared, row kept |
| Message log (SMS, webhooks): masked recipient, no text | `message_log` | person | delivery proof | 400 days | staff | recipient cleared |
| Audit log | `audit_logs` | actor / subject | accountability | kept | staff with `audit.view` | actor IP cleared; the personal values inside the diff (old / new phone, name, IBAN …) removed at every depth; action, time, actor id stay |
| Erasure requests | `privacy_requests` | person | accountability | kept | staff with `privacy.manage` | the free-text reason is wiped when the request completes |
| Company identity | `settings` (`company`) | platform | invoicing, contact | until changed | public | – |
| Metric snapshots | `metric_snapshots` | none | statistics | kept | staff | aggregates only, no person |

Recipients of data: SMS provider (recipient phone and text, only while SMS is on), PayTabs (customer name / address / e-mail for a card top-up, on their hosted page), Google Maps (stop addresses for route planning, only while routing is on), couriers and warehouses (the parcel details they need), the platform's staff by permission.

## 3. Retention job (`server/privacy/retention.ts`, step `privacy_retention` of the scheduled tick)

Throttled to about once an hour (keeps going every tick while there is a backlog), batch-limited, idempotent, logs one line and one audit row (`privacy.retention`) when it changed something. Periods come from the platform settings (Settings › Security › *Privacy and retention*; `0` = keep for the recipient-details and document periods; the notification period is 7–3,650 days and cannot be 0):

1. **Recipient details** of finished orders (status completed / cancelled / expired, last activity older than `recipientPiiRetentionMonths`): `recipient_name / phone / address / notes / receiver_name / fail_note` blanked (a dash, `''` for the phone), coordinates rounded to 2 decimals, personal keys removed from the event payloads. A cursor walks the old orders once; shortening the period restarts it.
2. **Documents**: of erased accounts (leftovers) and of accounts closed — suspended and silent — for `closedAccountRetentionYears`: the file first, the row only when the file is gone.
3. **Stored files** an erasure could not remove (storage outage) are retried.
4. **Webhook deliveries**: delivered 90 days, dead letters 180 days.
5. **Notifications** follow `notificationRetentionDays` in the hourly prune of `server/snapshots.ts`.
6. Existing prunes (unchanged): location history 90 days, sign-in events 400 days (typed unknown names 30), message log 400 days, API logs 30 days, sessions / one-time codes / rate limits 1 day, idempotency keys 7 days, partner events 180 days.

Kept on purpose: ledger, wallets, settlements, invoices, audit log, job / parcel events (history), metric snapshots, consent log.

## 4. Erasure (anonymisation) — the procedure

1. The person asks (profile › *Privacy & data*) or staff file it for them (`/admin/privacy` › *Find a person*). A request is refused while a **blocker** exists (shown to the person up-front, computed live from the data): open orders or jobs, undelivered parcels not returned, linked drivers (office), funds / reserved / held money or credit in use in the wallet, pending withdrawals, pending top-ups, unsettled settlements, cash on delivery not handed over (driver) or still with drivers (company), unpaid invoices. Staff and administrators are never erased here.
2. Staff with `privacy.manage` (or the super admin) open the request, see the checklist and what the approval does, and **approve** (an explicit "I understand this is permanent" tick) or **decline with a reason** (the person is notified). Nobody without the permission can reach either — the routes and the function check it.
3. Approval runs `anonymiseUser` in **one transaction**: lock request and account → check the blockers → scrub every table (section 2) → check the blockers **again** → blank the account, complete the request, audit. Any failure rolls everything back. A second approver, or a double click, finds it done (`already: true`).
4. After the commit the stored files are removed; the keys were written to the request in the same transaction, so a storage outage leaves a retry list (the retention step clears it), never an orphan.
5. The database refuses to bring the account back (trigger `users_anonymised_guard`, migration 0031; the console answers 409 *CONFLICT*). The person cannot sign in (no username, no password hash, no sessions).

## 5. Open points for the owner / lawyer

* Tax invoices of an erased company: keep a snapshot of the buyer identity for the statutory 6 years (then it is not erased), or accept "Deleted account" on the invoice.
* Proof photos and signatures of recipients: how long to keep after delivery.
* Bank-transfer receipts (Finance evidence) are kept with the ledger; decide their period.
* Whether the log of exports (`privacy.export`) should be shown to the person.
