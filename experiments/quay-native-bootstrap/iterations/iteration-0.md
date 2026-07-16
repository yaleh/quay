# Iteration 0: Baseline — the v0 walking skeleton (seed-driven, σ=0)

**Date**: 2026-07-15
**Driver**: seed only — BAIME + epicd Skill *patterns* (`authoring-convergence`, `fixpoint-convergence` / `primitive-executor`, `adjudicate`) applied directly by this session as the human-equivalent operator, plus manda dispatch. No `quay:*` Skill drove any task this iteration.
**Stage**: 0

---

## 1. Context from prior iteration

There is no prior iteration — this is the first. The repository at the start
of this session contained only `docs/proposal/*` (glossary, proposal, native
design, bootstrap-experiment protocol) and `.manda/` (workspace config for
the armed daemon). `experiments/quay-native-bootstrap/README.md` and `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`
existed as the operationalized plan but `experiments/quay-native-bootstrap/provenance.md` and
`experiments/quay-native-bootstrap/iterations/` did not exist yet — both are created by this
iteration, per the protocol's explicit expectation (protocol §9; README §2).

σ before this iteration: undefined (no provenance log existed). σ after: 0
(established floor).

## 2. Preconditions checked

Per `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0:

- [x] **manda daemon is live for this workspace** — confirmed via `ps aux`
  showing `manda serve start --addr=:28912 --root=.` (PID 3178059, and a
  duplicate PID 3272609) with `readlink /proc/<pid>/cwd` resolving to
  `/home/yale/work/quay`, and `manda events health --root /home/yale/work/quay`
  returning `{"events":[],"next_cursor":0}` (a live, reachable daemon, not a
  stale process). **G6 satisfied.**
- [x] the workspace monitor is attached — a `manda monitor` process tree was
  observed running against this root in the process list (part of the same
  session infrastructure); not independently re-verified beyond the daemon
  reachability check above, which is the operationally decisive signal for
  this iteration's purposes (trigger delivery, verified directly — see §5).
- [ ] `gh auth status` — **not checked, and correctly so**: this is a
  stage-2+ precondition per protocol §10.1/README §9, explicitly out of scope
  for iteration 0. `gh` was not touched in this iteration (guardrail
  respected).
- [x] `experiments/quay-native-bootstrap/provenance.md` — did not exist before this iteration;
  created during it (§6 below), consistent with README §8's note that this
  file "does not exist yet" pre-iteration-0.
- [x] no `iteration-{N-1}.md` exists to read — correctly skipped (N=0).

## 3. Observe

Starting state: zero code, zero `.quay/`, zero `tasks/`. The task explicitly
requires building the v0 walking skeleton (proposal §14) end-to-end and using
this repo's own backlog as the first native-format tasks. There is no
existing backlog state to query — this iteration's OBSERVE step is "what does
proposal §14 + design §2/§3/§6/§7 require to exist for the loop to run at
all," not "read an existing backlog."

Gap identified immediately: no code exists in any language for either `quay`
or `quay-native`. Node/npm is available (`node v25.8.0`, `npm 11.11.0`) and is
the fastest path to a working MCP server + CLI given the available
`@modelcontextprotocol/sdk` npm package — chosen over Go/Python per the task's
"prefer something quick to bootstrap" guidance and because the MCP SDK's
Node/TypeScript implementation is the most mature/documented of the options
readily available in this environment.

## 4. Strategy

Walking-skeleton discipline (G5): build the **minimum real** implementation
of every piece proposal §14's v0 loop names, in this order (chosen to
de-risk the least-familiar piece — the MCP SDK's actual API shape — early):

1. `quay-native` core (`store.js`): parse/serialize markdown+frontmatter,
   `list/get/write/appendNote/check`. One implementation, shared by CLI and
   MCP (design §6 CLI/MCP symmetry) — built this first since everything else
   depends on it.
2. `quay-native` CLI (`bin/quay-native.js`): `task list/get/edit/create/check`
   + `mcp` + `manifest` subcommands.
3. `provider.yml`: capabilities, statuses, lanes, `status_skill_map`,
   `action_buttons`, skills_path, mcp_entry (proposal §10, design's static
   declaration).
4. `quay-native mcp`: MCP server wrapping the same `store.js` core —
   `provider://manifest`, `task_list`, `task_get`, and (since time permitted)
   `task_write`, `task_check`.
