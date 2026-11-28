# Next

**Open: Shane reviews `docs/PHASE-3-PLAN.md` and the Phase 2 PR ("readout: Phase 2 (n8n wiring + simulator)").** Do not start Phase 3 until the Phase 2 PR is merged and the plan is reviewed (phase gate). The SETUP hand steps are Phase 3 and have not been done.

## 2026-11-27 — Phase 2 (unattended run, branch `phase-2`, on Shane's "go on defaults")

### Built

- `workflow.json` wired (from `scripts/build-workflow.js`; never hand-edited): HubSpot paged GETs (`after` cursor, Max Pages 20, deals 50 a page with `dealstage` history); Sheets `values.get` for the ledger, `weekly`, `definitions`; every read 3 tries then an error item routed to a `failed` run; Anthropic `POST /v1/messages` with `anthropic-version`, one try, `model_error` path, usage into the ledger; Drive multipart create into `Pulse` / `PATCH` update by id / 404 recreates; Gmail node Create draft (one try) / `PUT drafts/{id}` with an RFC 822 `raw` / 404 = `gone`; ledger append, `errors` row, optional throttled webhook; Error Trigger feeds `config` (D-073); `errorWorkflow` removed from the export (set after import).
- `src/mime.js` (pure UTF-8/base64, RFC 822 message, Drive multipart); new steps in `src/steps.js` (`sourceFailure`, `docBodies`, `docOutcome`, `draftAction`, `finish`, `errorRun`, `afterLedger`); `hubspot.fromPagedRead`; ledger reason `unknown_error`.
- `test/n8n-sim.js` (executes `workflow.json` against in-memory fakes, with failure injection and a request log), `test/simrun.js`, sim tests in `test/workflow.test.js`, `test/mime.test.js`, `test/wiring.test.js`; `npm run eval` also replays the golden weeks through the simulator.
- `docs/SETUP.md`, `docs/PHASE-3-PLAN.md` (for review).

### Gate output (local, Node v22.23.5, npm 10.9.9)

- `npm ci`: ok. `npm run gate`: lint clean; `check`: workflow.json and fixtures (69 files) up to date; **200 tests, 200 pass, 0 fail**.
- `npm run eval`: 21/21 golden weeks match their expected files; 7/7 check variants; **21/21 golden weeks replayed through `workflow.json` by `test/n8n-sim.js` give the same ledger row, outcome, reason and model calls** as the step harness.
- `npm run build` then `npm run check`: no drift.
- CI: see the PR (recorded there after the push).

### Decided

D-070 to D-079 in `docs/DECISIONS.md`. D-079 records the independent review: 2 MUST-FIX (both fixed), 6 SHOULD-FIX (3 fixed, rest listed in the PR and PHASE-3-PLAN item 6).

### Left open

- PRD §14 items that need the live portal (D-077 lists which were checked against vendor docs and which remain): tasks read scope, page size with history, `closedate`, `notes_last_updated`, `FORMATTED_VALUE`, Drive HTML rendering, `Intl` and node shapes on Shane's n8n.
- Review gaps in D-079: error workflow on manual runs; trashed Doc; failed ledger append after creates; id-with-no-digit refusal; throttle stamped before the POST; retry mechanism modelled, not verified.

### Could not run in the cloud

- No live n8n, HubSpot, Google or Anthropic call was made or attempted; nothing imported or deployed; schedule ships off. Network use: npm registry (`npm ci`; `npm pack` of `n8n-nodes-base` and `@n8n/n8n-nodes-langchain` 2.49.8 into a scratch folder to read node source, not added as dependencies), a read-only clone of N7 for its simulator, and vendor documentation pages read for D-077.

## 2026-11-27 — Phase 1 (unattended run, branch `kickoff`)

### Built

- Scaffold mirroring N7 at `59d0374`: `package.json` (no runtime dependencies; devDependencies `ajv`, `eslint`, `@eslint/js`, `globals` only), eslint flat config, `.github/workflows/ci.yml` (`gate`: `npm ci`, `npm run gate`, `npm run eval` on pull requests and pushes to `main`), `config/config.template.json`, `rules/stale.json` (N2's, verbatim), `.env.example` (names only).
- `src/` (pure CommonJS, 17 modules): `num`, `week`, `hubspot`, `sheet`, `metrics`, `compare`, `flags`, `facts`, `prompt`, `schema`, `checks`, `template`, `doc`, `email`, `ledger`, `spend`, `steps`.
- `prompts/narrate.md` (`narrate-v0.1`) and `prompts/narrate.schema.json` (the `write_pulse` tool input).
- Fixtures: 20 golden weeks (PRD §9) + `E01-truncated` + 7 check variants; `expected/*.json` typed by hand in `fixtures/spec.js` from PRD §9; recorded stand-ins are hand-written, **not model output**.
- `scripts/build-workflow.js` → `workflow.json`: an inactive skeleton (Code nodes inline `src/`; external nodes are placeholders marked Phase 2); `scripts/eval.js`.

### Gate output (local, Node v22.23.5, npm 10.9.9)

- `npm ci`: ok. `npm run gate`: lint clean, `check` (workflow.json and fixtures up to date), **143 tests, 143 pass, 0 fail** (after the review fixes).
- `npm run eval`: 21/21 golden weeks (incl. E01-truncated) match their expected files; 7/7 check variants give their reason.
- Engine and expected files agreed on every week on the first run; no PRD value had to be questioned.

### Decided

D-051 to D-069 in `docs/DECISIONS.md` (D-069 records the merge call). Two need Shane: **D-055** adds `link` and `placeholder` checks after the PRD's eleven; **D-068** keeps the PRD's literal percentage on a negative base.

### Independent review

1 MUST-FIX (hyphen-joined words escaped the word checks), fixed; 10 SHOULD-FIX, 8 fixed (D-066, D-067), 2 left: the workflow error path's ledger row / `$('config')` / `errorWorkflow` id (Phase 2, item 6) and percentages on a negative base (D-068).

### Left open for Phase 2

- Paging, retries, real node parameters for HubSpot, Sheets, Anthropic, Drive, Gmail; `test/n8n-sim.js`; `docs/SETUP.md` (see `docs/PHASE-2-PLAN.md`).
- AC-02 and AC-10 are only structural so far (the skeleton's HubSpot nodes are GETs); AC-15's three tries are a Phase 2 node setting (Phase 1's fake reports the final failure).
- PRD §14 "Not verified" is unchanged: nothing about HubSpot, Google, n8n or the model was checked against a live system.

### Could not run in the cloud

- Nothing needed the network beyond `npm install` from the npm registry, which worked. No live n8n, HubSpot, Google or Anthropic call was made or attempted. Not deployed; not imported into any n8n.
