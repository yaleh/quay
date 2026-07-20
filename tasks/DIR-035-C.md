---
id: DIR-035-C
title: "DIR-035 split C: experiment state is not product data — delivered product ships an empty/minimal example store, not the multi-experiment tasks/ backlog"
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: resolved
  schema: "v1"
---
## Proposal
Third child slice of [[DIR-035]] (ADR-013) — NOT executed this milestone. Tracks ADR-013's
Decision item 3 / DIR-035 Requested action item 3: the delivered product must ship an empty or
minimal example task store, not the accumulated ~267-file multi-experiment `tasks/` backlog this
repo has grown as its own dogfooding history.

## Finding
`delivery-standalone-smoke.sh` does not currently score this directly (its `WS` fixture workspace
is already a fresh empty `tasks/`/`.quay/` dir it constructs itself), but ADR-013's Context/
Decision are explicit that "experiment state ≠ product data" is a THIRD standing rule distinct
from R2/R3/R4 (DIR-035-A) and R1/R5 (DIR-035-B): today `tasks/` at repo root — the DEMO/dogfood
backlog quay's own methodology loop runs on — is not itself part of `packages/quay`'s `files`
whitelist (so it is not literally shipped in the npm tarball today), but the DIRECTIVE'S own DoD
item 1 asks for something stronger: a documented, minimal SAMPLE store shipped WITH the product
(so a fresh `npm install quay` user has a working example workspace to start from), decoupled from
this repo's own live experiment backlog — currently there is no such sample store at all.

## Requested action
1. Author a minimal example/sample task store (a handful of illustrative tasks demonstrating the
   view-model shape: primitive/compound roles, labels, AC/DoD sections) as documented product data
   shipped alongside `packages/quay` (or `packages/quay-native`, wherever the reference sample
   belongs), separate from this repo's own `tasks/` experiment backlog.
2. Confirm no accumulated experiment backlog is ever part of any package's `files` whitelist (audit
   `packages/*/package.json` `files` arrays).
3. Document (README or DESIGN.md) that a delivered `quay`/`quay-native` install starts from the
   minimal sample, not from this repo's live 267-file backlog.

## Acceptance Criteria
- [x] A minimal documented sample task store exists and is demonstrated to work with a fresh `quay-native mcp` + `quay task list` round-trip.
- [x] `packages/*/package.json` `files` whitelists audited and confirmed to exclude this repo's own `tasks/` experiment backlog.
- [x] README/DESIGN.md documents the sample-store-vs-live-backlog distinction.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING. Done ONLY when a
fresh `npm install quay-native` + default config actually boots against the minimal sample, not
prose-only.
- [x] REAL LANDING confirmed — see `## Resolution` below.

## Resolution

Executed at M50 (`M50-dir035-c-sample-store`), commit `a0cd575` (merged into `master` at this
ABSORB). Independently audited by a fresh-context subagent with no access to the build agent's
self-report — **verdict PASS with qualifications** (see note below on a non-blocking discrepancy).

**Evidence, independently re-verified by the audit:**
- `packages/quay-native/examples/sample-workspace/` ships 5 illustrative tasks (a compound epic
  with two primitive children, plus two standalone primitives) demonstrating the task view-model
  shape, bundled with its own `.quay/config.yml`. Round-trip fully confirmed: `task list` returns
  the 5 tasks; `task check SAMPLE-1A` PASS/terminal; `task check SAMPLE-1` FAIL 1/2 AC — all exact
  matches, checked via BOTH direct `quay-native` env-var invocation AND Core's own
  `.quay/config.yml` path.
- `packages/quay-native/package.json` and `packages/quay-github/package.json` genuinely lacked a
  `files` whitelist array pre-fix (confirmed via `git show 4b892e6:...`, i.e. npm default-include
  behavior, incidentally shipping `test/` and a stray `tasks/V-1.md` fixture); both now carry an
  explicit `files` array. `npm pack --dry-run` confirmed independently: no repo-backlog paths ship
  in any of the 3 package tarballs, and `examples/sample-workspace/` IS included in
  `quay-native`'s tarball.
- `README.md`/`packages/quay/DESIGN.md` diffs confirmed to substantively document the
  sample-vs-live-backlog distinction (not a token mention).
- `bash packages/quay/test/delivery-standalone-smoke.sh` — confirmed still 0 RED (no regression).

**Non-blocking discrepancy, disclosed transparently (not concealed):** the build agent
self-reported "253 tests, 249 pass, 4 fail" naming `adr-gate E3 A2` as one of the 4 failures. The
independent audit re-ran the full suite itself and got "253 tests, 250 pass, 3 fail" — on BOTH this
worktree AND a fresh `master` checkout, IDENTICAL in both runs. This means `adr-gate E3 A2` was
actually PASSING in the audit's own run and was NOT a regression introduced by this milestone —
pre-existing test flakiness (M49's own build report separately noted this same test is
"environment-path-resolution sensitive to direct in-process call without `QUAY_ACCEPTANCE_CWD`",
i.e. its pass/fail outcome depends on invocation environment/cwd, not on code changes). Since
worktree and master matched exactly in the auditor's own independent run, there is no regression
either way — the discrepancy is an inaccurate build-agent self-report about which/how-many tests
failed, not a real defect. Logged as a deviation row (see `inherited-core.md`'s deviation table,
caught-by: machine).

**Files.** `.quay/gate-events.jsonl` gitignore pattern broadened from `.quay/gate-events.jsonl` to
`**/.quay/gate-events.jsonl` at this same ABSORB, so nested sample/example workspaces (e.g. this
task's own `packages/quay-native/examples/sample-workspace/.quay/`) are also covered — a stray
untracked runtime-generated file from exercising the sample workspace's own gate commands was
confirmed not committed.

## Not selected (M48)
Considered as this milestone's slice; NOT selected — smaller in scope than DIR-035-A's architecture
fix but has no dependency relationship forcing it first, and DIR-035's own Requested action orders
the ABI fix (A) before data-driven gates (B) before this item (C) as items 1/2/3; deferred to a
future milestone's SELECT, most naturally after B lands (a fresh non-exp5 workspace's gate list is
easier to demo cleanly once B's data-driven sourcing exists).