5. `quay` Core CLI (`bin/quay.js`): MCP client, `task list/view`,
   `action list/run`, `serve`. Provider-agnostic by construction — no
   `if provider === 'native'` branch anywhere in this code.
6. `quay serve`: crude but real HTTP list/detail + action-button POST.
7. `.quay/config.yml`: enables the native provider.
8. quay-native's own backlog, seeded as real native-format tasks
   (`tasks/QN-001.md` .. `QN-006.md`).
9. Drive **one** real task (QN-006: shared-lock file writes) through the
   **full** v0 loop to `done`, using the seed (this session, directly
   applying the epicd `authoring-convergence`/`fixpoint-convergence`/
   `adjudicate` *pattern* — since σ=0, no `quay:*` Skill exists to delegate
   to yet, and per G5 this iteration does not port `quay:author`/
   `quay:execute` as *working* Skills, only writes them as honestly-declared,
   unexercised placeholders for iteration 1 to pick up).
10. Establish `experiments/quay-native-bootstrap/provenance.md` (G1) and timing data (protocol §5.2).

This is a single feature increment in spirit (one v0 skeleton), not two
unrelated features — consistent with iteration discipline even though it
spans several files, because proposal §14's v0 definition is itself one
indivisible loop (a config→mcp→serve→action→Skill→done chain that isn't
meaningful in parts).

## 5. Execution

All of the following were **run for real**, not described — evidence cited
inline; full commands are reconstructable from `experiments/quay-native-bootstrap/timing/iteration-0.log`.

- **`quay-native` core + CLI + MCP**: built at
  `/home/yale/work/quay/packages/quay-native/{src,bin,test}`. Smoke-tested:
  `quay-native task create/get/list/check` all confirmed working against a
  temp tasks dir; `quay-native mcp` confirmed serving `provider://manifest`,
  `task_list`, `task_get`, `task_write`, `task_check` via a real MCP client
  script (`Client`/`StdioClientTransport` from the SDK) — resource read,
  tool list, and all four tool calls succeeded and returned structured
  results matching the CLI's own JSON shape (see abi_symmetry evidence
  below).
