# N3 Weekly Business Pulse (`readout`) — PRD v0.1

2026-11-26 · drafted for Shane LaBounty by an unattended Claude run (judgment calls in `docs/DECISIONS.md`, D-001 onward)

N3 is an Automation-track n8n workflow. Once a week it reads the CRM (HubSpot, read-only) and a small Google Sheet of numbers the owner types in by hand, computes the week's numbers and their comparisons **in code**, asks Claude for one short narrative about those numbers, checks that narrative against them, and leaves a one-page Google Doc in Drive plus a Gmail **draft** to the owner. It writes nothing to the CRM and sends nothing.

It is a **demo-only portfolio piece** on the same spine as N1 Speed-to-Lead, N2 CRM Hygiene and N7 Meeting Follow-Up: self-hosted n8n, Google, HubSpot, Claude. It runs on synthetic data for the fictional firm **Tallgrass Advisory** (`.example` domains, invented people and companies). It is **not deployed and not imported into a live n8n**; it ships inactive. QuickBooks is out of scope for now.

**Every number in this document is illustrative synthetic data**, invented for the worked examples. None is a measurement, a benchmark or a claim about any real business.

## 1. Problem

An owner of a small services firm who wants to know how last week went opens five tabs: the CRM's deal board, the CRM's contacts list, the task list, the bank or accounting app, and whatever spreadsheet holds the numbers the CRM does not have. Then they do arithmetic in their head against a vague memory of last month. It takes long enough that it gets skipped, and the week it gets skipped is the week a deal goes quiet or cash dips.

What is missing is not a dashboard (they have tabs) but a short, trustworthy written read: what changed, against what, and what needs a look. The trust part is the hard part. A model that writes "revenue jumped 30%" when it moved 10% is worse than no summary at all, so the numbers must come from code and the model must be held to them.

## 2. Users

| User | What they want from the Monday read | What would make them stop reading it |
|---|---|---|
| **Owner** (primary; receives the draft) | Two minutes on Monday morning: how the week went against last week and the recent norm, and the one or two things to look at. | A number that turns out wrong; advice presented as if it were a finding. |
| **Ops lead** | The same page as the owner, so the Monday conversation starts from one set of numbers; the stalled deals by name and the overdue tasks as a count (task text never leaves HubSpot, D-032). | Counts that do not reconcile with the CRM when they check. |
| **Advisor** (accountant, fractional CFO, board friend) reading a forwarded copy | Plain definitions: what "moved" or "stalled" means, where each number came from, what was not entered. | Unlabelled figures; gaps hidden instead of named. |

The draft is created in the Drafts folder of the `gmail-lab` mailbox, which must be the owner's own mailbox, addressed to the owner; nothing lands in an inbox until someone presses Send. The owner decides whether to share the Doc or forward the email.

## 3. What it does, step by step

