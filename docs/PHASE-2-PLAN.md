# Phase 2 plan — n8n wiring and a simulated run (offline)

Written at the Phase 1 gate (2026-11-27, unattended run) **for Shane's review. Do not start Phase 2 until Phase 1 is merged and this plan is reviewed.** Read first: `docs/prd-readout.md`, `docs/DECISIONS.md` (outranks the PRD), `CLAUDE.md`, `NEXT.md`.

**Still offline.** No HubSpot, Google, n8n or Anthropic call. Every external node is exercised against in-memory fakes by `test/n8n-sim.js`, which executes `workflow.json` itself (N7's pattern, `meeting-follow-up/test/n8n-sim.js`).

## Exit criteria

1. `npm ci && npm run gate` green locally and in CI.
2. `test/n8n-sim.js` runs `workflow.json` for all 20 golden weeks plus E01-truncated and reproduces each PRD §9 outcome, reason, flags, model-call count, Doc/draft create-or-update and ledger row exactly as the Phase 1 step harness does.
3. AC-02, AC-10 and AC-15 pass: the simulator's request log shows only GETs to `api.hubapi.com`, no `/send` path, and a HubSpot or Sheets read failing three times gives no model call, no Doc, no draft, an `errors` row and status `failed`.
4. `docs/SETUP.md` written; every item in PRD §14 "Not verified" either checked against vendor documentation (a D-row each, with the doc page named) or left listed.
5. `NEXT.md` updated; `docs/PHASE-3-PLAN.md` written and left for review.

## Work

1. **HubSpot reads (D-025, D-040).** Replace the single GET per object with paged reads (`after` cursor) up to `hubspotMaxPages`, using n8n's HTTP Request pagination or a small loop; deals filtered to `pipelineId` server-side if the list endpoint allows it, else in `hubspot.js` (already done). Confirm from HubSpot's docs: page size with `propertiesWithHistory`, the tasks read scope, `hs_timestamp` as due date, `notes_last_updated` semantics, `closedate` time-of-day and portal time zone (PRD §14). Each read retries 3 times (`retryOnFail`, `maxTries: 3`).
2. **Sheets reads.** `values.get` for `weekly`, `definitions` and the ledger with `valueRenderOption=FORMATTED_VALUE` (already in the skeleton); a missing tab is `sheet_error`, not a crash.
3. **Anthropic.** HTTP Request to `/v1/messages` with the `anthropic-version` header and the body from `Compute`; `onError: continueRegularOutput` so a failure becomes `model_error`; record `usage` from the response into the ledger (replacing the Phase 1 estimate).
4. **Drive.** Multipart upload with conversion to a Google Doc in `pulseFolderId`; `files.update` by id on a re-run; a 404 on update recreates the Doc (D-017). Check how Drive converts the HTML table; keep the HTML simple.
5. **Gmail.** Gmail node Create draft (no auto-retry); `PUT drafts/{id}` with `message.raw` (RFC 822, base64url, built in a Code node) for updates; a 404 on update sets `draft_state = gone` and is not recreated (D-017).
6. **Ledger and errors.** Append with `INSERT_ROWS`; Error Trigger → `errors` row, plus the optional throttled webhook line (D-018). Never an email node.
7. **`test/n8n-sim.js`.** A minimal executor for the node types in `workflow.json` (triggers, Code, IF, HTTP Request, Gmail) with fakes keyed by URL and method, failure injection (`hubspotFailures`, `sheetFailures`, `driveFailures`, `gmailGone`), and a request log. Extend `test/workflow.test.js` to run it per golden week and compare with `test/harness.js`.
8. **`docs/SETUP.md`.** Import; the four credentials and their minimum scopes (D-021: `hubspot-demo-readonly` read-only); the Pulse folder; the two sheets with headers (`weekly`: `week_start` formatted as plain text, `revenue_usd`, `cash_usd`; `definitions`; ledger `runs` with the 16 columns; `errors` with 4); config fields; that the schedule ships off.

## Open items carried from Phase 1 (Shane to decide; defaults stand)

- D-055: keep the two added checks (`link`, `placeholder`)?
- D-065: widen the word lists with inflections ("recommends", "rises", "dropping")? That is a prompt-version bump (`narrate-v0.2`) and new variants.
- Draft body: the email has no unsubscribe or footer; it is a draft to the owner only.

## Not in Phase 2

Seeding the demo portal and sheet, the live run, `docs/DEMO.md`, `docs/EVAL.md`, `docs/ACCEPTANCE.md` (Phase 3, with Shane's hand steps).