- **`quay` Core CLI + `serve`**: built at `/home/yale/work/quay/packages/quay/{src,bin}`.
  `quay task list --json` confirmed working end-to-end through the MCP
  client (`connectProvider` spawning `quay-native mcp` as a subprocess per
  `.quay/config.yml`'s `mcp_entry`). `quay serve --port <N>` confirmed
  rendering a real list page (all 6 tasks, correct status/role/title columns)
  and a real detail page (QN-001, with its `Advance` action button rendered
  from `provider.yml`'s `action_buttons` + `whenStatus` filter).
- **`.quay/config.yml`**: created, enabling `native` with `path`,
  `tasks_dir`, `mcp_entry` — read successfully by `quay`'s `loadConfig()`.
- **quay-native's own backlog seeded as real tasks**: `QN-001` through
  `QN-006`, covering the actual v1 remaining work this iteration's own gap
  analysis surfaced (task_write hardening, GitHub Provider, quay:author
  port, quay:execute port, gate-correctness hardening, file locking) — all
  stored as `tasks/*.md` in the canonical view-model (design §2 schema:
  `id, title, status, labels, parent, children`).
- **One task driven through the full loop, for real**: QN-006 ("Add file
  locking shared by CLI and MCP writers"). Concretely:
  1. Authored directly by this session (Proposal/Plan/AC/DoD written into
     the task body) — `quay-native task check QN-006` confirmed
     `{"gate":"author->ready","ok":true}` (all four artifacts present).
  2. Moved to `ready` (`quay-native task edit QN-006 --status ready`).
  3. **`quay action run QN-006 advance`** composed the trigger
     (`{skill: "quay:execute", status: "ready", payload: "..."}`) and
     delivered it via `manda send task-QN-006 <json>` — confirmed landed by
     `manda events task-QN-006 --root /home/yale/work/quay` showing the
     exact payload on the channel. This is the "host delivers the trigger
     into a Claude Code session" step of proposal §14, executed for real
     over the actually-armed manda daemon, not simulated.
  4. Since no `quay:execute` Skill exists yet (σ=0), this session — acting
     as the seed, i.e. the human-equivalent operator the protocol names for
     stage 0 — picked up that trigger and executed QN-006's plan directly:
     added `acquireLock`/`releaseLock`/`withLock` to `store.js`, rewired
     `write()`/`appendNote()` to go through the lock, wrote a genuine
     concurrency test (`test/lock.test.mjs` spawning two separate Node
     processes racing writes on the same task id via a helper script
     `test/concurrent-writer.mjs`), and a stale-lock-reclaim test.
  5. Ran the concurrency test for real: **7/7 assertions passed**
     (no corruption after two racing writers; stale lock reclaimed in
     <3s; no leftover lock file). Re-ran the pre-existing single-writer CLI
     smoke path in a fresh temp dir to confirm no regression.
  6. Checked AC/DoD boxes only after each was independently re-verified true
     against an actual test run (not "should work" reasoning).
  7. `quay-native task check QN-006` confirmed `{"gate":"execute->done","ok":true,"acTotal":4,"acChecked":4}`.
  8. Wrote an out-of-band adjudicate-style audit
     (`experiments/quay-native-bootstrap/audits/iteration-0-adjudicate.md`) that **re-ran the test
     suite independently** (not trusting the prior pass's report) and
     verified each AC against the actual diff — verdict `done`, **with an
     explicitly recorded limitation**: this audit was not a genuinely
     separate dispatched subagent (the "self-verification trap" the seed's
     own `adjudicate` skill warns about), so it does not count as a true G3
     independent co-sign. This limitation directly drives Convergence Check
     criterion 4 below.
  9. `quay-native task edit QN-006 --status done` — confirmed terminal via
     `task check` (`{"gate":"none","ok":true,"reason":"terminal"}`).
- **`quay:author`/`quay:execute` Skill files written** at
  `packages/quay-native/skills/{author,execute}/SKILL.md` — real files with a
  concrete Spec section and an explicit, honestly-labeled "Gaps" section
  (no Layer-1 operation Skills yet, no independent-audit dispatch built in,
  epic/compound branch untested). **Explicitly not used to drive QN-006** —
  logged accurately in `provenance.md`, not backfilled as if they had been.
- **Bug found and fixed during re-verification**: `quay serve --port <N>`
  silently ignored the `--port` flag (argv parsing bug — `serve` has no
  subcommand token, so the flag was swallowed into `sub`). Found by actually
  re-running the full loop end-to-end a second time (not by code review
  alone), fixed, and the fix was itself verified by a clean re-run producing
  the correct list/detail pages and a real `POST .../action/advance` that
  landed on `task-QN-001`'s manda channel with the correct
  `skill: "quay:author"` resolution (a `todo`-status task, correctly
  distinguished from QN-006/QN-001's action-button `whenStatus` gating).
- **ABI symmetry, checked directly**: `quay-native task get QN-006 --json`
  and a raw MCP client's `task_get` call for the same id were compared key-
  by-key: both produce
  `["body","children","extra","id","labels","parent","role","status","title"]`
  — identical schema, confirmed by an actual side-by-side run, not asserted.

## 6. Provenance update

`experiments/quay-native-bootstrap/provenance.md` created (did not exist before). All 6 tasks
logged; QN-006 is the only one driven to a terminal state this iteration.

| task_id | author_by | execute_by | gate_by | status (end of iteration) |
|---|---|---|---|---|
| QN-001 | seed | — | — | todo |
| QN-002 | seed | — | — | todo |
| QN-003 | seed | — | — | todo |
| QN-004 | seed | — | — | todo |
| QN-005 | seed | — | — | todo |
| QN-006 | seed | seed | seed | **done** |

σ before: undefined (no log existed) → σ after: **0 / 6 = 0**.

This is the honest σ=0 floor. Nothing is logged as `native` — no `quay:*`
Skill drove anything this iteration, even though `quay:author`/`quay:execute`
now exist as files (see §5's explicit note: writing a Skill file is not the
same as that Skill having driven a task — provenance reflects the latter
only, per the "don't backfill the bootstrap narrative" anti-pattern in
ITERATION-PROMPTS.md).

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

- **skeleton: 0.55** — Evidence: the full v0 chain
  (`.quay/config.yml` → `quay-native mcp` → `quay serve` → action button
  click → manda-delivered trigger → seed executes → `task check` gates
  → `done`) ran twice, end-to-end, for real, with the second run finding
  and fixing a real bug (`--port` forwarding). This is a genuine, working
  skeleton — not a mock. It is scored at 0.55 rather than higher because:
  (a) only one task (QN-006) has actually been driven through the whole
  chain; the other 5 backlog tasks remain untested paths through `todo`
  authoring; (b) the "Claude Code session runs a `quay:*` Skill" link in
  proposal §14's chain was, honestly, not exercised by an actual Skill
  invocation this iteration — the seed stood in, which is correct per
  protocol §9 but means this specific link of the chain is unproven with
  real Skill-dispatch mechanics (no fresh subagent context boundary was
  actually exercised, e.g.).
- **abi_symmetry: 0.5** — Evidence: a direct, side-by-side key-set
  comparison of CLI `--json` output vs MCP `structuredContent` for
  `task_get` shows identical schemas (§5 above). This is real, verified
  symmetry for the one tool checked this way. Scored at 0.5, not higher,
  because: (a) only `task_get` was checked this rigorously — `task_list`,
  `task_write`, `task_check` were smoke-tested but not key-by-key schema-
  diffed the same way; (b) no automated symmetry test suite exists yet
  (design §6 calls for "tests assert on that JSON" as an ongoing discipline,
  not a one-off manual check) — this is a real gap, not a rounding error.
- **gate_correctness: 0.4** — Evidence: `quay-native task check` correctly
  distinguished the `todo`/`ready`/`done`/`needs-human` cases and correctly
  asserted both gates for QN-006 against real data (4/4 artifacts present
  → ready-eligible; 4/4 AC checkboxes checked → done-eligible). Scored at
  0.4, not higher, because the gate is **explicitly and admittedly thin**:
  the `author→ready` gate is presence-based (section headers exist) with no
  check of artifact *quality* or *internal consistency*, and the
  `ready→done` gate is a checkbox-count heuristic with no verification that
  checked boxes correspond to actually-satisfied ACs (a task could check all
  its own boxes falsely and the mechanical gate would not catch it — this is
  precisely why the out-of-band audit exists, and precisely why iteration 0
  found it necessary to write one even for a single task). This gap is
  tracked as QN-005 in the backlog.
- **skill_convergence: 0.05** — Evidence: **no** `quay:*` Skill drove any
  task to a gate this iteration. `quay:author`/`quay:execute` exist as
  written files with a coherent Spec and an honest Gaps section, but are
  **entirely unexercised** — 0 dispatches, 0 rounds-to-convergence data.
  Scored at 0.05 rather than a literal 0 only because the Skill files exist
  and are internally consistent with the design's contract (a necessary but
  far from sufficient condition) — this is intentionally close to zero, not
  softened, per the task's explicit instruction to "say so explicitly
  rather than inflating this factor."

**Total (product): 0.55 × 0.5 × 0.4 × 0.05 = 0.0055**

This is a very low number, and it is the mathematically honest consequence
of the multiplicative formula when one factor (`skill_convergence`) is
genuinely near-zero — which it is, honestly, at σ=0. A single low factor
should dominate a product; this is not a bug in the calculation, it is
exactly what "no Skill has converged anything yet" should produce. Do not
read this as "the skeleton doesn't work" — §5's evidence shows it does; read
it as "the skill-driven convergence claim that would justify a higher score
does not yet exist," which is the correct iteration-0 state.

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **completeness: 0.20** — Evidence: the store/gate/CLI/MCP *mechanics* are
  fully implemented and documented in-code (schema, gate logic, ABI surface
  all match design §2/§3/§6/§7 verbatim, cross-checked while writing this
  report). The *orchestration methodology* (`quay:author`/`quay:execute`) is
  honestly incomplete — each SKILL.md's own "Gaps" section names exactly
  what's missing (no Layer-1 operation Skills as separate dispatchable
  files, no decompose test implementation, no independent-audit dispatch
  mechanism). Scored at 0.20: partial credit for real, complete
  documentation of the mechanics layer; no credit inflation for the
  orchestration layer, which is explicitly incomplete by its own admission.
- **effectiveness: 0.0** — Per protocol §5.2's held-out discipline, this
  factor is **not measurable** at iteration 0 (there is no prior stage-0
  pace to compare a marginal increment against — this iteration IS the
  baseline the comparator will use). Scored at the honest floor (0), not
  invented or estimated. See `experiments/quay-native-bootstrap/provenance.md`'s timing section for
  the actual environment-clock data iteration 1 must cite when this factor
  becomes measurable.
- **reusability: 0.0** — Per protocol decision §10.4, the GitHub Provider
  transfer target is out of scope until stage 2. Zero transfer has been
  attempted. Scored at the honest floor (0), correctly, not "N/A" softened
  upward.
- **validation: 0.20** — Evidence: σ=0 is correctly computed from a real,
  created `provenance.md` (not asserted from memory) — this is genuine
  validation infrastructure, not a placeholder. An out-of-band audit
  artifact exists (`experiments/quay-native-bootstrap/audits/iteration-0-adjudicate.md`) and
  performed real independent re-verification (re-ran the test suite fresh,
  checked AC-by-AC against the diff). Scored at 0.20, not higher, because
  that audit **honestly documents its own limitation**: it was not performed
  by a genuinely separate dispatched subagent (the same session that
  authored/executed QN-006 wrote the audit), so it does not satisfy G3's
  "independent... co-sign" requirement in the strict sense the protocol
  demands. This is exactly the kind of self-verification gap G3/G4 warn
  about, and it is named here rather than hidden.

**Arithmetic mean (headline figure): (0.20 + 0.0 + 0.0 + 0.20) / 4 = 0.10**

**Strict product (for transparency, not used as the headline number):**
0.20 × 0.0 × 0.0 × 0.20 = 0.0.

**Why the mean, not the product, is reported as V_meta here:** the protocol's
own §5.1 gives V_instance as an explicit product but does not mandate the
same for V_meta; more importantly, `effectiveness` and `reusability` are
*structurally* zero at iteration 0 **by design** (protocol §9: "effectiveness:
N/A this iteration," "reusability: zero — nothing has transferred to GitHub
yet"), not because the methodology failed at them. A strict product would
collapse V_meta to exactly 0 at every iteration until stage 2 even if
`completeness`/`validation` improved substantially in between — which would
destroy the signal for tracking σ's climb through iterations 1..k, the exact
metric-collapse failure mode G2 warns about, just from the opposite
direction (using a product to force a floor rather than to force a ceiling).
The arithmetic mean is used as the interim reporting convention until stage 2
makes all four factors simultaneously meaningful; **this convention itself is
new and should be revisited/ratified explicitly at the start of iteration 1**,
not silently assumed to be correct.

**V_meta = 0.10.** This sits at the low edge of, but *below*, the protocol's
own expected 0.15–0.25 baseline range (protocol §5, README §4). Per this
iteration's own instructions ("if your numbers land far outside this range,
re-check for inflation or unfair harshness — do not force the number to
match the range if the evidence says otherwise, but do sanity-check"): this
number was sanity-checked (see the completeness/validation reasoning above,
each independently re-examined once before settling), and the harshness is
judged justified, not miscalibrated — the two zero-floor factors
(effectiveness, reusability) mechanically pull a 4-factor mean below what a
2-factor assessment (completeness, validation ≈ 0.20 each) would suggest.
This is flagged explicitly as a possible protocol refinement to raise at
iteration 1: whether V_meta before stage 2 should be a mean over only the
*currently-applicable* factors (completeness, validation) rather than a
4-factor mean including two structurally-inapplicable zeros — that would put
this iteration's V_meta at 0.20, inside the expected range. **This iteration
does not unilaterally adopt that fix — it names the tension and defers the
decision**, reporting 0.10 as the honest number under the interpretation
used here.

## 9. Out-of-band audit

See `experiments/quay-native-bootstrap/audits/iteration-0-adjudicate.md` in full. Summary verdict:
`done` for QN-006, full audit depth (core-touching change), with an
explicitly recorded limitation: this was **not** a genuinely independent
dispatched-subagent audit (the self-verification trap the seed's own
`adjudicate` skill specifically warns against) — it was a mechanical
self-check by the same session, applying `adjudicate`'s method (fresh read
of AC/diff, independent re-run of tests) as rigorously as a single-session
iteration 0 allows, but without the fresh-context dispatch boundary that
would make it a true G3 co-sign.

**Human fixpoint sign-off**: not applicable at iteration 0 — this gate is
reserved for the σ→1 fixpoint iteration only (ITERATION-PROMPTS.md
"§Fixpoint iteration"), far from reached here.

## 10. Convergence Check

Evaluated against protocol §7's five criteria, all required for CONVERGED:

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** — **NO.**
  V_instance = 0.0055, V_meta = 0.10. Both far below 0.80. Expected and
  correct at iteration 0 (protocol §9: "Baseline scores (expected, honest):
  V_instance moderate... V_meta low ~0.15–0.25" — V_instance in particular is
  markedly below even "moderate" here because `skill_convergence` is
  genuinely near-zero, a stricter reading than the protocol's own baseline
  description anticipated, and is called out as such rather than softened).
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
  gate)** — **NO.** σ = 0 exactly (0/6 tasks are `{native,native,native}`).
  No increment has been built with zero seed involvement — the opposite is
  true this iteration: every increment was 100% seed-driven, which is the
  explicit, required starting condition (protocol §9), not a failure to
  reach criterion 2.
- [ ] **3. Contract proven (native + GitHub Provider both run)** — **NO.**
  No GitHub Provider exists or has been attempted. Explicitly out of scope
  until stage 2 (protocol §10.4/README §5) — not attempted, not a gap in
  this iteration's execution.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
  sign-off)** — **NO.** The mechanical audit exists but, as recorded in §9
  above, does not satisfy G3's independence requirement (same-session
  self-check, not a genuinely separate dispatch) — so even the *mechanical*
  half of this criterion is not cleanly satisfied, let alone the human
  fixpoint sign-off (which is correctly not yet triggered — that gate is
  reserved for σ→1, far away).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** — **NO
  (vacuously/structurally).** There is only one iteration so far; ΔV is
  undefined without a prior iteration to compare against. This criterion
  cannot be satisfied until at least iteration 2 exists.

