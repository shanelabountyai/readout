# N3 Weekly Business Pulse (`readout`) — rules for Claude sessions

## First move

Read `NEXT.md`. It names what to pick up. If it has no open item, say so and stop. Then read `docs/prd-readout.md` (what), `docs/DECISIONS.md` (every call so far; **outranks the PRD** where they differ) and the current phase plan (`docs/PHASE-1-PLAN.md` until Phase 1 closes).

## What this is

An n8n workflow in the Automation track, on the same spine as N1 `speed-to-lead`, N2 `crm-hygiene` and N7 `meeting-follow-up` (self-hosted n8n, Google, HubSpot, Claude). Once a week it reads HubSpot (read-only) and a hand-entered Google Sheet, computes the week's numbers and comparisons in code, has Claude write a short narrative, checks it, and leaves a Google Doc plus a Gmail **draft** to the owner. A demo-only portfolio piece for the fictional Tallgrass Advisory.

## Status words

It is **not deployed and not imported into a live n8n**. Never call it live, launched, running, in production or used by anyone. Until Shane does a live run and records it, the honest words are "built and tested offline" (after Phase 1/2) or "specified" (now).

## Architecture rules

- **Logic lives in `src/`**, pure CommonJS, no runtime dependencies (it runs inside n8n Code nodes). Time is passed in, never read (`Date.now()` and argument-less `new Date()` are banned in `src/`).
- **Never hand-edit `workflow.json`.** Change `src/`, `prompts/`, `config/` or `scripts/build-workflow.js`, then `npm run build`. `npm run check` fails on drift.
- **`config` is the only account-specific node.** Nothing else holds an id, address or domain of Shane's accounts.
- **Integers only for money and comparisons** (cents; `sum4 / 4` rationals; one half-away-from-zero rounding per displayed value). No `parseFloat`, `toFixed` or float money.
- **Code computes; the model writes; code checks.** The model never adds, averages, compares or sees raw CRM records, contact names, emails or task text. Every number it writes must match a fact it cites (PRD §6). Never loosen a check to get a narrative through.
- **Prompt changes bump the version** in `prompts/narrate.md` (`narrate-vX.Y`); the version goes in every ledger row.

## Safety rails (product requirements, tested)

- **No send node.** The Gmail node is Create draft; drafts are updated by HTTP `PUT drafts/{id}`. Never add a send, reply or forward node, an SMTP/email-send node, or an HTTP call to a `/send` path. Never claim the credential "can't send": it can; the workflow never asks it to.
- **Zero CRM writes.** Every HubSpot call is a GET. No notes, tasks, properties, associations, deals or contacts written. The HubSpot credential is a read-only key (D-021).
- **The draft goes to `ownerEmail` only**, and in demo mode only if it ends in `.example`.
- **The ledger holds no business data**: ids, fixed codes, token and call counts, cost, runtime, timestamps. `src/ledger.js` refuses anything else.
- **No email alerts.** Errors go to the `errors` tab and an optional webhook.
- **Spend:** weekly call cap, per-run token ceiling, weekly dollar cap once prices are set; checked before any model call.
- **Ships inactive** (`"active": false`). Shane turns the schedule on.

## Honesty rules

- **Never invent a number.** Every figure in docs is either computed by a test or run you did (say which), or labelled illustrative / "target, not measured". The PRD's worked-example figures are invented and say so.
- **No testimonials, quotes, customer names, user counts, or claims of results.** Nobody has used this.
- **Synthetic data only:** invented people and companies, `.example` domains (and `.test` only for "outside the demo set" records). Never real names, companies, emails or financials. Never read Shane's real HubSpot, Gmail or Drive.
- **Recorded stand-ins are not model output.** Offline scores come from hand-written responses; never present them as model accuracy.
- **Expected values come from PRD §9, by hand.** If the engine disagrees, stop and show both derivations in `NEXT.md`. Never edit an expected value, delete, skip or weaken a test to get green.

## Working rules

- Fixtures first, then the module, then its tests (order in the phase plan).
- Small commits naming specific files (never `git add -A`). Branch + PR. Readout PRs may be merged when green under Shane's rule (D-003); otherwise leave them for review. Never force-push, never squash or rebase-merge, never delete a branch.
- **Ask before adding a dependency** (beyond N7's `ajv`, `eslint`, `@eslint/js`, `globals`): record a D-row; no date library, CSV parser, HTTP client or state-machine library.
- Every judgment call is the next D-row in `docs/DECISIONS.md` with date and author; never renumber or reverse a confirmed row.
- Phase gate: do not start Phase N+1 while Phase N's exit criteria fail; write the next phase's plan at the gate and stop.
- No deploys, accounts, env vars or secrets. `.env.example` holds variable names only. Never commit n8n credential exports.
- End each session by updating `NEXT.md`: built, decided, left open, gate output (test count), and what could not run in the cloud.

## Git

- Gate before every push: `npm run gate` (once Phase 1 has created it).
- CI decides; a local run that could not happen (no network for `npm ci`, say) is recorded in `NEXT.md`.
