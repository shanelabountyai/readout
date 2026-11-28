# Phase 3 plan — demo, eval, closeout

Written at the Phase 2 gate (2026-11-27, unattended run) **for Shane's review. Do not start Phase 3 until the Phase 2 PR is merged and this plan is reviewed.** Read first: `docs/prd-readout.md`, `docs/DECISIONS.md` (outranks the PRD), `CLAUDE.md`, `NEXT.md`, `docs/SETUP.md`.

Phase 3 has two halves. The **cloud half** (a Claude run) writes seed data and documents and stays offline. The **hand half** (Shane) imports, connects and runs once. Nothing in Phase 3 turns the schedule on, and no document may call N3 live, launched or in production; after Shane's run the honest words are "run once by hand on a demo portal".

## Exit criteria

1. `npm ci && npm run gate` and `npm run eval` green locally and in CI (still offline).
2. Seed files exist and a test proves that loading them into the simulator's fakes reproduces E01's expected facts exactly (so the live page can be compared with a known answer).
3. `docs/DEMO.md`, `docs/EVAL.md` and `docs/ACCEPTANCE.md` written; ACCEPTANCE lists AC-01 to AC-17 with offline evidence (test name) and live evidence, and every live item says **not run** until Shane's run is recorded.
4. README status line says "built and tested offline"; nothing claims a live run that is not recorded.
5. `NEXT.md` updated with Shane's hand steps, each starting "You:".

## Work (cloud half)

1. **Seed data.** `fixtures/seed/hubspot-seed.json`: the E01 baseline as importable records (`[demo]` deals with the stage sequence, `.example` contacts, `[demo]` tasks), with a note that HubSpot assigns new ids and that stage-history timestamps cannot be back-dated by import (so the live "moved" and "created" counts for past weeks will differ from E01 unless the portal was built over those weeks; EVAL says so). `fixtures/seed/weekly.csv` and `definitions.csv` for the sheet (`week_start` as plain text). A test loads the seed into `test/n8n-sim.js` fakes with fixed timestamps and checks E01's facts.
2. **`docs/DEMO.md` (about 5 minutes):** empty `Pulse` folder → manual run → the Doc → the draft in Drafts (nothing in Sent) → an E09-style rejection shown as "Narrative withheld" (by typing revenue `30000` for the week) → a re-run updates the same Doc and draft.
3. **`docs/EVAL.md`:** the offline table from `npm run eval` (recorded stand-ins, **not model output**) and the 21/21 simulator replay; a blank section for Shane's live run (status, reason, model calls, tokens from the ledger row); runtime and cost labelled "not measured" until a ledger row exists.
4. **`docs/ACCEPTANCE.md`:** one row per AC; AC-17 and the live halves of AC-10 (credential scopes) "not run".
5. **PRD §14 follow-ups** that need the live portal, written as a checklist for the run: tasks read scope (does `Read HubSpot tasks` 403?), deals page size with history (pages read vs records), `closedate` time of day on a won deal set by the date picker, Drive's rendering of the Numbers table, whether a manual run that crashes in a Code node leaves an `errors` row (the error workflow), `FORMATTED_VALUE` for a currency-formatted cell, the `Intl` week on Shane's n8n.
6. **Known gaps from the Phase 2 review (D-079), to settle with Shane:** whether the error workflow runs on manual executions (SETUP §5); a Doc moved to the Drive trash is probably still updatable by id, so it would be "updated" rather than recreated (check `trashed` on update); a ledger append that fails after the Doc and draft were created loses their ids, so the next run would create a second Doc and draft; the ledger's id rule (must contain a digit) could refuse a real Drive or Gmail id with no digit and crash `Record` after the writes.
7. Optional, only with a D-row: the D-073 gap (a crash after the Doc is created loses its id) could be closed by writing the Doc id to the ledger before the draft step; that would be two ledger rows per run and changes AC-11's row count, so it is a decision for Shane, not a default.

## Hand half (Shane; never done by a cloud run)

- You: follow `docs/SETUP.md` (folder, two sheets, four credentials, import, `config`, error workflow).
- You: seed the demo portal and the sheet from `fixtures/seed/`.
- You: one manual run; check one Doc, one draft (Drafts only, Gmail Sent empty), one `runs` row; paste the ledger row (ids and codes only) into `NEXT.md` or the PR.
- You: one re-run of the same week; check the same Doc and draft ids and a second `runs` row.
- You: answer the PRD §14 checklist from that run.

## Not in Phase 3

Turning the schedule on; any real business data; QuickBooks; prompt changes (a change bumps `narrate-vX.Y` and needs new variants).