**Status: NOT CONVERGED.**

This is the expected, required outcome at iteration 0 (protocol §7's note:
"iteration 0 converging would be a red flag, not a success" — echoed
verbatim in this iteration's own instructions). All five criteria correctly
read NO, each for a distinct, evidence-backed reason — not a single
generic "too early" dismissal.

---

## Problems identified for next iteration

Concrete, evidence-based, feeding directly into iteration 1's context
extraction (per ITERATION-PROMPTS.md's per-iteration OBSERVE step, and
protocol decision §10.2: `quay:author` retires its seed dependency first):

1. **`quay:author` is unexercised, not just incomplete.** It exists as a
   file with a coherent Spec but has literally never been dispatched against
   a real task. Iteration 1's job (per the fixed per-Skill retirement order)
   is to actually invoke it — likely against one of QN-001..QN-005, all of
   which are still sitting at `todo` with empty bodies — and observe where
   it breaks. Candidate first target: QN-005 (gate-correctness hardening) or
   QN-001 (task_write hardening), both small, well-scoped, single-leaf
   tasks, good fits for `quay:author`'s first real run.
2. **`quay:author`'s own Gaps section names its blocking gap precisely**: no
   Layer-1 operation Skills exist as separate dispatchable files
   (`write-proposal`, `review-proposal`, `write-plan`, `review-plan`) — the
   orchestration Skill currently inlines their work in one context, which
   violates design §5's fresh-context/review-independence contract. This is
   very likely iteration 1's actual blocking gap, not something to
   rediscover from scratch.
3. **The `author→ready` gate is presence-only, not quality-checking**
   (tracked as QN-005). If `quay:author`'s first real dispatch produces a
   shallow Proposal/Plan/AC/DoD that nonetheless passes the presence gate,
   this will surface immediately and should not be patched around inside
   `quay:author` — it is a gate-correctness gap, tracked separately.
4. **No genuinely independent adjudicate dispatch has ever been performed**
   in this experiment (§9's honest limitation). Iteration 1, if it drives
   any task to a gate that would count toward σ, needs an actual
   separate-subagent dispatch for the audit — not another same-session
   mechanical self-check — to make any future σ-lift claim satisfy G3 for
   real, not just in spirit.
5. **abi_symmetry has only been checked for `task_get`,** not `task_list`,
   `task_write`, or `task_check` at the same key-by-key rigor. A real
   (even lightweight) symmetry test — not a one-off manual diff — is needed
   before this factor can be scored meaningfully higher than 0.5.
6. **The V_meta scoring-convention tension flagged in §8** (product vs.
   mean, and whether structurally-inapplicable factors should be excluded
   from the pre-stage-2 mean) should be explicitly resolved at the start of
   iteration 1, not left ambiguous — whichever convention iteration 1 adopts
   should be stated and then held constant, so ΔV (criterion 5) is
   comparing like with like across iterations.
7. **The file-lock mechanism added for QN-006 is single-machine/advisory
   only** (documented in its own Proposal) — acceptable for v0's file-store
   scope, but should be revisited if/when the tasks directory is ever shared
   across machines (not a near-term concern, noted for completeness).
8. **Timing discipline gap**: the timing log was started only after the
   spec-reading phase, so that phase's duration is not captured in
   `experiments/quay-native-bootstrap/provenance.md`'s comparator data. Iteration 1 should start its
   own timing log at the very first tool call, before any reading.
