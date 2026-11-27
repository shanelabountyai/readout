# Next

**Open: build Phase 1** from `docs/PHASE-1-PLAN.md` on a new branch `phase-1` cut from `main`. Fixtures first. Stop at the Phase 1 gate: open a PR, update this file, write `docs/PHASE-2-PLAN.md`.

## 2026-11-26 — PRD and kickoff kit (unattended run, docs only)

### Written (branch `prd`)

- `docs/prd-readout.md` — problem, users, the 13-step workflow, metrics and comparisons, flags, narrative contract and its 11 ordered checks, output, 17 acceptance criteria, **20 worked golden weeks** plus the full E01 fact table (all figures invented), safety rails, non-goals, 9 open questions with defaults, 3-phase plan, Not verified.
- `docs/DECISIONS.md` — D-001 to D-050 (D-036 to D-050 came from the independent review).
- `docs/IMPLEMENTATION_PLAN.md`, `docs/PHASE-1-PLAN.md` (modules, inputs, outputs, invariants, tests; `package.json` and devDependency versions copied from N7 at `59d0374`).
- `CLAUDE.md`, `fixtures/README.md`, `README.md`.
- An independent review (fresh agent, PRD and plans only): 17 MUST-FIX, all fixed; 34 SHOULD-FIX, most fixed, the rest listed in the PR. It recomputed every worked-example number and found the arithmetic right.

### Not done / not verifiable from this run

- No code, no `package.json`, no CI yet (Phase 1).
- HubSpot, Google and n8n details listed in PRD §14 (Not verified). Phase 2 checks them and records D-rows.
- Drive HTML-to-Google-Doc conversion quality and the `Intl` time-zone data in Shane's n8n build: Phase 2.
- Nothing imported into n8n; nothing run against any live account. Not deployed.

### Shane's steps (none needed before Phase 1)

1. Answer "Decisions for Shane to confirm" in the PR when convenient (each default stands until changed).
2. Later (Phase 3): import, credentials (`hubspot-demo-readonly` is new and read-only), seed the demo portal and sheet, one manual run, Gmail audit.
