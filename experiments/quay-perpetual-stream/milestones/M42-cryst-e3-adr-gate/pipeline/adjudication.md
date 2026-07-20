# exp5-M-CRYST-E3 — quay-task-to-plan pipeline: adjudication (Stage 6.3)

## Verdict: DIVERGENCE on `enforcement` shape — ADJUDICATED, Proposal 1 wins (with one Proposal-2 refinement folded in)

**Reasoning:**
1. **ADR-001's own text is the tiebreaker.** ADR-001's Consequences section already names its own
   enforcement mechanism as a concrete runnable: `experiments/quay-perpetual-stream/scripts/
   loadbearing-test-gate.mjs` (wrapper `.sh`). The B7 gate's own real invocation shape (confirmed by
   reading `loadbearing-test-gate.sh` directly) is `loadbearing-test-gate.sh --scripts <dir> [--tests
   <dir>] [--import-root <dir> ...] [--registry <file>] [--outer-loop <file>]` — a full command with
   several flags, not a single `{check, args}` pair naming ONE fixed script with positional args
   (unlike `impl-row`/`line-budget`, which each wrap exactly one script with one args array).
   Proposal 1's raw-command-string `enforcement` field maps directly and losslessly onto this real
   shape; Proposal 2's structured `{check, args}` would need `args` to smuggle in the SAME
   `--scripts/--tests/...` flag structure anyway (its own `args` array is just as unstructured once
   you look at what actually has to go in it) — so Proposal 2's schema adds a layer of indirection
   (a lookup-table `checkName`) without buying real safety, because the flags inside `args` are still
   free-form.
2. **Precedent consistency.** `task.extra.acceptance` (QENG-2) already stores a full runnable command
   string, not a structured object — Proposal 1 keeps `enforcement` in the SAME convention family as
   the one gate mechanism that ALREADY handles "an arbitrary human/loop-authored runnable", which is
   exactly what an ADR's enforcement command is. Introducing a second, structured convention for a
   materially similar use case (Proposal 2) adds cognitive/maintenance surface without a concrete
   safety win (per point 1 — the flags are still unstructured inside `args`).
3. **Proposal 2's "one mistyped command is a smell" security concern is real but not solved by its
   own design** — a structured `{check,args}` still runs `spawnSync(shell:true)` under the hood (same
   `runAcceptance` runner both proposals reuse), so the actual execution-safety profile is identical
   either way; the difference is purely which frontmatter shape a human edits. Given point 1's finding
   that the REAL shape (B7's actual flags) doesn't fit a fixed-script + args-array cleanly, Proposal
   1's plain command string is adopted.
4. **Folded-in refinement from Proposal 2:** its "small declarative table so a future ADR-002 gate is
   a one-line addition, not a copy-pasted `makeAdrGate` call" point is adopted as-is — it does not
   conflict with Proposal 1's command-string `enforcement` field; it is purely about how registry.js
   organizes its registration call sites, and is strictly better than a bespoke call site per ADR. It
   generalizes CLEANLY: `ADR_GATE_IDS = ["ADR-001"]` (or read `applies-to`/`enforcement`-bearing
   accepted ADRs dynamically at module load — see plan for the exact choice) driving a `for` loop that
   calls `makeAdrGate(id)` once per entry, still all wrapping the SAME raw command string from that
   ADR's own `enforcement` field — no schema divergence from point 1-3's conclusion.

## Adopted approach (final, reconciled)

- `adr-store.js` view-model gains `appliesTo` (from `applies-to`) and `enforcement` (raw string,
  verbatim) fields — additive, non-breaking.
- `packages/quay/src/gate/registry.js` gains `makeAdrGate(adrId, adrDir)` — reads the ADR via
  `createAdrStore(adrDir).get(adrId)` at RUN TIME (not module-load time, so edits to the ADR's
  `enforcement` field take effect without a process restart), fails closed if the ADR is
  missing/not `accepted`/has no non-empty `enforcement` string, else shells out via the existing
  `runAcceptance` runner with that exact command string (cwd/timeout resolved the SAME way
  `acceptance` already does via `QUAY_ACCEPTANCE_CWD`/`QUAY_ACCEPTANCE_TIMEOUT_MS`).
- Registration is via a small table iterated once at module load: `const ADR_GATE_IDS = ["ADR-001"]`
  (documented as "add future wired ADR ids here"), each producing one `gateRegistry["adr-<nnn-lower>"]
  = makeAdrGate(id, ADR_DIR)` entry (gate NAME lowercases the numeric suffix, e.g. `adr-001`, per the
  task's own AC1 naming: `gate: "adr-<id>"`).
- ADR-001's frontmatter gains `applies-to: ["experiments/quay-perpetual-stream/scripts/**"]` and
  `enforcement: "bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts
  experiments/quay-perpetual-stream/scripts"` (paths repo-root-relative, matching the `acceptance`
  gate's own `QUAY_ACCEPTANCE_CWD=workspaceRoot` convention).
- Consult surface: `adr-store.js`'s `list()` gains an `appliesTo` filter predicate (glob match against
  each ADR's `applies-to` array using Node's built-in glob semantics or a tiny hand-rolled matcher —
  no new dependency), exposed via `quay-native adr list --applies-to <path>` (CLI) and the existing
  MCP `list` passthrough (no MCP schema change needed if `appliesTo` filter is just another optional
  flag on the same tool, mirroring `status`/`tag`).

## Alternatives preserved (not discarded)

- Proposal 1's rejected dynamic-resolver idea and Proposal 2's rejected raw-shell-string concern are
  both preserved above (adjudication reasoning points 1-3) rather than silently dropped — a future
  ADR gate needing genuinely different args-passing (not just a full command) should re-open this
  question, not silently copy today's shape.

## Write-back

Written to `tasks/exp5-M-CRYST-E3.md`'s `## Proposal` section (idempotent full-section replace) —
see the task file; `task_write`-equivalent direct file edit used (native provider, this repo, per
DIR-011 body-portable convention — the CLI/MCP full-field write path, never the status-only `task
edit`).
