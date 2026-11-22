# Demo history generator (decision G9)

`npm run db:seed:history` fills a development / demo database with **months of realistic, internally consistent activity**, so reports, dashboards and detail pages can be judged on something that looks like a real platform instead of 11 test orders. It is **opt-in**, refuses to run anywhere but a demo database, marks every row it creates, and can remove exactly what it created (`--reset`).

Code: `web/src/server/demo-history/*.ts` (library) · `web/scripts/seed-history.ts` (CLI) · tests `web/tests/unit/history-{core,sim,money}.test.ts`, `web/tests/integration/history-seed.test.ts`.

## 1. Commands

```bash
npm run db:seed:history -- --dry-run          # simulate, print what WOULD be created, write nothing
npm run db:seed:history -- --yes              # generate the default 180 days (about 20 s, ~450 MB peak)
npm run db:seed:history -- --reset --yes      # delete only what was generated (original demo data stays)
npm run db:seed:history -- --yes --days 90 --companies 12 --offices 3 --drivers 40 --seed 7 --end 2026-10-31
```

| Flag | Default | Meaning |
|---|---|---|
| `--days N` | 180 (7–730) | length of the window; it ends today (Riyadh) unless `--end` is given |
| `--companies N` | 30 | business accounts to generate (the demo business is added on top and gets history too) |
| `--offices N` | 6 | courier offices (the demo office is added on top) |
| `--drivers N` | 70 | drivers (the 6 demo drivers are added on top) |
| `--seed N` | 42 | deterministic: same flags + seed + `--end` (+ same database baseline) = same data |
| `--end YYYY-MM-DD` | today | last Riyadh day of the window (a past day freezes the "now" of the data: it is then reproducible on any date) |
| `--reset` | – | remove generated history only |
| `--dry-run` | – | counts only; connects read-only |
| `--yes` | – | required for anything that writes (including `--reset`) |

`HISTORY_DEBUG=1` additionally prints the calibration counters (requests and expiries per vehicle, why a request found nobody). Needs the normal baseline from `npm run db:seed` (approved pricing rules; the demo accounts if you want them to get history). Without demo staff it creates its own agents.

## 2. Safety

