# readout

Weekly Business Pulse (N3): an n8n workflow that drafts a one-page weekly read of the business. Work in progress; see the pull requests.

Once a week it reads HubSpot (read-only) and a small Google Sheet of numbers typed in by hand, computes the week's numbers and their comparisons with last week and the 4-week average **in code**, asks Claude for a short narrative about those numbers, checks that every number it states is one of the computed ones, and leaves a Google Doc in Drive plus a Gmail **draft** to the owner. No CRM writes; no send node.

- Automation track, same spine as [speed-to-lead (N1)](https://github.com/shanelabountyai/speed-to-lead), [crm-hygiene (N2)](https://github.com/shanelabountyai/crm-hygiene) and [meeting-follow-up (N7)](https://github.com/shanelabountyai/meeting-follow-up): self-hosted n8n, Google, HubSpot, Claude. QuickBooks is out of scope for now.
- Demo firm: Tallgrass Advisory (fictional). Synthetic data only; `.example` domains; no real people.
- **Status: specified, not built.** Not deployed and not imported into any live n8n; it will ship inactive.

| Doc | What |
|---|---|
| `docs/prd-readout.md` | the PRD, with 20 worked golden weeks (invented figures) |
| `docs/DECISIONS.md` | every judgment call, D-001 onward |
| `docs/IMPLEMENTATION_PLAN.md` | phases and gates |
| `docs/PHASE-1-PLAN.md` | the Phase 1 build: modules, tests, exit criteria |
| `fixtures/README.md` | the golden weeks Phase 1 writes first |
| `CLAUDE.md`, `NEXT.md` | rules and session state for Claude sessions |
