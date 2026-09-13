---
id: ADR-007
title: Instrument the dark axes L_G/L_D/L_S — a milestone is not judged on L_T alone
status: accepted
date: 2026-07-19
accepted-date: 2026-07-20
enforcement: "bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh"
supersedes: []
superseded-by: []
tags:
  - methodology
  - git-lens
  - verification
  - crystallization
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
     ⚠️ NOT ENFORCED on the mechanical fan-in flip: `worker-driver.ts` writes `status: done` from
        its own frontmatter patch without traversing the lifecycle verbs, so the loop's own landing
        path can still complete a task that has recorded nothing. Stated here rather than papered
        over — closing it needs a change in the driver, which is a different task's scope. A live
        git-lens gate over the milestone's own diff would RED immediately on exp5's ~1:8 code:doc
        ratio — which is the point (see DIR-036 / the 2026-07-20 evaluation). -->

## Consequences
- **Forbids:** an ABSORB/DoD that reports only `L_T` green while `L_G/L_D/L_S` are silently unexamined.
  **MECHANIZED 2026-09-13** (the per-milestone half, see the enforcement comment): the ready→done
  landing now fails closed on a task whose body neither records an L_D/L_G quantity nor declares the
  axis still dark — so "silently unexamined" is a state the gate can see, not a reviewer's opinion.
- **Enables:** archguard and mutation/property tests become standing milestone instruments (→ CLAUDE.md Tools pointer); the L_T..L_S review question (ADR-006) has runnable answers.
- **Scope / relations:** instance-of ADR-006; uses ADR-005's rationale; the proxies themselves are 硬形变 per ADR-004. Complements ADR-010 (which keeps `L_T` on the REAL axis).
