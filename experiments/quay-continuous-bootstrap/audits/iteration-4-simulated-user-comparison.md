# Simulated-user audit — Comparison-to-mature-tool reviewer
# Iteration 4 — live CLI and Web UI exercise

**Persona**: Comparison reviewer holding quay up against GitHub Issues AND Linear.
Previous iterations have established the baseline; this report focuses on what changed in iteration 4, what iteration 4 fixes actually landed, and what new gaps remain.

**Date**: 2026-07-17
**Comparison tools**: GitHub Issues / `gh` CLI; Linear
**Surfaces tested**:
- CLI: `node packages/quay/bin/quay.js` — `task list`, `task view`, `task check`, `action list`
- Web UI: `http://localhost:4173/` — list page, detail page
- Filtering: multi-label via URL and CLI flags
- Task corpus: 112 tasks at time of audit

**Scope note**: Previously-documented gaps (CB-006, CB-007, CB-008, CB-010, UQ-004, UQ-006, UQ-007, UQ-008, CR-002, CR-003, CR-004, CR-006, CR-013) are not re-reported in full. This report verifies iteration 4 fixes and identifies new or re-confirmed findings.

---

## Iteration 4 Fix Verification

### Fix 1: Multi-label filter AND-join (CB-013)

**PASS**

Tested: `curl "http://localhost:4173/?label=v1&label=github-provider"` returns QN-008, QN-009, QN-010, QN-011, QN-013, QN-014 — all confirmed to have both labels by direct frontmatter inspection. The AND-join is working correctly.

Tested from CLI: `node quay.js task list --label v1 --label github-provider` returns the same set. Multi-label is consistent between CLI and Web UI (both use AND-join now, closing the previous CLI-last-wins / Web-first-wins inconsistency).

Observation: `?label=epic&label=experiment-4` correctly returns 0 results because no tasks carry both labels — the filter isn't broken, the label combination simply doesn't exist in the corpus. This is correct behavior.

### Fix 2: Updated timestamps — visible on list page and detail page (UQ-017)

**PASS**

Web UI list page at desktop viewport (1280px): an "updated" column is visible in the table, showing relative timestamps like "3h ago", "13h ago", "14h ago". The column header is "updated". This directly closes UQ-005 (no visual age indicator) as well as UQ-017.

Web UI detail page: "last updated: 14h ago" appears in the task meta section, below the role/labels line. Confirmed on QN-008 and QN-017.

Minor note: the "updated" column is hidden at mobile viewport (≤600px) via `display: none` on `.col-updated`. This is a considered tradeoff to avoid table overflow — acceptable for now but means mobile users have no recency information at all. UQ-005/UQ-017 should be marked closed for desktop; mobile recency remains absent (not a new finding, but a nuance).

### Fix 3: Advance tooltip on list page shows target status (UQ-018)

**PASS**

Confirmed via `curl http://localhost:4173/ | grep 'title="Advance'`: the list-page Advance button carries `title="Advance to ready"` for PC-PARENT (todo status). The detail-page button also carries `title="Advance to ready"`. The previous inconsistency (list page generic "Advance task to next status" vs detail page target-specific) is resolved.

---

## UQ-004 Status: CLI timestamps

**FAIL (still open)**

UQ-004 was specifically about CLI `task list` not showing timestamps. This has NOT been fixed in iteration 4. The CLI `task list` human-readable output remains:

```
PC-PARENT	todo	primitive	Parent task
```

No timestamp column in non-JSON output. The `updatedAt` field IS present in `--json` output (confirmed: `["id","title","status","labels","parent","children","role","extra","body","updatedAt"]`), and `--sort updated` correctly uses it. But the human-readable table still does not display it.

GitHub Issues `gh issue list` shows "UPDATED" column. Linear shows last-activity timestamp. Quay's CLI list is still weaker than both comparators on this point.

**Re-confirm UQ-004 open. Not fixed in iteration 4.**

---

## UQ-005 Status: Web UI age indicator

**PASS — effectively closed by UQ-017 / QX-018**

The gap-list still shows UQ-005 as open, but the fix for UQ-017 (QX-018) addresses the same thing — relative timestamps on list rows and detail page. The gap-list should be updated to close UQ-005 as well.

---

## New Findings

### NF-001: Needs-human task detail — no call to action (CR-013 from iteration 3, still open)

**Severity: minor — confirmed still present**

A `needs-human` task detail page (confirmed: QN-017) shows the task title, role, labels, "last updated", and the full task body. There is no Advance button (correct — action is suppressed for needs-human). But there is also no explanatory text, no instruction, no call to action — nothing that tells a human reader "you need to do X before this can continue."

GitHub Issues: locked issues show a banner explaining why. Linear: tasks in custom "needs attention" states show status notes. Quay: empty space where the action button would be.

This was CR-013 in iteration 3 and remains unaddressed. Re-confirmed open.

### NF-002: UQ-005 not formally closed in gap-list despite UQ-017 fix shipping

**Severity: minor — gap-list bookkeeping**

UQ-005 ("No visual age indicator on Web UI list rows") is still listed as open in `gap-list.md` line 24. UQ-017 (which was filed as a separate gap in iteration 3) addresses exactly the same thing. Both should be treated as one fix. UQ-005 should be closed citing QX-018 as evidence.

This is not a product gap — the feature is implemented. It is a documentation gap in the gap-list.

