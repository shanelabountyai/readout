# Next

**Open: Shane reviews `docs/PHASE-2-PLAN.md` and the "Decisions for Shane to confirm" in the Phase 1 PR.** Do not start Phase 2 wiring until the Phase 1 PR is merged and the plan is reviewed (phase gate).

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

D-051 to D-068 in `docs/DECISIONS.md` (the merge call, if any, is the next row). Two need Shane: **D-055** adds `link` and `placeholder` checks after the PRD's eleven; **D-068** keeps the PRD's literal percentage on a negative base.

### Independent review

1 MUST-FIX (hyphen-joined words escaped the word checks), fixed; 10 SHOULD-FIX, 8 fixed (D-066, D-067), 2 left: the workflow error path's ledger row / `$('config')` / `errorWorkflow` id (Phase 2, item 6) and percentages on a negative base (D-068).

### Left open for Phase 2

- Paging, retries, real node parameters for HubSpot, Sheets, Anthropic, Drive, Gmail; `test/n8n-sim.js`; `docs/SETUP.md` (see `docs/PHASE-2-PLAN.md`).
- AC-02 and AC-10 are only structural so far (the skeleton's HubSpot nodes are GETs); AC-15's three tries are a Phase 2 node setting (Phase 1's fake reports the final failure).
- PRD §14 "Not verified" is unchanged: nothing about HubSpot, Google, n8n or the model was checked against a live system.

### Could not run in the cloud

- Nothing needed the network beyond `npm install` from the npm registry, which worked. No live n8n, HubSpot, Google or Anthropic call was made or attempted. Not deployed; not imported into any n8n.
