# M178 — iteration-0

**Task:** DIR-113
**Charter:** experiments/quay-perpetual-stream/charters/M178-dir113-touches-preflight.md

## Summary

Implemented DIR-113's touches-orthogonality pre-screen: moved the cheap `checkTouchesPair`
disjointness judgment from AFTER charter-authoring (expensive LLM fork) to BEFORE it, by making
task-level `## Touches` a first-class, checked artifact at SELECT time.

1. **New: `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts`** — mechanical
   extraction of file-path-shaped tokens from a task body (backtick-quoted spans, split on
   whitespace, overbroad-glob noise dropped via the single-source `isOverbroadDeclaration`,
   ambiguous/unresolvable bare filenames dropped rather than guessed). Sibling test
   `derive-touches-heuristic.test.ts` (24 assertions, 98.94% line / 94.64% branch coverage of the
   module) + `derive-touches-heuristic-selfcheck.sh` wrapper.
2. **`task-schema.ts`'s `checkTouches`** now takes `kind` and emits a soft (non-blocking) INFO
   warning — `touches-absent-milestone-candidate` — when a `milestone-candidate` task has neither
   a manual nor an auto-derived `## Touches` section.
3. **`select-preflight.ts`** gained `getCandidateParsedTouches` (declared Touches first,
   ephemeral `derive-touches-heuristic` fallback second) and `scanOrthogonalPairs` (pairwise
   `checkTouchesPair` over the top-N ranked candidates), wired into `buildPreflightResult` as step
   9 — runs and is logged BEFORE any charter-authoring fork exists, since select-preflight always
   precedes charter authoring in the pipeline. The CLI prints every log line to stderr in addition
   to the JSON payload, so the record is visible without parsing JSON.
4. **Backfilled real `## Touches`** on all 11 named autonomous-eligible candidates (DIR-099, 100,
   101, 103, 104, 105, 109, 110, 111, 112, exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN), each
   reviewed against its own `## Requested action`/Acceptance Criteria/Definition of Done file
   mentions (DIR-109 reused its M173 charter's already-landed Touches list).
5. `anti-drift-touches-check.ts` and `checkTouchesPair`'s own logic: untouched, per charter scope.

## Files changed

- `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts` (new)
- `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.test.ts` (new)
- `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic-selfcheck.sh` (new)
- `experiments/quay-perpetual-stream/scripts/task-schema.ts`
- `experiments/quay-perpetual-stream/scripts/select-preflight.ts`
- `tasks/DIR-099.md`, `DIR-100.md`, `DIR-101.md`, `DIR-103.md`, `DIR-104.md`, `DIR-105.md`,
  `DIR-109.md`, `DIR-110.md`, `DIR-111.md`, `DIR-112.md`,
  `exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN.md` — appended `## Touches`
- `tasks/gap-touches-orthogonality-symlink-isdirect-mismatch.md` (new — gap filed, see below)

## AC1 — derive-touches-heuristic.ts, superset demonstration against DIR-109

Sibling test embeds DIR-109's PRE-CHARTER task body (commit `15d58e9`, before the M173 charter
existed) and asserts the derivation is a superset of the M173 charter's landed Touches:

```
$ node --experimental-strip-types --experimental-test-coverage --test \
    experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.test.ts
...
✔ DIR-113 AC1: DIR-109 pre-charter body extraction is a superset of the M173-landed Touches (53ms)
...
ℹ tests 24
ℹ pass 24
ℹ fail 0
ℹ file                              | line % | branch % | funcs %
ℹ derive-touches-heuristic.ts       |  98.94 |    94.64 |  100.00
```

M173-landed (`charters/M173-dir109-canonical-test-runner.md`): `scripts/test.sh`,
`packages/quay/test/serve-github.test.mjs`, `packages/quay/test/provider-abi-conformance.test.mjs`,
`packages/quay/test/cli-edit-parity-conformance.test.mjs`, `CLAUDE.md`, `.github/workflows/ci.yml`.
Derived from the pre-charter body (bare filenames like `serve-github.test.mjs`, `CLAUDE.md`
resolved against the real repo tree via the unique-basename rule): all 6 present, plus
`adr/ADR-019-...md` (extra — allowed, superset).

## AC2 — pre-charter orthogonality log, real (non-fixture) SELECT preflight run

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts \
    --json --workspace-root /home/yale/work/quay --milestone-counter 178 \
    1>/tmp/select-preflight-stdout.json 2>/tmp/select-preflight-stderr.txt