1. **Trigger.** A Schedule node, Mondays 10:00 America/Chicago (D-005: late enough for the owner to have typed last week's numbers; a later re-run updates the same page), plus a manual trigger. Ships inactive (`"active": false`); Shane turns it on. A manual run may set `weekStartOverride` in the `config` node to rebuild a past week.
2. **Report week.** The most recent complete week, Monday 00:00 to the next Monday 00:00 in the configured time zone, half-open `[start, end)` (D-005). The run also builds the four weeks before it (the comparison window): five weeks in all.
3. **Ledger and spend gate.** Read the `runs` tab of the ledger sheet. Find the latest row for this report week (its Doc id and draft id, for update in place). Count model calls already made in the calendar week (Monday 00:00 to Monday 00:00 in the configured zone) that contains the run. If the weekly call cap or dollar cap is already reached, note it now; the token ceiling is checked in step 9 once the prompt exists (D-019).
4. **Read HubSpot (read-only).** Deals in the configured pipeline with `dealstage` history, contacts, tasks (requesting the properties each rule needs), by paged list calls (D-025, D-040). Apply the demo guard (D-016). No write call of any kind exists in the workflow.
5. **Read the weekly sheet.** The `weekly` tab (one row per week: `week_start`, `revenue_usd`, `cash_usd`, optional extra columns declared in `definitions`) (D-024).
6. **Compute metrics** for all five weeks, then **comparisons** for the report week: last week, the 4-week average, the difference from each, and the percentage change from each. Integer arithmetic only (D-006).
7. **Compute flags** (stalled deals, overdue tasks, revenue swing, cash drop, quiet week, data gaps) from fixed rules and thresholds held as config (D-028).
8. **Build the fact table**: every number the page will show, each with an id, a type (count, money, percentage), its exact rendering, and its sign.
9. **Narrative.**
   - Quiet week (D-013): no model call; a code template writes the narrative.
   - Otherwise: **one** model call (HTTP Request to the Anthropic Messages API with a forced tool, the N7 pattern) that receives only the fact table, the flags and the names of stalled deals (D-007). Before the call, the full spend gate runs (call cap, dollar cap, token ceiling on the built prompt); over any of them there is no call and the page is `metrics_only`. The model returns a headline, one to four paragraphs each listing the fact ids it cites, and up to three suggestions.
10. **Check the narrative** in code (§6). Pass → the narrative is used. Fail → no retry; the page is built with the code-written metrics, a code-written headline and a plain-words line "Narrative withheld: <reason in words>" (status `metrics_only`, D-012). On a `metrics_only` or `failed` path no model text appears anywhere, in the Doc or the draft.
11. **Write the Google Doc** in the `Pulse` folder (create, or update the same Doc by id on a re-run) (D-017).
12. **Write the Gmail draft** to the owner (create, or update the same draft by id). There is no send node.
13. **Append a ledger row** (ids, codes, token counts, cost, runtime; never business data) (D-018). On an unhandled error: an `errors` tab row and an optional webhook line, never an email.

**Outputs per run:** one Google Doc (created or updated), one Gmail draft (created or updated), one appended ledger row. Nothing else.

## 4. Metrics

All money is held as integer cents and shown as whole dollars. "In the week" means the timestamp falls in `[start, end)`.

| Key | Metric | Source and rule | History? |
|---|---|---|---|
| `deals_created` | Deals created | deals with `createdate` in the week | yes (recomputed each run) |
| `deals_moved` | Deals moved | distinct deals with at least one `dealstage` history entry in the week whose value is an open stage **and differs from the entry before it**, not counting the deal's first (creation) entry (D-022) | yes |
| `deals_won` | Deals won | deals now in a `wonStages` stage with `closedate` in the week (D-023; `closedate` reliability is a Phase 2 check, see Not verified) | yes |
| `won_amount` | Won value | sum of `amount` of those deals; a missing amount counts 0 and the number of such deals is shown in Data notes | yes |
| `deals_lost` | Deals lost | deals in a `lostStages` stage with `closedate` in the week | yes |
| `new_contacts` | New contacts | contacts with `createdate` in the week | yes |
| `revenue` | Revenue | sheet `revenue_usd` for the week (whatever the owner counts as revenue; the label shown comes from config `revenueLabel`, default "Revenue (as entered)") | yes, from the sheet |
| `cash` | Cash at week end | sheet `cash_usd` for the week | yes, from the sheet |
| `x_<key>` | Up to 5 extra sheet metrics | declared in `definitions` (key, label, unit `usd` or `count`) | yes, from the sheet |
| `open_pipeline` | Open pipeline | sum of `amount` of deals not in a won or lost stage, **as of the run**; a missing amount counts 0 and is counted in Data notes | **no** (snapshot) |
| `stalled_deals` | Stalled deals | open deals idle longer than their stage's `max_idle_days` in `rules/stale.json` (copied from N2), idle measured from the later of `notes_last_updated` and the deal's latest `dealstage` history entry (else `createdate`) to the week end, whole days, strictly greater (D-015, D-041) | **no** (snapshot) |
| `overdue_tasks` | Overdue tasks | tasks whose `hs_task_status` is not `COMPLETED` at the run (so `NOT_STARTED`, `IN_PROGRESS`, `WAITING` and `DEFERRED` all count) with `hs_timestamp` (due) before the week end | **no** (snapshot) |

**Why snapshots have no history (D-004).** Counts tied to a date (created, moved, won, lost, new contacts) can be recomputed for any past week from today's CRM. Pipeline, stalled and overdue are states at a moment; past values could only come from storing them, and the ledger stores no business data. So they appear with this week's value only, labelled with when they were measured (pipeline and overdue "as of" the run; stalled at the week end). Past weeks of the date-anchored counts are recomputed from today's CRM, so a deleted, reopened or re-dated deal can change last week's figure from what last week's page showed; Data notes says so every week.

### Comparisons (all in code)

When `cur` is missing (sheet not entered or invalid), `prev` and `avg4` remain facts if their values exist, and `cur`, `wow_*` and `avg_*` are absent. For each metric with history, these are the **facts** (each can be cited by the model and shown on the page; `sum4` is internal and is never a fact): `cur` (this week), `prev` (last week), `avg4` (mean of the four weeks before this one; needs all four, else absent and flag `history_short`), and

- `wow_abs = cur − prev`, `wow_pct = round(100 × (cur − prev) / prev)` (absent when `prev` is 0 or missing)
- `avg_abs = cur − avg4`, `avg_pct = round(100 × (4·cur − sum4) / sum4)` (absent when `sum4` is 0 or missing)

`round` is round-half-away-from-zero on an exact integer fraction, applied once (no rounding of a rounded value). Averages are kept as `sum4 / 4` and only rounded for display: money to whole dollars, counts to one decimal (8.25 shows as 8.3). Threshold tests use integer cross-multiplication, never a rounded percentage (D-006). Because each figure is rounded once from the exact value, a shown difference can be 0.1 off the difference of two shown figures (9 − 8.3 shows as +0.8, not +0.7); the table carries the footnote "differences use the unrounded average".

A fact's **sign** is the sign of its exact value, not of its rendering: cash +$500 on $119,000 is a positive fact rendered `0%`.

### Renderings (what the page and the model see)

| Type | Value | Delta | Percentage |
|---|---|---|---|
| count | `4`; averages `3.0`, `8.3` | `+1`, `−1`, `0`; average deltas `+0.8` | `+33%`, `−50%`, `0%` |
| money | `$46,000` | `+$4,000`, `−$14,000`, `$0` | a separate `pct` fact: `+10%`, `−29%` |

## 5. Flags (code, never the model)

| Code | Rule (defaults are assumptions to tune, D-028) | Shown as |
|---|---|---|
| `quiet_week` | deals created, moved, won and lost all 0, new contacts ≤ `quietMaxNewContacts` (2), **and** neither `revenue_swing` nor `cash_drop` fires | "Quiet week in the CRM" banner; no model call; the Watch section still renders |
| `stalled_deals` | `stalled_deals.cur ≥ 1` | each stalled deal by name, stage and idle days |
| `overdue_tasks` | `overdue_tasks.cur ≥ overdueFlagMin` (3) | count |
| `revenue_swing` | `|4·cur − sum4| × 10000 ≥ revenueSwingBp (2500) × sum4`, i.e. at least 25% off the 4-week average either way | "Revenue is 27% below its 4-week average" (code-written) |
| `cash_drop` | `prev > 0`, `cur < prev` and `(prev − cur) × 10000 ≥ cashDropBp (1000) × prev` | "Cash fell 12% from last week" |
| `sheet_missing` | no `weekly` row for the report week | "Revenue and cash not entered" |
| `sheet_invalid` | a sheet cell that does not parse as dollars (e.g. `46k`) | the cell named; value treated as not entered |
| `history_short` | a metric lacks one of the four prior weeks (prior-week sheet gaps raise only this flag, never `sheet_missing`) | metric named; no average shown |
| `hubspot_truncated` | a list call hit `hubspotMaxPages` (a demo-scale limit: list order is by id, so a truncated read drops arbitrary records) | "CRM read stopped at N records; counts may be low" |
| `demo_guard_skipped` | records excluded by the demo guard | count, in Data notes |

## 6. The narrative and its checks

**What the model receives (D-007):** the fact table (id, label, type, rendering, sign), the flag codes with their code-written sentences, and stalled deals' names. Never contact names, emails, task text or raw CRM records.

**What it returns** (forced tool `write_pulse`, `prompts/narrate.schema.json`; any extra key, missing key or wrong type is `schema`):

```json
{
  "headline":    { "text": "≤ 15 words", "cites": ["fact id, 0 or more"] },
  "paragraphs":  [ { "text": "1 to 4 paragraphs", "cites": ["fact id, 0 or more"] } ],
  "suggestions": [ { "text": "required array, 0 to 3 items, ≤ 30 words each, no numbers" } ]
}
```

**Checks** (a Code node, no model). Before scanning, the fixed phrases `4-week`, `four-week`, `week-over-week`, any ISO date `\d{4}-\d{2}-\d{2}` and the names of stalled deals are removed (the prompt also tells the model not to write dates). A **word** is a whitespace-separated token. A **sentence** ends at `.`, `!` or `?` followed by whitespace or the end of the text. A **number token** matches `([+\-−])?(\$)?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?(%)?` (commas optional but, if present, well-formed); `$` makes it money, `%` a percentage, otherwise a count. A token **matches** a fact when the type is the same and the token's exact decimal value, after removing sign, `$`, commas and `%`, equals that of the fact's rendering (so `8` matches `8.0`; `8.25` does not match `8.3`; `$4,000` matches `+$4,000`).

The checks run in this order; the first failure is the run's `reason` (all failures are kept in the test output):

| # | Reason | Fails when |
|---|---|---|
| 1 | `schema` | the tool input does not validate |
| 2 | `too_long` | headline over 15 words, over 180 words across headline and all paragraphs together, or a suggestion over 30 words (paragraph and suggestion counts are enforced by `schema`) |
| 3 | `cited_fact_missing` | a cited id is not in the fact table (unknown, or absent because its value is missing) |
| 4 | `number_not_in_metrics` | a number in the headline or a paragraph matches **no** fact at all |
| 5 | `number_not_in_cited_facts` | a number matches some fact, but not one this headline or paragraph cites |
| 6 | `direction_mismatch` | a sentence uses only rise words (rose, up, increased, grew, gained, higher, climbed) or only fall words (fell, down, decreased, dropped, declined, lower, slipped), and **any** cited delta or percentage fact that one of its numbers matched has the other exact sign or an exact value of zero; or a token's explicit `+`/`−` differs from the exact sign of every cited fact it matched |
| 7 | `number_in_suggestion` | a suggestion contains any digit |
| 8 | `spelled_number` | headline, paragraphs or suggestions contain two … twenty, dozen, hundred, thousand, million or billion as words ("one" and "none" are allowed: too common as pronouns, D-011) |
| 9 | `advice_in_facts` | headline or paragraphs contain should, must, need to, needs to, recommend, consider, suggest, ought, make sure, prioritize/prioritise, focus on |
| 10 | `causal_claim` | headline, paragraphs or suggestions contain because, due to, driven by, caused by, as a result, thanks to, owing to, led to, resulted in |
| 11 | `unverifiable_claim` | headline or paragraphs contain doubled, tripled, halved, twice, record, all-time, highest, lowest, best, worst |

**Advice is allowed only as a suggestion**, rendered under the heading "Ideas from the model (not findings)". A cause is never allowed: the workflow cannot know why a number moved.

**Known limits** (stated on the page footer and in `docs/EVAL.md` later): the check proves each number is one of the cited facts' numbers, not that the sentence describes that fact well; a deal name the model invents is not caught; "one" as a number is not caught; ordinary phrases containing a direction word (for example "followed up") can trigger `direction_mismatch` falsely, which fails safe. These are why the page says "review before relying on it".

## 7. Output

**Google Doc** (title `Weekly Pulse — week of 2026-11-16`, in the `Pulse` folder): header line with the week as a range ("Mon 16 Nov – Sun 22 Nov 2026"), firm name and "Drafted by N3"; headline (the model's when it passed, otherwise code-written: "Weekly pulse: Mon 16 Nov – Sun 22 Nov 2026"); narrative paragraphs (or "Narrative withheld: <reason in words>", from a fixed map such as `number_not_in_metrics` → "the draft quoted a number the data does not contain", or the quiet-week template); **Watch** (code-written flag sentences, stalled deals by name); **Numbers** table (metric, this week, last week, 4-week avg, vs last week, vs avg); **Ideas from the model (not findings)**; **Data notes** (sheet gaps, invalid cells, count of deals with missing amounts, demo guard count including contacts with no email, truncation, the recompute caveat); **Definitions** (one line each: moved, won value vs revenue, stalled, overdue, snapshot timing, 4-week average); footer `Numbers computed by code from HubSpot and the weekly sheet · narrative by Claude, checked against them · review before relying on it`. Every model string is HTML-escaped.

**Gmail draft** in the Drafts folder of `gmail-lab`, addressed to `ownerEmail` only: subject `Weekly pulse: week of 2026-11-16`; body = the Doc's headline (model's only if it passed), five code-built lines (revenue, cash, deals won and value, new contacts, flags), the Doc link. Plain text. In demo mode the address must end in `.example` or no draft is made (`demo_guard_recipient`) (D-016).

## 8. Capabilities and acceptance criteria

| Id | Capability | Acceptance criterion (testable offline unless marked live) |
|---|---|---|
| AC-01 | Report week | For any run instant and `America/Chicago`, the week is the latest complete Monday-to-Monday before it; the week of 2026-10-26 spans 169 hours (DST end); runs at 2026-11-23T16:00Z (Mon 10:00 CST, the schedule) and at 2026-11-23T06:00Z (Mon 00:00 CST) both report `2026-11-16`; the week of 2027-03-08 spans 167 hours. |
| AC-02 | HubSpot read-only | Every HubSpot call in the workflow is a GET; a structural test fails on any POST, PATCH, PUT or DELETE to `api.hubapi.com`, and on any HubSpot node operation other than get/getAll. |
| AC-03 | Metrics | The engine reproduces the expected metrics of every golden week (§9) exactly. |
| AC-04 | Comparisons | Every `cur/prev/avg4/wow/avg` rendering in §9 matches; no floating-point arithmetic on money (a structure test bans `Math.round`, `parseFloat` and `toFixed` in `src/` outside `src/num.js`). |
| AC-05 | Flags | Each flag in §5 fires on its golden week (`hubspot_truncated` on the variant E01-truncated: `hubspotMaxPages` 1 and two pages of deals) and on no golden week where its inputs are below threshold. |
| AC-06 | One model call or none | A non-quiet run makes exactly one model call; a quiet week, a capped week and a failed source make none. |
| AC-07 | Narrative checks | Each check reason in §6 has a golden week or recorded variant that triggers it and only it as the first reason. |
| AC-08 | Metrics-only fallback | A failed check yields a Doc and a draft with the code-written headline, the numbers table, the Watch list and "Narrative withheld: <reason in words>" and no model text, ledger status `metrics_only`. |
| AC-09 | No send | No node can send mail (Gmail node is Create draft; no SMTP, send, reply or forward node; no HTTP call to a `/send` path). Structural test, as in N7. |
| AC-10 | Zero CRM writes | AC-02 plus: the HubSpot credential in `docs/SETUP.md` is read-only scopes. |
| AC-11 | Idempotent per week | Re-running a week updates the same Doc id and draft id; the ledger gains a row; no second Doc or draft appears. |
| AC-12 | Ledger holds no business data | `src/ledger.js` refuses any value that is not: an id; a code from a fixed list (status, reason, draft state, flag codes joined by `|`); the model id; the prompt version; a `YYYY-MM-DD` week start; a number of tokens, calls, dollars of model cost or seconds; or an ISO UTC timestamp. |
| AC-13 | Spend cap | With `weeklyCallCap` reached, the run makes no model call and produces a `metrics_only` page with reason `weekly_cap`. Token ceiling and dollar cap likewise. |
| AC-14 | Demo guard | Deals not prefixed `[demo]`, contacts not on `.example`, tasks not prefixed `[demo]` are excluded and counted; a non-`.example` owner address in demo mode means no draft. |
| AC-15 | Failure handling | A HubSpot or sheet read failing after 3 tries: no model call, no Doc, no draft, `errors` row, status `failed`. A missing sheet row is not a failure. |
| AC-16 | Ships inactive, config is the only account node | `workflow.json` has `"active": false`; outside the `config` node and credential references, no node parameter contains `REPLACE_WITH_`, an email address, or a Drive/Sheets id pattern (inlined `src/` code is exempt from the `.example` check because the demo guard names the TLD). |
| AC-17 | Live (Phase 3, Shane) | One manual run on the demo portal and sheet yields a Doc and a draft; the Gmail audit shows drafts only. **Not part of the offline gate.** |

## 9. Worked examples (golden weeks)

All figures are invented. Report week `2026-11-16` (Mon) to `2026-11-23` (Mon), America/Chicago. Unless a row says otherwise, the four prior weeks (`10-19`, `10-26`, `11-02`, `11-09`) are the **baseline**:

| Metric | 10-19 | 10-26 | 11-02 | 11-09 (prev) | sum4 | avg4 |
|---|---|---|---|---|---|---|
| deals_created | 3 | 4 | 2 | 3 | 12 | 3.0 |
| deals_moved | 5 | 6 | 4 | 5 | 20 | 5.0 |
| deals_won | 1 | 0 | 2 | 1 | 4 | 1.0 |
| won_amount | $12,000 | $0 | $21,000 | $9,000 | $42,000 | $10,500 |
| deals_lost | 1 | 1 | 0 | 2 | 4 | 1.0 |
| new_contacts | 8 | 10 | 6 | 8 | 32 | 8.0 |
| revenue | $40,000 | $44,000 | $38,000 | $42,000 | $164,000 | $41,000 |
| cash | $120,000 | $118,000 | $121,000 | $119,000 | $478,000 | $119,500 |

The **E01 week** (default run time `2026-11-23T16:00:00Z`, Monday 10:00 CST) has this complete fact table; every other week's expected facts are derived from it by the differences stated in its row:

| Metric | cur | prev | avg4 | wow_abs | wow_pct | avg_abs | avg_pct |
|---|---|---|---|---|---|---|---|
| deals_created | 4 | 3 | 3.0 | +1 | +33% | +1.0 | +33% |
| deals_moved | 6 | 5 | 5.0 | +1 | +20% | +1.0 | +20% |
| deals_won | 2 | 1 | 1.0 | +1 | +100% | +1.0 | +100% |
| won_amount | $18,000 | $9,000 | $10,500 | +$9,000 | +100% | +$7,500 | +71% |
| deals_lost | 1 | 2 | 1.0 | −1 | −50% | 0.0 | 0% |
| new_contacts | 9 | 8 | 8.0 | +1 | +13% (12.5 rounds away from zero) | +1.0 | +13% |
| revenue | $46,000 | $42,000 | $41,000 | +$4,000 | +10% | +$5,000 | +12% |
| cash | $123,000 | $119,000 | $119,500 | +$4,000 | +3% | +$3,500 | +3% |

Snapshot facts: `open_pipeline.cur` $210,000 (twelve open `[demo]` deals, among them `[demo] Bluewater fleet reporting` $15,000 in `contractsent` and `[demo] Harborview member portal` $8,000 in `qualifiedtobuy`, both created 2026-09-01, stage entered 2026-09-15, last activity 2026-11-20T15:00Z in E01); `overdue_tasks.cur` 2; `stalled_deals.cur` 0. Revenue swing test: 4·46,000 − 164,000 = 20,000; 20,000 × 10000 < 2500 × 164,000, so no flag.

**Recorded stand-ins.** Unless a row says otherwise, each stand-in is: headline `{"text": "The week in numbers", "cites": []}`; **one** paragraph whose text is the quoted sentence(s) and whose cites are the union of the ids listed; `suggestions: []`.

| # | Golden week | Inputs (differences from E01 / baseline) | Expected metrics and comparisons | Expected flags | Narrative (recorded stand-in) → check result | Run outcome |
|---|---|---|---|---|---|---|
| E01 | Normal week | as above | as above | none | "Revenue was $46,000, up $4,000 (10%) on last week." cites `revenue.cur, revenue.wow_abs, revenue.wow_pct`; "2 deals won for $18,000." cites `deals_won.cur, won_amount.cur` → **pass** | `done`, 1 model call |
| E02 | Quiet week | created 0, moved 0, won 0 ($0), lost 0, new contacts 1, revenue $41,000, cash $119,500 | revenue −$1,000 (−2%) vs last week, $0 (0%) vs avg; cash +$500 (0%: 0.42 rounds to 0) vs last week, $0 vs avg; new contacts −7 (−88%) | `quiet_week` | no model call; template text (headline "Quiet week in the CRM", no digits; no direction word next to a zero rendering) still passes the checks | `done`, 0 model calls |
| E03 | Data-missing week | E01's HubSpot data; **no `weekly` row for 11-16** | revenue and cash: no `cur`, `wow_*` or `avg_*` facts; `revenue.prev` $42,000, `revenue.avg4` $41,000, `cash.prev` $119,000, `cash.avg4` $119,500 remain facts; HubSpot metrics as E01 | `sheet_missing` | "Revenue and cash were not entered this week." cites none → **pass** (no numbers) | `done` |
| E04 | Data-missing week, invented number | as E03 | as E03 | `sheet_missing` | "Revenue came in at $45,000." cites none → **fail `number_not_in_metrics`** ($45,000 is no fact) | `metrics_only` |
| E05 | Right number, wrong fact | E01 | E01 | none | "3 deals were won." cites `deals_won.cur` (= 2). 3 is a fact elsewhere (`deals_created.prev`) → **fail `number_not_in_cited_facts`** | `metrics_only` |
| E06 | Number in no metric | E01 | E01 | none | "Won value reached $27,000." cites `won_amount.cur` → **fail `number_not_in_metrics`** (no money fact is $27,000) | `metrics_only` |
| E07 | Fractional average | new-contact history 8, 10, **7**, 8 (sum 33); new contacts 9 | `new_contacts.avg4` = 8.3 (8.25 rounds away from zero); `avg_abs` +0.8 (0.75 → 0.8); `avg_pct` +9% (9.09); `wow` +1 (+13%) | none | "New contacts were 9 against a 4-week average of 8.25." cites `new_contacts.cur, new_contacts.avg4` → **fail `number_not_in_metrics`** (the rendering is 8.3; 8.25 is no fact's rendering) | `metrics_only` |
| E08 | Stalled deal, and a boundary | E01, except two of its open deals have older last activity: `[demo] Bluewater fleet reporting` (`contractsent`, max 10 days) 2026-11-11T18:00Z; `[demo] Harborview member portal` (`qualifiedtobuy`, max 21) 2026-11-02T06:00Z. Their stage entries (2026-09-15) are older, so activity sets idle. Week end 2026-11-23T06:00Z. Every other fact as E01 | Bluewater idle 11 days (11.5 floored) > 10 → stalled; Harborview idle exactly 21, not > 21 → not stalled; `stalled_deals.cur` 1, `stalled.1.idle_days` 11 | `stalled_deals` (Bluewater only) | "1 deal has stalled: Bluewater fleet reporting, idle 11 days in contract." cites `stalled_deals.cur, stalled.1.idle_days` → **pass** | `done` |
| E09 | Revenue swing, direction wrong | E01 but revenue $30,000 | revenue −$12,000 (−29%) vs last week; −$11,000 (−27%) vs avg; 44,000 × 10000 ≥ 2500 × 164,000 | `revenue_swing` | "Revenue rose 27% against its 4-week average." cites `revenue.avg_pct` (−27) → **fail `direction_mismatch`** | `metrics_only` |
| E10 | Cash drop and overdue tasks | E01 but cash $105,000, overdue tasks 4 | cash −$14,000 (−12%) vs last week, −$14,500 (−12%) vs avg; 14,000 × 10000 ≥ 1000 × 119,000 | `cash_drop`, `overdue_tasks` | "Cash ended at $105,000, down $14,000 (12%) from last week." cites `cash.cur, cash.wow_abs, cash.wow_pct` → **pass** | `done` |
| E11 | Advice as fact | E08 | E08 | `stalled_deals` | paragraph "You should call Bluewater this week." → **fail `advice_in_facts`** | `metrics_only` |
| E12 | Advice as suggestion | E08 | E08 | `stalled_deals` | paragraphs as E08; suggestion "Call the Bluewater contact about the contract." → **pass**; shown under "Ideas from the model (not findings)" | `done` |
| E13 | Causal claim | E01 | E01 | none | "Revenue rose $4,000 because of year-end billing." cites `revenue.wow_abs` → numbers and direction pass → **fail `causal_claim`** | `metrics_only` |
| E14 | Short history | sheet rows only for 11-02, 11-09 and 11-16 (revenue $38,000, $42,000, $46,000; cash $121,000, $119,000, $123,000) | revenue +$4,000 (+10%) vs last week; no `revenue.avg4`; cash +$4,000 (+3%) vs last week; no `cash.avg4` | `history_short` (revenue, cash) | "Revenue was $46,000, $5,000 over its 4-week average." cites `revenue.cur, revenue.avg_abs` → **fail `cited_fact_missing`** | `metrics_only` |
| E15 | Zero base | won history 1, 0, 2, **0** and won value $12,000, $0, $21,000, **$0**; this week won 2 for $18,000 | `deals_won.wow_abs` +2, **no `wow_pct`** (prev 0); avg4 0.8 (3/4), `avg_abs` +1.3 (1.25), `avg_pct` +167%; won value +$18,000 vs last week, no `wow_pct`; avg4 $8,250, `avg_abs` +$9,750, `avg_pct` +118% | none | "Deals won were up 100% on last week." cites `deals_won.wow_pct` → **fail `cited_fact_missing`** | `metrics_only` |
| E16 | Weekly cap | E01 inputs; the ledger already has three rows for week `2026-11-16` with `run_at` 2026-11-23T07:00Z, 08:00Z and 09:00Z, `model_calls` 1 each, `doc_id` `D1`, `draft_id` `G1`, `draft_state` `created` (`weeklyCallCap` 3, calendar week from 2026-11-23T06:00Z) | E01 | none | no model call | `metrics_only`, reason `weekly_cap`, 0 model calls; Doc and draft updated in place |
| E17 | Re-run | E01 inputs; the ledger already has one `done` row for `2026-11-16` with `doc_id` `D1`, `draft_id` `G1`, `draft_state` `created`, `model_calls` 1 (one run with a prior row, not two runs) | E01 | none | as E01 → **pass** | `done`; Doc `D1` and draft `G1` updated by id (no create call); the ledger then has 2 rows for the week; `draft_state` `updated` |
| E18 | Demo guard | E01 plus one contact created in the week at `newprospect.test` (not `.example`) | `new_contacts.cur` 9 (the `.test` contact excluded) | `demo_guard_skipped` (1) | as E01 → **pass** | `done`; Data notes "1 CRM record outside the demo set was not counted" |
| E19 | Invalid sheet cell | E01 but `revenue_usd` typed as `46k` | revenue: no `cur`, `wow_*` or `avg_*` facts (`revenue.prev` $42,000 and `revenue.avg4` $41,000 remain); cash as E01 | `sheet_invalid` (revenue) | "Cash was $123,000, up $4,000 on last week." cites `cash.cur, cash.wow_abs` → **pass** | `done` |
| E20 | Source failure | HubSpot list returns HTTP 500 three times (Phase 1: the harness fake reports a final failure; the three tries are a Phase 2 node setting) | none computed | — | no model call | `failed`, reason `hubspot_error`; no Doc, no draft; `errors` row; a later re-run of the week finds no Doc id and creates one |

Twenty golden weeks: seven pass with a model narrative (E01, E03, E08, E10, E12, E18, E19); one quiet week with no model call (E02); nine narrative rejections covering six distinct reasons (`number_not_in_metrics` E04, E06, E07; `number_not_in_cited_facts` E05; `direction_mismatch` E09; `advice_in_facts` E11; `causal_claim` E13; `cited_fact_missing` E14, E15); one cap (E16); one re-run (E17); one source failure (E20). The five reasons no golden week triggers (`schema`, `too_long`, `number_in_suggestion`, `spelled_number`, `unverifiable_claim`) each get a recorded variant on E01 in Phase 1 (AC-07), and `hubspot_truncated` gets the input variant E01-truncated (AC-05). Phase 1 turns each row into a fixture (`fixtures/README.md`).

## 10. Safety rails

- **No send node** (AC-09). The Gmail node is Create draft; a structural test fails the build otherwise. The Gmail credential itself can send; the guarantee is the absence of a send node, not the credential's scope.
- **Zero CRM writes** (AC-02, AC-10). HubSpot calls are GET only. Give the `hubspot-demo-readonly` key `crm.objects.deals.read`, `crm.objects.contacts.read` and the read scope HubSpot requires for tasks (to confirm in Phase 2; see Not verified).
- **The model never computes.** It cannot add, average or compare; it may only repeat renderings it was given, and the checks hold it to that.
- **No advice dressed as fact; no causes.** Checks 9–11.
- **Synthetic data, demo guard** (D-016). Only `[demo]` deals and tasks and `.example` contacts are counted; the draft goes only to an `.example` owner address in demo mode.
- **Ledger holds no business data** (AC-12). No amounts, counts of deals, names or emails in the sheet; tokens, cost, ids and codes only.
- **Spend:** weekly call cap (3), per-run input token ceiling (20,000 estimated), weekly dollar cap ($1.00) once prices are set; prices are `null` until Shane fills them (D-019). These are defaults, not measurements.
- **Failure is visible:** a source failure leaves an `errors` row and, if configured, one webhook line. Never an email.
- **Successful executions are not saved** in n8n (D-029): the CRM data would otherwise sit in execution history.

## 11. Non-goals (v0.1)

- QuickBooks or any accounting/bank connection (revenue and cash are typed into the sheet).
- Sending anything, to anyone, by any channel; Slack posts; scheduling the email.
- CRM writes of any kind, including tasks for stalled deals (N2 owns follow-up tasks).
- Forecasts, targets, quotas, goal tracking, causal explanations.
- Dashboards or charts; multi-week trend lines beyond the 4-week average.
- Multiple pipelines, multiple currencies, multiple firms; per-owner breakdowns.
- Owner free-text notes from the sheet into the model (would need their own checks).
- Live operation for Lab Intelligence or any real business.

## 12. Open questions (each with the default taken)

| # | Question | Default | Reason |
|---|---|---|---|
| Q1 | Snapshot metrics (pipeline, stalled, overdue) have no history. Store them? | No (D-004) | Storing them means business data in the ledger; the rule from N7 is ids, codes and numbers of tokens only. |
| Q2 | On a failed check, retry the model once? | No; metrics-only page (D-012) | A retry doubles cost on exactly the runs where the model misbehaved, and a page with correct numbers and no prose is still useful. |
| Q3 | Thresholds: revenue swing 25%, cash drop 10%, overdue 3, quiet ≤ 2 contacts | as stated (D-028) | Round numbers chosen to make the golden weeks clear; not derived from any data. To tune on the demo portal. |
| Q4 | Week: Monday start, America/Chicago, report the previous complete week, run Mondays 10:00 | as stated (D-005, D-037) | Shane is in Central time; a Monday-morning read of last week is the stated cadence; 10:00 leaves time to type in the sheet. |
| Q9 | Hide percentages on small counts (1 → 2 deals = +100%)? | No; show them beside the absolute change (D-050) | Keeps one rule for every metric; an owner can read +1 next to +100%. |
| Q5 | Where does "revenue" come from? | the sheet, as typed (D-024) | QuickBooks is out; won value from the CRM is bookings, not revenue, so both are shown and labelled. |
| Q6 | Who gets the draft? | the owner only | The owner forwards; a second recipient would be the first step towards sending. |
| Q7 | Model | `claude-sonnet-5-5` (D-020) | The id N7 confirmed on 2026-11-25; one call a week. |
| Q8 | Spelled-out "one" | allowed (D-011) | Banning it would reject ordinary sentences ("one of the deals"). |

## 13. Phase plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Engine, checks, fixtures, skeleton (offline)** | `src/` pure modules (`docs/PHASE-1-PLAN.md`), `prompts/narrate.md` + schema, 20 golden-week fixtures with recorded stand-ins, `scripts/build-workflow.js` producing an inactive `workflow.json` skeleton (all nodes, Code nodes inlined, external nodes with placeholder parameters), structural tests, CI. | `npm run gate` green locally and in CI; AC-01, 03–09, 11–14, 16 pass offline; every §9 row is a passing test; `workflow.json` drift check passes. |
| **2. Workflow wiring + simulated run** | Real n8n node parameters (HubSpot GETs with paging and `propertiesWithHistory`, Sheets reads, Anthropic HTTP, Drive HTML-to-Doc upload/update, Gmail draft create/update), error trigger, `test/n8n-sim.js` executing `workflow.json` against in-memory fakes for all 20 weeks; `docs/SETUP.md`. | Simulated run of `workflow.json` reproduces every §9 outcome; AC-02, 10, 15 pass; no live call made. |
| **3. Demo, eval, closeout** | `docs/DEMO.md` (5 minutes), seed data for the demo portal and sheet, `docs/EVAL.md`, `docs/ACCEPTANCE.md`, README status. Shane's hand steps: import, credentials, seed, one live manual run (AC-17). | ACCEPTANCE lists every AC with offline/live evidence; live items marked "not run" until Shane runs them. |

## 14. Not verified

Written from documentation knowledge and the sibling repos, without any live call. Phase 2 checks each against HubSpot's, Google's and n8n's documentation and records a D-row; the live run (AC-17) settles the rest.

- HubSpot: the read scope needed for tasks; the page size allowed with `propertiesWithHistory`; `hs_timestamp` as the task due date; `notes_last_updated` semantics; whether `closedate` values set by a date picker sit at midnight UTC (which would fall in the previous Chicago week) and whether the portal's time zone must equal `timezone`; whether counting wins by the stage-history timestamp or `hs_closed_won_date` would be more reliable than `closedate`.
- Google: that the `google-drive-lab` OAuth2 credential carries the Sheets scope (as N7 D-12 assumed); how Drive's HTML-to-Google-Doc conversion renders the table; `FORMATTED_VALUE` strings for currency-formatted cells.
- n8n: `Intl` time-zone data in Shane's n8n Node build; node parameter shapes for the Gmail draft and HTTP nodes on his n8n version.
- Model: nothing about narrative quality, runtime or cost is measured; prices are `null`; the spend defaults are guesses, not measurements.
- Scale: paged list reads are fine for a demo portal; a real firm with thousands of contacts would hit `hubspotMaxPages` (the search API filtered on `createdate` would be the fix; out of scope).
