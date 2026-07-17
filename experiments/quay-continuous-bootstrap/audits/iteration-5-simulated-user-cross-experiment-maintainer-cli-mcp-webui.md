# Simulated User Audit — Cross-Experiment Maintainer Persona
Date: 2026-07-17
Iteration: 5
Persona: Cross-experiment maintainer (power user, all surfaces)

## Label-nav toggle (QX-020 fix) — PASS

Tested `GET /?label=experiment-4&label=iteration-5`.

Both active labels render bold in the nav: `<strong>experiment-4</strong>` and `<strong>iteration-5</strong>`.

Toggle-off links are correct:
- `experiment-4` remove link → `/?label=iteration-5` (drops experiment-4, keeps iteration-5) ✓
- `iteration-5` remove link → `/?label=experiment-4` (drops iteration-5, keeps experiment-4) ✓

Toggle-on (inactive label) links are correct — each inactive label link generates a URL that appends to the existing filter set, e.g. `/?label=experiment-4&label=iteration-5&label=abi` for the "abi" entry. This is the AND-accumulate semantic that was missing before QX-020.

Single-label case (`/?label=experiment-4`) also clean: remove link goes to `/` (all labels), and clicking any other inactive label appends correctly.

This was a painful bug across iterations 3–4 where clicking any label in a multi-label view would reset to a single-label view. Now correctly fixed.

## Full-text search (CB-007) — PASS

**CLI:**
- `--search "timestamp"` → 2 matches (QX-018, QX-022) — correct substring match
- `--search "QX" --label "experiment-4"` → 1 match (QX-006, the only task whose title contains "QX" and has label "experiment-4") — composition works correctly
- `--search ""` / omitted → no filter applied, all tasks returned

**Web UI:**
- `/?q=QX&label=experiment-4` → returns QX-006 only; the label nav correctly shows `<strong>experiment-4</strong>` with remove link, and `q=QX` is preserved in all nav links (prefix/status/sort/label nav all carry `&q=QX`)
- `/?q=timestamp&label=experiment-4` → returns QX-018 and QX-022 — correct AND composition
- Search form present (`<input name="q" ... value="QX">` pre-populated with active query)
- `buildHref` correctly threads `q` param through all filter navigation links

CB-007 has been open since iteration 0 (5 iterations total). It now works correctly on both surfaces and composes cleanly with label, prefix, status, and sort filters.

## CLI timestamp column (UQ-004) — PASS

`quay task list` output is now 5 tab-separated columns: `id\tstatus\trole\ttitle\tupdated`.

Examples observed:
- `QX-022	done	primitive	Add timestamp column to CLI plain-text task list output (UQ-004)	6m ago`
- `QN-072	done	primitive	[...title...]	14h ago` — this task has no explicit `updatedAt` in its frontmatter; the provider falls back to file mtime, so a timestamp is still shown (not "—")

**Null-safety:** The code at line 219 of `bin/quay.js` explicitly handles missing `updatedAt`: `typeof t.updatedAt === "number" ? relativeTimeCli(t.updatedAt) : "—"`. In practice, the quay-native provider provides file mtime for all tasks, so "—" is a safety net rather than common output.

`--json` output unchanged (timestamp was already present in JSON from QX-018).

UQ-004 open since iteration 0. Now resolved.

## MCP regression check — PASS (with known gap CB-014)

`mcp__quay__task_list` with `label: "experiment-4"` returned all 10 experiment-4 tasks correctly, including the 3 new iteration-5 tasks (QX-020, QX-021, QX-022) with full body content, labels, and metadata.

MCP schema (loaded via ToolSearch) exposes: `label`, `provider`, `status` — no `search` parameter. This is the known CB-014 gap (MCP search parity), still open. Not a regression — MCP never had search. The new `--search` feature is CLI+WebUI only for now.

No regression observed in `task_list` behavior for status and label filtering.

## Prefix/label regression — PASS

- `--prefix QX` → 22 tasks returned, all QX-prefixed, correct
- `--label experiment-4` (single label) → correct, clean output, toggle link to `/` on web UI
- Multi-label AND-filtering (`--label A --label B`) introduced in QX-016 (iteration 4) still works: web UI test `/?label=experiment-4&label=iteration-5` returns only the 3 tasks that have BOTH labels (QX-020, QX-021, QX-022)
- `--sort updated`, `--status done`, all nav links correctly propagate existing filter state

No regressions detected in any filter surface.

## New gaps found

**Minor:** MCP search parity (CB-014) — already tracked, not new. The MCP `task_list` schema does not expose a `search` parameter, so `--search` is CLI/WebUI only. For a power user who also uses MCP from Claude Code sessions, this is the last notable surface gap.

No new blocking or significant gaps identified. The label-nav toggle fix (QX-020), search (QX-021), and timestamp column (QX-022) all work as specified and compose cleanly with each other and with existing filters.

## Overall: PASS

All three iteration-5 deliverables verified working across CLI, Web UI, and MCP surfaces. The two most painful long-standing gaps (CB-007 search open for 5 iterations, QX-020 label-nav toggle regression I hit repeatedly) are now resolved. Filter composition is correct and no regressions detected in prefix, label, status, sort, back-link, or action behaviors established in prior iterations.
