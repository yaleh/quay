---
id: ADR-007
title: Instrument the dark axes L_G/L_D/L_S — a milestone is not judged on L_T alone
status: accepted
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - git-lens
  - verification
  - crystallization
accepted-date: 2026-07-20
enforcement: bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh
---
## Context
Applying the GIT lens (ADR-006) to this project's own review: normal review instruments `L_T` (tests pass) and half of `L_C` (types/constraints); `L_G` (reinvented/duplicated abstractions), `L_D` (description length / dependency structure), and `L_S` (behavior variance) are DARK (`docs/references/geometry-as-llm-architecture-interface.md` §5, layer-一). A green `L_T` on a cheap proxy can be a pseudo-convergence on the wrong axis (the curl-vs-real-subagent lesson; see ADR-010). Judging a milestone on `L_T` alone is systematic blindness.

## Decision
A milestone MUST NOT be judged on `L_T` (tests pass) alone. Build **cheap executable proxies** for the dark axes and consult them before calling a milestone done:
- `L_D` (description length / dependency structure): **archguard** — dependency cycles, god-packages, fan-in/out, structure metrics.
- `L_G` (generative-alignment / reinvented-duplicated abstractions): **archguard** entity/duplication signals + review for concept-level reinvention.
- `L_S` (stability / behavior variance): **mutation / property tests**.
This is an instance of ADR-006 and a specific application of ADR-005 (cheap verification over more generation).