$ grep '\[select-preflight\]' /tmp/select-preflight-stderr.txt
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-057 (auto-derived) ∥ DIR-099 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-057 (auto-derived) ∥ DIR-100 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-057 (auto-derived) ∥ DIR-101 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-070 (auto-derived) ∥ DIR-099 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-070 (auto-derived) ∥ DIR-100 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-070 (auto-derived) ∥ DIR-101 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-099 (declared) ∥ DIR-100 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-099 (declared) ∥ DIR-101 (declared) — disjoint file-sets
[select-preflight] ORTHOGONAL PAIR FOUND: DIR-100 (declared) ∥ DIR-101 (declared) — disjoint file-sets
```

This is a REAL run against the live task store (today's actual candidate pool, `--milestone-counter
178`), not a fixture — 9 real orthogonal pairs found among the currently-todo autonomous-eligible
candidates, printed to stderr BEFORE the JSON payload, and structurally always before any
charter-authoring fork (select-preflight always precedes charter authoring in the OUTER-LOOP/
execute-milestone pipeline). The "no pair found" arm is also exercised (selftest + unit test cover
it explicitly — `scan-log-explicit-on-none-found`, `scan-log-explicit-on-empty-candidates`).

## AC4 — golden-replay of M173's SELECT (DIR-070/DIR-109/DIR-110)

Real M173 outcome (from DIR-110's own task body, "Not selected (M173)" note): `DIR-109`×`DIR-110`
were found NOT touches-disjoint (both declare `.github/workflows/ci.yml`) → batch narrowed to
1-wide (DIR-109 only).

Replay #1 — direct pairwise check using the backfilled task-level Touches (real CLI, invoked via
the real file to sidestep the pre-existing symlink issue below):

```
$ node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts \
    tasks/DIR-109.md tasks/DIR-110.md
OVERLAP: tasks/DIR-109.md ✗ tasks/DIR-110.md — must serialize (overlapping file-sets) \
  [overlap: .github/workflows/ci.yml]
(exit 1)
```

Replay #2 — via `scanOrthogonalPairs` with the exact M173 candidate set {DIR-070, DIR-109,
DIR-110}:

```json
{
  "checkedCount": 3,
  "pairs": [
    { "a": "DIR-070", "b": "DIR-109", "reason": "disjoint file-sets" },
    { "a": "DIR-070", "b": "DIR-110", "reason": "disjoint file-sets" }
  ]
}
```

`DIR-109`×`DIR-110` is correctly ABSENT from the found-pairs list — reproduces the real M173
overlap verdict exactly (same reason: shared `.github/workflows/ci.yml`). DIR-070 pairs
"disjoint" with both from a pure-touches perspective, which is consistent: DIR-070's real M173
exclusion was via a SEPARATE mechanism (its only actionable child, DIR-070-F, carries
`label:human-steered`), not the orthogonality check — this replay only re-validates the
orthogonality judgment, which is DIR-113's actual scope. This proves the DIR-113 change only moves
the judgment earlier; the disjointness verdict on the pair that actually mattered (DIR-109 ×
DIR-110) is unchanged.

## AC3 — 11 candidates backfilled

```
$ grep -l '^## Touches' tasks/DIR-{099,100,101,103,104,105,109,110,111,112}.md \
    tasks/exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN.md | wc -l
11
```

Review record (each cross-checked against its own `## Requested action`/AC/DoD file mentions):

