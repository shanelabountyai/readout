# Setup: import N3 into your self-hosted n8n

**These are Phase 3 hand steps for Shane. Nothing here has been done yet.** `workflow.json` has only been executed offline by `test/n8n-sim.js` against in-memory fakes; it has never been imported into a live n8n. Demo data only (Tallgrass Advisory, `.example` domains). Never paste a key into a file in this repo: credentials live in n8n's credential store.

Node parameters follow the node source of `n8n-nodes-base` 2.49.8 (D-072). If your n8n is older, the import may show a node as needing an update; check the HubSpot, Anthropic, Drive and Gmail nodes after import.

## 1. n8n requirements

- The Code nodes use `Intl` time-zone data (`America/Chicago`) for the report week. Stock Node.js 22 ships full ICU; if your n8n runs on a Node build without it, the week would be wrong. Not verified on your n8n (PRD §14).
- No builtin modules are required (`NODE_FUNCTION_ALLOW_BUILTIN` can stay as it is): the bundled code uses no `require` of Node modules.

## 2. Google Drive folder and the two sheets

1. Create a Drive folder `Pulse` (any drive the `google-drive-lab` account can write to). Copy its id from the URL.
2. Create a Google Sheet **`N3 weekly numbers`** with two tabs:
   - `weekly`, row 1: `week_start`, `revenue_usd`, `cash_usd` (columns A–C; up to 5 extra columns may follow, declared in `definitions`). Format column A as **Plain text** before typing dates (`2026-11-16`); a date-formatted cell is read as `sheet_invalid` (D-047). Dollars may be typed as `46000`, `46,000` or `$46,000.00`.
   - `definitions`, row 1: `key`, `label`, `unit` (`usd` or `count`). Leave it with the header only unless you add extra metrics.
3. Create a Google Sheet **`N3 ledger`** with two tabs:
   - `runs`, row 1 (16 columns, A–P): `run_id, week_start, status, reason, flags, doc_id, draft_id, draft_state, prompt_version, model, model_calls, input_tokens, output_tokens, cost_usd, runtime_s, run_at`
   - `errors`, row 1 (4 columns, A–D): `run_at, run_id, node, reason`
   The ledger holds ids, codes, token counts, cost and timestamps only (D-018); nothing else is ever written to it.

## 3. Credentials (create in the editor; names exact)

| Name | n8n type | Minimum access |
|---|---|---|
| `google-drive-lab` | Google Drive OAuth2 API | n8n's default scopes for this type are `drive`, `drive.appdata`, `drive.photos.readonly` (read from the credential source, D-072). The Sheets calls use the same credential: Google's `spreadsheets.values.get` reference lists `https://www.googleapis.com/auth/drive` among the accepted scopes (D-077). The account must see the `Pulse` folder and both sheets. |
| `gmail-lab` | Gmail OAuth2 | the **owner's own** mailbox (drafts are created there). It can send; the workflow never asks it to: there is no send node and no `/send` call. |
| `hubspot-demo-readonly` | HubSpot App Token | a **new** read-only key on the demo portal with `crm.objects.deals.read` and `crm.objects.contacts.read`, plus the read scope HubSpot requires for tasks. **The tasks scope is not verified** (HubSpot's tasks guide did not show its scopes section to this run, D-077): if `Read HubSpot tasks` fails with 403, add the read scope HubSpot's error names. Add no write scope. Do not reuse N7's `hubspot-demo` key (it can write notes, D-021). |
| `anthropic-lab` | Anthropic API | an API key. The credential adds only `x-api-key`; the node adds `anthropic-version: 2023-06-01` itself. |

Google OAuth apps in Testing mode lapse every 7 days while n8n still shows "connected" (N1 lesson). Reconnect before a demo.

## 4. Import and map

```bash
n8n import:workflow --input=workflow.json     # with n8n stopped
```

or Import from File in the editor. Then open the workflow:

1. Each red credential: pick the credential from step 3 (the export carries placeholder ids `map-on-import-...`).
2. Open the **`config`** node, the only account-specific node, and replace every `REPLACE_WITH_` value:

| Field | Value |
|---|---|
| `pulseFolderId` | the `Pulse` folder id |
| `inputSheetId` | the `N3 weekly numbers` sheet id (`inputTab` / `definitionsTab` stay `weekly` / `definitions`) |
| `ledgerSheetId` | the `N3 ledger` sheet id (`ledgerTab` / `errorsTab` stay `runs` / `errors`) |
| `ownerEmail` | the owner address the draft is addressed to. With `demoMode: true` it must end in `.example` or no draft is made (D-016) — for a real mailbox test, that is the point at which you decide on `demoMode` |
| `firmName`, `revenueLabel` | as you want them on the page |
| `pipelineId`, `wonStages`, `lostStages` | `default`, `["closedwon"]`, `["closedlost"]` for HubSpot's default pipeline |
| `hubspotMaxPages` | 20 or lower. The HTTP nodes' "Max Pages" is fixed at 20 by the build (n8n does not accept an expression there, D-072); a lower value here takes effect, a higher one does not |
| `model` | the Anthropic model id as your console lists it (default `claude-sonnet-5-5`, D-020) |
| `weeklyCallCap`, `perRunTokenCeiling`, `weeklySpendCapUsd` | 3 / 20000 / 1.00 unless you want otherwise (defaults, not measurements, D-019) |
| `priceInputPerMTokUsd`, `priceOutputPerMTokUsd` | current USD prices per million tokens; left `null`, the ledger logs tokens but no cost and the dollar cap is off |
| `alertWebhookUrl` | optional Slack-style incoming webhook for one line per failure (codes only, at most one per 15 minutes); empty = `errors` tab only |

## 5. Error workflow (set it after import)

Open **Workflow Settings → Error workflow** and choose **this workflow itself**. The export does not carry it, because the editor import assigns a new id and a stale id would point nowhere (D-073). The Error Trigger then feeds the same `config` node, so a crash the main path did not catch leaves an `errors` row and a `failed` ledger row.

Leave "Save successful production executions" off (the export sets `saveDataSuccessExecution: none`, D-029): CRM data would otherwise sit in execution history.

## 6. Leave it inactive; first run by hand

The workflow ships **inactive** (`"active": false`). Use *Execute workflow* (the `Manual` trigger). To rebuild a past week, set `weekStartOverride` in `config` to its Monday (`2026-11-16`) and clear it afterwards. Turn the Monday 10:00 America/Chicago schedule on only when you decide to.

After the first run, check: one Doc in `Pulse`, one draft in the owner's Drafts (nothing in Sent), one row in `runs`. A second run of the same week updates the same Doc and draft and adds a second row (AC-11).

## What stays unverified until the live run

PRD §14 and `docs/DECISIONS.md` D-077 list them: the HubSpot tasks scope and page size with `propertiesWithHistory`, `closedate` time of day, how Drive renders the page's table, `FORMATTED_VALUE` strings for currency-formatted cells, `Intl` in your n8n, and the node shapes on your n8n version.