<!-- enforcement (TWO halves, both landed):
     ── HALF 1, instrument integrity (WIRED 2026-07-20 as the `adr-007` gate, via the
        gates.adr list in .quay/config.yml → makeAdrGate): the frontmatter `enforcement:` command
        runs `experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` — the fixture-backed
        RED/GREEN regression gate for the three L_D/L_G/L_S proxies (landed M41). It guards the
        INSTRUMENT against rot (the proxies still detect a prose-heavy diff / a new cycle / a weak
        module).
        ⚠️ KNOWN ROT, recorded 2026-09-13 (found while landing HALF 2, NOT introduced by it): the
        three probes it invokes were moved out of `plugin/scripts/` into
        `archive/2026-09-07-zero-call-scripts/plugin/scripts/`, leaving
        `experiments/quay-perpetual-stream/scripts/git-lens-*.ts` as DANGLING SYMLINKS.
        `git-lens-selfcheck.sh` now exits 1. It still prints a plausible PASS line for the
        `prose-heavy` L_D case — because MODULE_NOT_FOUND also exits 1, which happens to equal the
        expected code for that fixture. A check whose fixture cannot distinguish "the proxy detected
        it" from "the proxy did not load" is the 硬规则 3b shape (an unreadable input returning a
        value shaped like a verdict), and it is why the rot went unnoticed for six days. The
        `adr-007` gate is registered but is not run by the suite and has 0 events in
        .quay/gate-events.jsonl, so nothing surfaced it. Fixing the probes is a separate task —
        this ADR does not silently absorb it.
        ⚠️ The KNOWN ROT note above is STALE as of 2026-10-22 (kept as history, not deleted) — see
        the "Status note 2026-10-22" block at the end of this ADR for the current state.
        ✅ HALF 1 REPAIRED 2026-10-22 (tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-
        never-invoked). Two changes, both in the SAME enforcement command (the frontmatter string is
        unchanged):
          • `git-lens-selfcheck.sh` is now THREE-VALUED: each fixture prints PASS / FAIL /
            `NOT-EVALUATED(<cause>)`, and the exit code is 0 (all PASS) / 1 (≥1 FAIL) / 2 (no FAIL
            but ≥1 NOT-EVALUATED). Before invoking an axis it verifies the probe ENTRY loads; a probe
            that cannot be loaded can therefore no longer produce an exit code that happens to equal
            the expected one. The KNOWN ROT note's count is corrected: **3** fake PASSes, not 1
            (`l-d/prose-heavy`, `l-g/cycle-repo`, `l-s/weak-module` — all expected exit 1, which is
            what MODULE_NOT_FOUND also returns).
          • The L_D and L_G cases point at LIVE instruments instead of the archived probes (⛔ the
            archive was not restored): L_D = `plugin/scripts/phase-declare.ts --ld-reading
            --numstat-file <f>` (the ADR-008 declaration's own `parseNumstat`/`computeRatio`, in a
            read-only mode that writes no carrier); L_G = `archguard-runner.ts`'s
            `readDirectoryCycleReading(root, workDir)` (the SAME reader the arch-cycle-report routine
            consumes) over `fixtures/git-lens/l-g-archguard/{cycle,clean}/query/`.
          • **L_S is retired as an instrument for PRODUCT code, and this is now RECORDED, not
            silent.** No mutation/property test of product behaviour is wired; the one instrument
            that calls itself "the L_S instrument" (`checker-mutation-check.sh`) mutates the
            checkers. Both L_S fixture cases are KEPT and print
            `NOT-EVALUATED(axis-retired: no living product-code L_S instrument)`. The selfcheck
            therefore exits 2 on a healthy repo — "one axis cannot be judged" is a real reading, and
            is never folded into 0.
          • The gate now has a CALLER: the declarative report-only routine
            `adr-enforcement-report` (plugin/scripts/quality-gate-driver.ts, default interval
            1440m) runs every `gates.adr` ADR that is accepted and carries `enforcement:` through the
            gate engine's `runGate`, so GateEvents accumulate (actor `quality-gate-driver`) and each
            round contributes one Fact to `.quay/quality-round.jsonl`. ⛔ It is NOT on the fan-in hot
            path.
     ── HALF 2, the PER-MILESTONE predicate (LANDED 2026-09-13,
        tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate): a task must RECORD a dark-axis
        reading or explicitly DECLARE the axis still dark, before it can be called done. The
        single implementation is `classifyDarkAxisRecord` in
        `packages/quay/src/gate/dark-axis-record.ts` (RECORDED / DISCLAIMED / MISSING, plus
        NOT-EVALUATED for an unreadable body — its own value, never folded into MISSING or RECORDED,
        硬规则 3b). Three faces, one rule:
          • the built-in gate `dark-axis` — `packages/quay/src/gate/registry.ts`;
          • REQUIRED on the ready→done landing — `enforceDarkAxis` in
            `packages/quay/src/gate/lifecycle.ts`, run by BOTH `runComplete` and
            `runCompleteLoop` (fail-closed; status stays `ready` and a `dark-axis` fail GateEvent is
            appended);
          • the standalone CLI — `plugin/scripts/dark-axis-record-check.ts <task-id>`
            (exit 0 RECORDED/DISCLAIMED, 1 MISSING, 2 NOT-EVALUATED), plus a per-ready-task
            `dark_axis` list in `plugin/scripts/ready-pool-check.ts`'s pool report.
        The switch is the workspace's own `gates.adr` declaration of `ADR-007` — the same
        declaration that wires HALF 1 (`workspaceEnforcesDarkAxis`). This workspace declares it, so
        the predicate is LIVE here; a workspace that does not declare the ADR is unaffected.
        A declaration must carry a reason (`该轴仍暗,理由:<...>`); a bare marker does not discharge
        the obligation. Because the three probes are currently archived (see HALF 1's rot note), a
        reading in practice comes from archguard or an equivalent structural instrument — the
        predicate asks for a RECORDED quantity, not for one specific tool's stdout.
     ✅ ENFORCED on the mechanical fan-in flip since 2026-10-22
        (tasks/gap-mechanical-fan-in-flip-bypasses-adr007-dark-axis-predicate): `worker-fan-in.ts`'s
        `runMechanicalFanIn` now runs a `dark-axis` step AFTER `ac-gate` and BEFORE `flipTaskDone`,
        reading the WORKTREE's task body through the same `classifyDarkAxisRecord` /
        `taskBodyOf` and the same `workspaceEnforcesDarkAxis` switch the lifecycle verbs use.
        MISSING refuses the flip (task stays `ready`, worktree retained); NOT-EVALUATED refuses with
        its OWN reason; every judgment appends a `dark-axis` GateEvent (actor `quay-driver`), so the
        complete:dark-axis ratio is a readable quantity rather than a rediscovered gap. The worker
        dispatch prompts (`buildWorkerPrompt` / `buildContinueWorkerPrompt`) state the obligation and
        both accepted forms. The historical 2026-09-13 "NOT ENFORCED" warning is superseded: before
        this, `worker-driver.ts`/`worker-fan-in.ts` had zero dark-axis references and 795 of 816
        `complete` events since 2026-09-14 came from the driver's landing path. A live git-lens gate
        over the milestone's own diff would still RED immediately on exp5's ~1:8 code:doc ratio —
        which is the point (see DIR-036 / the 2026-07-20 evaluation). -->

## Consequences
- **Forbids:** an ABSORB/DoD that reports only `L_T` green while `L_G/L_D/L_S` are silently unexamined.
  **MECHANIZED 2026-09-13** (the per-milestone half, see the enforcement comment): the ready→done
  landing now fails closed on a task whose body neither records an L_D/L_G quantity nor declares the
  axis still dark — so "silently unexamined" is a state the gate can see, not a reviewer's opinion.
- **Enables:** archguard and mutation/property tests become standing milestone instruments (→ CLAUDE.md Tools pointer); the L_T..L_S review question (ADR-006) has runnable answers.
- **Scope / relations:** instance-of ADR-006; uses ADR-005's rationale; the proxies themselves are 硬形变 per ADR-004. Complements ADR-010 (which keeps `L_T` on the REAL axis).

**Amended 2026-10-22 (re-evaluation against 3 months of production data) — Status note 2026-10-22**
— human-approved 2026-10-22. Supersedes the 2026-09-13 KNOWN ROT note as the description of current
state; that note stays in the enforcement comment as history.

- **HALF 1 was dead — REPAIRED later on 2026-10-22** (see the "HALF 1 REPAIRED" block in the
  enforcement comment). As recorded at drafting time: the dangling `git-lens-*.ts` symlinks had been
  removed by `tasks/gap-arch-retire-orphan-sh-and-dangling-symlinks.md` (status `done`); the three
  probes exist only under `archive/2026-09-07-zero-call-scripts/plugin/scripts/`. But
  `experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` remained, and the frontmatter
  `enforcement:` still points at it, so it failed deterministically (re-run 2026-10-22: exit 1,
  `MODULE_NOT_FOUND` on 4 fixtures, while still printing `PASS:` for the three fixtures whose
  expected exit is 1 — `l-d/prose-heavy`, `l-g/cycle-repo`, `l-s/weak-module`). The `adr-007`
  gate had **0** events in `.quay/gate-events.jsonl` in the ~94 days since it was wired on
  2026-07-20. The repair is: three-valued selfcheck + live L_D/L_G instruments + explicit L_S
  retirement + a declarative routine (`adr-enforcement-report`, 1440m) that is the gate's caller.
- **The frontmatter `enforcement:` string itself is unchanged** — the repair is inside the script it
  names and in the routine that invokes the gate. The 2026-07-19 Decision text also stands
  unchanged; what changed is whether the enforcement is RUNNABLE and whether anything RUNS it.
- **HALF 2 is live but covers little of the landing flow.** Since 2026-09-14,
  `.quay/gate-events.jsonl` holds **36** `dark-axis` gate events (**23** pass / **13** fail)
  against **816** `complete` events (815 when this amendment was drafted; one more landed at
  2026-10-22T00:36Z), i.e. about **4%**.
- **The mechanical fan-in no longer bypasses the predicate (closed 2026-10-22,
  tasks/gap-mechanical-fan-in-flip-bypasses-adr007-dark-axis-predicate).** The reading above is the
  reason the gap existed: `grep -n -i 'darkaxis\|dark-axis' plugin/scripts/worker-driver.ts
  plugin/scripts/worker-fan-in.ts` returned **zero** hits while 795 of 816 `complete` events came
  from the driver's landing path. `runMechanicalFanIn` now judges the worktree's task body at a
  `dark-axis` step between `ac-gate` and `flipTaskDone`, refuses MISSING and NOT-EVALUATED, and
  writes a `dark-axis` GateEvent for every judgment (actor `quay-driver`). Replaying the predicate
  over the 793 distinct tasks the driver landed since 2026-09-14 gives MISSING 782 / DISCLAIMED 11 /
  RECORDED 0 — so the ratio is expected to move only as workers start recording; that transfer is
  the point, not a regression.
- **L_S: DARK for product behavior — now recorded by the enforcement instrument itself.** The L_S
  behavior-variance probe (`git-lens-l-s-behavior-variance.ts`) is archived, and no
  mutation/property test of product behavior is wired. One instrument does run and calls itself
  "the L_S instrument": `plugin/scripts/checker-mutation-check.sh`, in the static phase of
  `scripts/test.sh`. Its subject is the **checkers** (would each checker fail when its subject is
  mutated?), not the product's behavior variance. So the checker slice of L_S is lit, and L_S as
  this ADR's Decision defines it (product stability / behavior variance) is DARK — which
  `git-lens-selfcheck.sh` now states explicitly (`NOT-EVALUATED(axis-retired…)`, exit 2) instead of
  printing a PASS it never measured.
- Per ADR-004's 2026-10-22 amendment, a check with no liveness reading counts as a dark axis. By
  that rule HALF 1 is dark: it is declared and has never produced an event.