| Task | Touches (reviewed source) |
|---|---|
| DIR-099 | `quay.ts`, `config-validate.ts` (new, DoD2), `config-validate.test.mjs` (AC9), `README.md` (DoD4) |
| DIR-100 | `gate/config/loader.ts` (DoD1), `gate-diagnostics.test.mjs` (AC8) |
| DIR-101 | `store.ts`, `quay-native.ts`, `mcp-server.ts` (DoD1), `default-schema.test.mjs` (AC8), sample-workspace `config.yml` (DoD4) |
| DIR-103 | `acceptance-runner.ts` (implied by "the acceptance runner"), `quay.ts`/`mcp-server.ts` (DoD1 dry-run+gate_run), `README.md` (AC4/DoD3), `acceptance.test.mjs` (AC8), sample-workspace `config.yml` (DoD5) |
| DIR-104 | `quay.ts` (DoD1 `--verbose`), `gate/registry.ts` (DoD2 provenance tracking), `gate-list-verbose.test.mjs` (AC8) |
| DIR-105 | `store.ts:125`, `quay-native.ts:83`, `init.ts:71,81`, `default-status.test.mjs` — all 4 named verbatim in the directive's own "Code changes" list |
| DIR-109 | reused M173 charter's own landed Touches verbatim (already real-landed, verified in AC1 above) |
| DIR-110 | `test-coverage-check.ts` (new, Requested action item 1), `.github/workflows/ci.yml` (item 5), `adr/ADR-019-...md` (DoD3) |
| DIR-111 | `.github/workflows/ci.yml` (item 1), `CLAUDE.md` (item 2) |
| DIR-112 | `packages/quay/test/cli.test.mjs` (the directive's own Plan: "touches only ...cli.test.mjs") |
| exp5-ADR-TOOLSEARCH... | `CLAUDE.md` (per the task's own "Scope narrowed" note — M148 precedent, one paragraph) |

## AC5 — anti-drift-touches-check.ts untouched, existing suite state

`anti-drift-touches-check.ts`, `touches-orthogonality-check.ts`, `concurrent-batch-scheduler.ts`
and `checkTouchesPair` itself were **not modified** by this milestone (confirmed: absent from
`git status`/`git diff` for this session).

Running their fixture selfchecks surfaced a **pre-existing, unrelated** failure (confirmed via
`git stash` on this session's changes, reproduced identically on clean `master`):

```
$ git stash && bash experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh
PASS: clean-batch — exit 0 (expected 0)
FAIL: mis-declared-overlap-BITES — exit 0 EXPECTED 1
FAIL: stray-write-BITES — exit 0 EXPECTED 1
FAIL: overbroad-declaration-BITES — exit 0 EXPECTED 1
$ git stash pop
```

Root cause: these 3 scripts are symlinks (`experiments/.../scripts/*.ts -> plugin/scripts/*.ts`,
from the recent "mirror gate-script-lib.sh into plugin/scripts/" commit `66647b4`); their
`isDirect` guard compares `fileURLToPath(import.meta.url)` (realpath-resolved to the
`plugin/scripts/` target) against the raw, non-realpath `process.argv[1]` — these never match when
invoked via the `experiments/…/scripts/` symlink path (the path every selfcheck and
`gate_delegate_ts` uses), so `main()` silently never runs (exit 0, no output). Invoking the real
file directly works correctly (see AC4's Replay #1 above — real OVERLAP/exit 1 result). This is
**not a regression from DIR-113** (reproduced on a clean stash) and **not caused by, or fixable
within, this milestone's scope** (charter explicitly excludes touching
`anti-drift-touches-check.ts`/`touches-orthogonality-check.ts`/`concurrent-batch-scheduler.ts`'s
own logic). Filed as `gap-touches-orthogonality-symlink-isdirect-mismatch` with full reproduction
and a proposed fix (compare realpaths on both sides), left for a follow-up milestone.

The underlying logic itself (imported and exercised directly, not via the broken CLI entrypoint)
is proven correct in this iteration's own evidence: AC4's Replay #1 (`OVERLAP`, exit 1, real
mis-overlap) and the `task-schema-selfcheck.sh` / `select-preflight` test suites (21/21 +
selftest, unaffected) all pass.

## Item 2 (soft schema warning) — spot check

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/task-schema-check.ts \
    experiments/quay-perpetual-stream/fixtures/schema/milestone-compliant-stub.md
PASS: ...milestone-compliant-stub.md — schema v1 conformant (kind=milestone-candidate)
INFO: ...milestone-compliant-stub.md — touches-absent-milestone-candidate: INFO: milestone-candidate
  task has no '## Touches' (manual or auto-derived) — the pre-charter orthogonality scheduler has
  no hint for this candidate and will treat it conservatively
```
Non-blocking (`PASS`, exit 0) — matches the "soft, warn, not fail-closed" requirement.
`task-schema-selfcheck.sh`'s existing 14 fixtures still all pass unmodified (exit codes unaffected
by an INFO-level warning).

## Test runs

```
$ bash experiments/quay-perpetual-stream/scripts/derive-touches-heuristic-selfcheck.sh
... 24/24 pass

$ bash experiments/quay-perpetual-stream/scripts/task-schema-selfcheck.sh
... 14/14 pass

$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts --selftest
... all fixture cases PASS (34 checks, including 9 new getCandidateParsedTouches/scanOrthogonalPairs cases)

$ node --experimental-strip-types --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
... tests 21, pass 21, fail 0 (includes a real end-to-end CLI run against this repo)
```

`packages/*` product code was not touched by this milestone (exp5-tooling + `tasks/*.md` only), so
the full `scripts/test.sh` product suite was not re-run — no path exists by which this change
could affect it.

## Scope note

Requested-action item 1's DRAIN-integration wording ("DRAIN 把一个 directive disposition 成
milestone-candidate 时...自动生成") describes the eventual consumer of
`derive-touches-heuristic.ts`; wiring it into `drain-scheduler.ts` itself is NOT in the charter's
own `## Touches` list (which lists the heuristic script + its selfcheck, `select-preflight.ts`,
`task-schema-check.ts`/`.sh`, and the 11 task files — not `drain-scheduler.ts`), and is not named
in any AC/Done-when clause — the heuristic is complete and independently testable/usable (by
`select-preflight.ts`'s own ephemeral fallback, already wired) without that integration. Left
out of scope for a future milestone if wanted.

## Gap filed this iteration

`gap-touches-orthogonality-symlink-isdirect-mismatch` — see AC5 above.