### NF-003: "role" column on desktop list — adds noise for single-role corpus

**Severity: minor — comparison observation**

At 1280px viewport, the list table shows: id | status | role | title | labels | updated | actions. The "role" column shows "primitive" for the vast majority of tasks (102+ of 112) and "compound" for a few. For a new user evaluating quay, this column is puzzling — the concepts "primitive" vs "compound" are internal to quay's model and not explained anywhere on the list page.

GitHub Issues and Linear: no equivalent "role" column. Users see id, title, status, labels, assignee, date.

The orientation banner explains the status lifecycle but not the role concept. A tooltip or column header link to a glossary would help. This is a minor discoverability gap.

### NF-004: No "in progress" status — still absent (CR-002 confirmed open)

**Severity: significant — confirmed from iteration 3**

The 4-state model (todo → ready → needs-human → done) still has no `in_progress` / active-work state. The `ready` state means "execution skill should now run" — not "currently being executed." With 112 tasks and 0 currently in `ready` state, the intermediate states are effectively invisible.

Confirmed by `node quay.js task list --status ready` → 0 tasks. The live corpus shows todo (2), needs-human (3), done (107), ready (0). This means all meaningful work is either not started or complete, with no visibility into in-flight work.

No change from iteration 3. Not addressed in iteration 4.

### NF-005: Web UI has no task creation affordance — still absent (CR-006 confirmed open)

**Severity: significant — confirmed from iteration 3**

Tested: `curl http://localhost:4173/new` returns "not found". The list page has no "New Task" button, no creation form. The only way to create a task is to write a raw `.md` file in `tasks/` or use the MCP `task_write` tool.

`node quay.js task create` → unrecognized command (usage error). The CLI has no `task create` subcommand.

No change from iteration 3. Not addressed in iteration 4.

---

## Overall Verdicts

### CLI Surface: CONCERNS

**Unchanged from iteration 3.** CB-013 (multi-label) is fixed and is a genuine improvement. But:
- UQ-004 (no timestamp column in list output) is still open
- No `task create` command (CR-006)
- `task edit` is still status-only vs MCP's full write surface (CR-004)
- No priority field (CR-003)

The CLI is usable for reading and status-advancing tasks, but falls short of `gh issue list` breadth for writing workflows.

### Web UI List Page: PASS with minor concerns

**Improved from iteration 3.** The three iteration-4 fixes all land:
- Multi-label AND-join: works correctly
- Updated column: visible at desktop, relative timestamps correct
- Advance tooltip: target-status specific

Remaining minor concerns:
- Updated column hidden on mobile (no recency info for mobile users)
- Label filter wall (UQ-006) unchanged — 41 labels in flat inline list
- Role column puzzling for new users (NF-003)

### Web UI Detail Page: PASS with minor concerns

**Improved from iteration 3.** Timestamps now visible on detail page. Needs-human tasks correctly suppress the Advance button.

Remaining:
- No guidance text on needs-human tasks (NF-001 / CR-013)

### Filtering: PASS

CB-013 is fully resolved. Both CLI (`--label A --label B`) and Web UI (`?label=A&label=B`) now apply AND-logic correctly and consistently. The previous CLI-last-wins / Web-first-wins inconsistency is gone.

---

## Summary Table — Iteration 4 Verification Results

| Check | Result | Notes |
|-------|--------|-------|
| Multi-label AND-join (Web UI) | PASS | `?label=v1&label=github-provider` returns correct set |
| Multi-label AND-join (CLI) | PASS | `--label v1 --label github-provider` returns correct set |
| Updated timestamps on list page | PASS | "updated" column visible at desktop; hidden at mobile |
| Updated timestamps on detail page | PASS | "last updated: X ago" in meta section |
| Advance tooltip target-status (list) | PASS | `title="Advance to ready"` for todo tasks |
| CLI `task list` timestamps (UQ-004) | FAIL | Still no timestamp column in non-JSON CLI output |

## Summary Table — Previously-open gaps: status after iteration 4

| Gap ID | Description | Status after iteration 4 |
|--------|-------------|--------------------------|
| CB-006 | No configurable page size | Open (unchanged) |
| CB-007 | No full-text search | Open (unchanged) |
| CB-008 | No packaging/distribution | Open (unchanged) |
| CB-010 | MCP response size | Open (unchanged) |
| UQ-004 | No timestamp in CLI list output | Open (not fixed) |
| UQ-005 | No visual age indicator on Web UI | De facto CLOSED by QX-018 — gap-list needs updating |
| UQ-006 | 41-label flat filter list | Open (unchanged) |
| UQ-007 | Table overflow on narrow mobile | Open (unverified this iteration) |
| UQ-008 | MCP `task_list` no streaming/pagination | Open (unchanged) |

## New gaps identified this iteration

| Gap ID | Description | Severity |
|--------|-------------|----------|
| NF-001 | needs-human task shows no call-to-action guidance (CR-013 re-confirmed) | minor |
| NF-002 | UQ-005 not formally closed in gap-list despite QX-018 shipping | bookkeeping only |
| NF-003 | "role" column on desktop list is puzzling for new users — no explanation | minor |

No new significant or blocking gaps were identified in iteration 4. The iteration closed its planned gaps cleanly. The remaining open gaps are either known strategic deferrals (no packaging, no full-text search) or structural product decisions (4-state model, no task creation UI) that require deliberate prioritization.
