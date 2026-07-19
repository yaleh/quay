---
id: exp5-M-QUAY-CLI-CREATE-ERGONOMICS
title: "quay CLI task-creation ergonomics: fix silent title-less task creation
  (data-integrity bug), add a dedicated create verb, address stale --help text
  and MCP per-call latency"
status: done
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M29-cli-create-ergonomics
extra: {}
---
## Forward-looking candidate provenance
Forward-looking milestone-candidate task, created at m28 DRAIN/SELECT boundary (2026-07-18) once
the standing backlog (all 20 prior milestone-candidate rows DONE/STALE, DIR-001 fully closed)
was exhausted — mirrors the M24-task-backlog-projection-impl forward-looking-creation pattern:
turning a real logged gap-log finding into a first-class backlog row rather than letting it
decay as prose inside a milestone's own report.

## Source
M27-competitive-bench benchmark-report.md ("Disposition of each gap" section), findings
GAP-001/GAP-002/GAP-007/G-02.

## Value type / cadence
exploit (fix known real defects/gaps found via the competitive benchmark), capability-growth
(secondary — CLI ergonomics), method infra, VT points TBD at charter-authoring (likely small
positive Δv̂ on the CLI surface, given GAP-002 is a genuine correctness bug, not cosmetic polish).

## Notes (verbatim provenance from M27's benchmark-report.md)
- **GAP-002 (highest priority — real data-integrity bug)**: `quay task edit <new-id>` without
  `--title` silently creates a task with no `title` field at all (not even an empty string) —
  `task view --json` omits the key entirely; non-JSON view prints the literal string `undefined`
  as the title. Found only by M27 iteration-0 (iteration-1's own scenario always supplied
  `--title`), a concrete instance of the two-iteration pattern's value.
- **GAP-001/G-01**: quay has no dedicated `task create` verb (upsert-via-edit only) — both
  competitors (`gh issue create`, `backlog task create`) effectively require a title, making
  GAP-002's failure mode harder to hit accidentally on either competitor.
- **GAP-007**: quay's per-call MCP subprocess handshake (fresh Node process per CLI invocation)
  is the dominant latency cost, ~2.6x slower per call than `backlog.md` for the same
  local-filesystem class of operation.
- **G-02**: `--help` text is stale relative to the actual `task edit` flag surface — shows only
  `--status`, but the code supports far more flags (`--title/--body/--body-file/--labels/--extra/
  --parent/--children/--expect-status/--append-notes`, from M16-cli-edit-parity). Low severity,
  trivial documentation-only fix.
- Also relevant, lower priority (from M28-outcome-eval's own gap log, same CLI-ergonomics area):
  **G-TEST-01** — `serve-github.test.mjs`'s `GET /` list-page assertions for `gh-3` are not
  resilient to the live `yaleh/quay` fixture repo's issue count growing past the default page
  size (20). Not itself a CLI-ergonomics defect, but co-located in the same test surface; a
  future charter selecting this candidate may fold in a fix as a small rider if convenient, or
  leave it for a separate test-infra candidate — not mandatory scope here.

A future charter selecting this candidate should treat GAP-002 (data-integrity bug, correctness)
as the anchor Done-when clause, with GAP-001 (dedicated create verb) as the natural structural
fix that also resolves GAP-002 (a `task create` verb can mandate `--title` at the CLI-parsing
level, rather than patching `task edit`'s upsert path to special-case missing titles). GAP-007
(latency) and G-02 (stale help) are smaller, independent riders that may be included or split off
depending on line-budget at SELECT time.

## Status mirror
done (ABSORBed @M29, 2026-07-19 — GAP-002+GAP-001 fixed together in `packages/quay/bin/quay.js`
(new `task create` verb + hardened `task edit` existence/empty-title guard, the latter tightened
during the merge to catch an empty-string `--title` case iteration-1's skepticism pass found);
G-02 fixed (--help text); GAP-007 re-measured 2.25x-3.13x, consistent with M27's ~2.6x, not fixed
per charter's explicit judgment call. Realized Δv=+0.50, exact match to charter's Δv̂≈0.5.
Adversarial-audit gate (REQUIRED, first real non-no-op firing recently): NO REFUTATION FOUND.
DoD meta-enforcer: PASS (5th-ever real test, 1st against real product code). Full details:
`dashboard.md`'s "ABSORB m29" entry.)