* Refuses unless `DEMO_MODE=true`; refuses when `NODE_ENV=production` (the app's long `ALLOW_DEMO_IN_PRODUCTION` acknowledgement is deliberately **not** honoured); refuses to write without `--yes`.
* Prints the target database (`name @ host`, never credentials) before doing anything.
* **One transaction**: nothing is committed unless the integrity check at the end passes (21 checks, printed PASS / FAIL — see §6). A failure rolls everything back.
* Never modifies or deletes a row it did not create. The only existing rows it touches are the *derived numbers of the demo accounts that receive history*: wallet balances (through `wallet.post()`, so ledger and balance stay equal), and rating / completed-job counters of demo drivers and the demo business. `--reset` subtracts exactly what was added and restores the wallets' `updated_at`; a fingerprint of every non-generated row of the dev database was identical before the run, during it and after the reset.
* Re-running without `--reset` is a **no-op** ("history already present"); it never duplicates or extends silently.

### How generated rows are recognised

| Where | Marker |
|---|---|
| every uuid | `5eed1157-<kind 4 hex>-4000-8000-<counter 12 hex>` (deterministic; the kind says the table, e.g. `…-0004-…` is a request). SQL: `id::text like '5eed1157-%'` (index-friendly range in `histIdSql()`); random v4 ids can never match |
| references | `JRH-000123` request · `JRH-000123-007` parcel · `TKH-` ticket · `CPH-` complaint · `CODH-` COD remittance · `INVH-` invoice (still parse like the platform's own, e.g. `splitParcelCode`) |
| users | `source = 'seed'`, **`is_demo = false`** (so the login-page demo card is not flooded; the existing demo accounts keep `is_demo = true`), phones `+9665001xxxxx`, parcel recipients `+9665002xxxxx`, staff e-mails `…@seed.jrlogistics.demo` (no password: they cannot sign in) |
| ledger | idempotency key prefix `hist:` (the ids come from `post()` and are random) |
| the run | `settings.demo_history` (options, window, counts, and what a reset must restore) |

Generated people have a username (`u` + the digits of the phone) but **no password**, so they cannot sign in until staff set one (Admin › user › Security › Reset password) — use that to look at a driver's or a company's view. (There is no one-time-code sign-in any more: decision J1.)

## 3. What it generates (default run: seed 42, window 2026-05-24 → 2026-11-19)

| Area | Rows (default) |
|---|---|
| Accounts | 30 companies, 6 offices, 70 drivers, 5 staff agents (+ the existing 8 demo accounts get history) · documents 341 · agreements 9 · invites 32 · API keys 9 · terms consents 6 182 |
| Orders | **3 181 requests**, 9 899 offers, **21 170 parcels**, 114 045 job events, 157 931 parcel events (`shipment_events`) |
| Money | 2 729 settlements, 2 727 invoices, 1 820 COD remittances, 380 withdrawals, **15 483 ledger entries** (67 top-ups) |
| Quality & support | 2 046 ratings, 1 144 chat messages, 641 tickets (+ 2 617 replies incl. internal notes, 116 attachment records), 168 complaints (+ 818 notes), 251 staff notes |
| Capture | 2 030 sign-ins, 14 344 availability changes, 15 751 location points (last 10 days), 22 703 messages (SMS + webhooks), 5 752 metric snapshots, 38 046 notifications, 5 327 audit rows |

Runtime ≈ 20–25 s, peak ≈ 420 MB (rows are buffered and flushed in FK order, ≤ 1 500 rows per statement through `jsonb_populate_recordset`; ledger postings go through the platform's own `post()`).

### How the data is shaped (so you can interpret it)

**Time.** Everything is Riyadh time (UTC+3), Saudi weekend Fri–Sat. Requests follow the weekday pattern (Fri ≈ 40 % of a Sunday), two daily peaks (09–13 and 16–21), a salary-week bump around the 28th, approximate Islamic / national holidays (quiet) and White Friday (peak; outside the default window), ~1.4 % random quiet days and long-run growth (≈ +80 % over 180 days) on top of companies joining. The newest hour is excluded: the data ends at the start of the current hour (`asOf`); work after it is simply "not happened yet", so the newest jobs are open / in progress and the newest tickets are unanswered.

**Companies.** Long tail: ~10 % enterprise (1.7–2.8 orders/day), ~23 % medium, the rest small. ~45 % registered during the window, ~14 % of the smaller ones churned, ~84 % verified (a few pending, info requested, rejected, suspended; recent sign-ups are pending). 11 industries with their own COD share (10–62 %), B2B share, vehicle mix and parcel contents. Two enterprise accounts have a credit line (their wallet goes negative and is paid down on the 3rd of the month → `credit_exposure`); one pharmacy-like account needs signatures; one account does not use delivery codes (`proof_type = 'scan'`); ~35 % use the API; 3 have webhooks.

**Supply.** Drivers have a latent quality `q` (ratings average ≈ 3.2 for the unreliable few … 4.9; delivery success, cancellations, no-shows, lateness and answer speed all follow it), weekday patterns, shifts (06:00–24:00) and random days off. ~40 % work through an office (uneven office sizes; some moved office or went direct), ~10 % are verified but live in cities where nobody can book a pickup yet (supply the platform cannot match — they appear in the per-city `drivers_available` snapshots and never get a job). A few drivers' licences expired, a few were suspended by admin, the unreliable ones hit the automatic cancellation-strike suspension.

**Matching** follows the real rules: exact vehicle (+ temperature for van/dyna), service, city = pickup city, verified, not suspended, **one active job at a time (E11)**, office ready, score = 50 + rating×4 + experience − cancellations×3, top `min(open×5, 30)` get the offer; online drivers at once, the others when they next go online; first acceptors win the slots, the rest are expired; cancel / no-show / ops replacement open a slot and start a replacement wave; operations hand-assign or drivers apply when it is close to the start; partly staffed requests are closed 60 min after the start; all-or-nothing requests are called off; unstaffed ones expire (≈ 9 % of requests: supply is deliberately thin in the cold-van lane).

**Delivery job.** arrive → attendance (auto or confirmed) → loading (driver scans or warehouse records) → route planned → approved → per stop: SMS code → arrived → (wrong code / resend / postpone once with evidence) → delivered (OTP, receipt photo for B2B, or scan; signature media where required; COD collected) or failed with a real reason → report → automatic confirmation → settlement paid in the same moment (E18) → returns received back later. Inter-city orders (Riyadh → Jeddah / Dammam) drive the first leg on the highway (hours, not minutes). ≈ 6 % of attempted parcels fail; ≈ 1 % of jobs end early (breakdown) and raise an urgent ticket.

**Money** (all via the platform's own arithmetic): top-up (simulated provider) before spending → `reserve` at publish → at payout `release_reserve`, `charge`, payee `payout` (office when the driver was affiliated at offer time, else the driver), `platform_fee` = margin; VAT 15 % is inside the price (settlement and invoice carry it); unspent escrow returns on cancel / expiry / partial close / completion; driverless rentals become platform revenue at hand-over; withdrawals are requested by direct drivers and offices (whole hundreds of riyals, ≥ minimum), paid (~96 %) or rejected by finance on working days; ~1.5 % of payouts (more for the newest ones) are held by an open complaint until staff resolve it (a few are still pending at the end → "payouts on hold"); COD cash is remitted to the warehouse after minutes–days (a little never, more for unreliable drivers) → `cash_with_drivers`.

**Support.** ~0.12 ticket per finished job plus everyday questions, linked to real orders half of the time; urgent categories answered in ~10 min, normal ones in ~40 min during Sun–Thu 07–22 (so the median first response is a few hours when nights and the weekend are included); internal notes, attachments (metadata only), reopens (~6 %), assignments by team (finance / ops / HR / support). Anything older than three weeks is resolved. Complaints get an assignment, notes and a resolution (a few stay open and hold a payout). Staff notes sit on problem accounts, enterprise accounts, rejected withdrawals and failed orders.

**Snapshots.** Hourly for the last 30 days, daily for the whole window (the running hour and the running day are left to the live tick), per city and for the platform, with every key the maintenance tick writes, computed from the simulated state (supply and demand, escrow / liability / credit exposure, cash with drivers, pending payouts and withdrawals, open cases).

## 4. Where it plugs into existing behaviour

* Retention: location history (90 d), sign-ins and message log (400 d) are pruned by the platform's hourly tick; the generator only writes 10 days of GPS points, and warns when `--days` is above 400.
* The tick keeps working on top: open generated requests expire / close / settle on their own once their time comes, a held payout is paid when its complaint is resolved, expired-licence drivers stay expired.
* Documents, proof photos and ticket attachments are **metadata only**: they all point at one tiny placeholder image (`uploads/hist/placeholder.png`, written after commit and removed by `--reset`).

## 5. Reset, idempotency, determinism

* `--reset --yes` deletes (children first, ledger before the rows it references) every generated row, reverses the generated postings on the wallets that stay, subtracts the generated rating / job counters, restores the `updated_at` of wallets nobody has posted to since, removes the placeholder and the marker row.
* Same flags + seed + `--end` give the same data (an unset `--end` means "today", so the window slides; the data inside it is still seed-stable up to the new days).
* A different seed gives a different but equally consistent world; to switch, reset first.

## 6. Integrity check (printed PASS / FAIL, run inside the transaction)

Wallets equal their ledger; internal transfers net to zero; each user's reserved balance equals the escrow of their requests; nothing negative (`wallet_nonneg`) · every paid settlement: customer = provider + margin, refund = reserved − customer, four ledger postings, exactly one VAT-inclusive invoice · platform margin booked = Σ margin · held payouts = open holding complaints · COD remitted ≤ collected per job, collected only on delivered parcels and exactly the amount due · parcel states coherent; parcels belong to an offer of their own request · offer / request milestone order · slots filled = live offers · every event, ledger row and message points at an existing request / parcel · every parcel has `created` (and `delivered` when delivered) · ticket / complaint timings · withdrawal states · no timestamp in the future · generated users off the demo card · every snapshot moment has a platform row. The same checks run in `history-seed.test.ts` against the test database (14 days, existing demo accounts, idempotency, determinism, reset restores every original row incl. wallet timestamps).

### Practical limits (measured in audit K, A4)

* **Size.** All rows and the final money step run in ONE transaction, and every generated posting goes through `wallet.post()`. Each posting updates a wallet row, so a hot wallet (the platform account gets one `platform_fee` per settlement) builds a long in-transaction version chain and the cost grows quadratically with the number of settlements: `--days 365 --companies 100 --offices 10 --drivers 300` (≈ 24 000 requests, 150 000 parcels, 23 000 settlements, 122 000 postings, ≈ 3 GB) takes about 8 minutes on a busy laptop (the integrity check runs `ANALYZE` on the generated tables first: without statistics an anti-join over a million parcel events never finished); the money step grows quadratically, so three times the settlements takes well over an hour (a 64 000-settlement run was abandoned after 35 minutes). Stay at or below ~25 000 settlements; for a bigger scratch database copy rows with SQL instead.
* **`--reset` after real use.** It stops with an error (now with Postgres' reason, e.g. `offers_driver_id_users_id_fk … Key (id)=(5eed1157-…) is still referenced from table "offers"`) once the running application has created rows that depend on a generated account — for instance every request published after the history was generated dispatches `offers` to the generated drivers. Nothing is deleted in that case (the transaction rolls back). Remove those rows first or re-create the database.
* **Ledger guard.** `ledger_entries` is append-only since migration 0024; `--reset` lifts the guard for its own transaction (`set_config('jr.ledger_maintenance', 'on', true)`). Backdating `created_at` (what the generator does) is allowed.

## 7. Known simplifications

* Pickup exists only where settings say so (today: Riyadh), so every active company / driver is in Riyadh; other cities appear as delivery cities and as waiting-list / stranded-supply accounts.
* Prices are the approved global rules, constant over the window (no negotiated per-business rules, no price changes).
* Payouts are immediate per order (E18); the legacy payout-batch flow, qty disputes (`qty_disputed`) and re-shipping failed parcels (`reshipped`) are not generated; no partner-integration connections / outbox.
* No `sessions` rows (sign-ins carry no session id); no push / e-mail messages; no API traffic log.
* Wallets of generated accounts start at zero at the window start and are funded by simulated top-ups; the demo accounts' real balances sit on top of their generated history.
* The demo accounts' own `users` rows (created 14 days ago in the dev database) are not back-dated, so their history starts before their registration date; sign-in history is added for them but `users.last_login_*` is left untouched.
* Islamic holidays are approximate Gregorian dates; the Hijri calendar is not modelled.
