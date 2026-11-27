# rules/

`stale.json` is copied verbatim from N2 `crm-hygiene/rules/stale.json` (as written out in `docs/PHASE-1-PLAN.md`): per-stage `max_idle_days` for HubSpot's default pipeline. A deal is stalled when its whole idle days are **strictly greater** than its stage's limit (D-015). N3 measures idle from the later of `notes_last_updated` and the latest `dealstage` history entry (D-041), which departs from N2. An open stage not in this file is never stalled and is named once in Data notes.
