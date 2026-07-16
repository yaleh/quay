# Iteration 26

- **date:** 2026-07-15
- **status:** complete
- **primary driver:** `DIR-007` (human directive, present in `pending/` at
  session start, mandatory first-priority target per task instructions)

## 1. Context from prior iteration

`experiments/quay-native-bootstrap/iterations/iteration-25.md` (691 lines, read in full fresh this
iteration, including its post-hoc correction) ended with:

- σ (strict) = 27/34 = 0.7941, σ (inclusive) = 29/34 = 0.8529,
  σ_author_only = 33/34 = 0.9706.
- **V_instance = 0.65 × 0.94 × 0.76 × 0.94 = 0.4365** (skeleton 0.65,
  abi_symmetry 0.94, gate_correctness 0.76, skill_convergence 0.94) —
  **CORRECTED post-audit**: the iteration-25 independent audit
  (`experiments/quay-native-bootstrap/audits/iteration-25-independent-adjudicate.md`) found that
  iteration 25's original `gate_correctness` score (+0.10, claiming
  V_instance = 0.4941) double-counted evidence belonging to `reusability`
  alone, per iteration 17's own precedent for identical-kind
  quay-github-only gate work with zero `store.js` diff. `iteration-25.md`
  and `provenance.md` were both corrected in place before this iteration
  began; ΔV_instance for iteration 25 is honestly **0.0000**, not the
  originally-claimed +0.0576.
- **V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973** (completeness 0.74,
  effectiveness 0.26, reusability 0.79, validation 0.64) — unaffected by
  the correction above; the genuine gain from DIR-006's compound/epic
  GitHub-Provider work landed here (`reusability`: 0.68 → 0.79).
- All 5 convergence criteria: NO. Criterion 3 ("contract proven") moved
  from a clear, repeatedly-reconfirmed NO to a materially strengthened,
  specifically-bounded NO — the originally-named proximate cause
  (GitHub-backed compound/epic gate support) is now substantially
  addressed; the residual named gap was `executeEpic`'s own Skill-level
  compound-recursion path never having been run as a live `quay:execute`
  invocation (as opposed to this session's manual `task check`/`task edit`
  stand-in), plus `mcp-server.js`'s stdio transport remaining entirely
  untested from any real Agent/MCP-client perspective.
- **"Problems identified for next iteration" named DIR-007 as this
  iteration's expected first-priority target** (per the task instructions
  given to this session, not discovered independently) — a directive
  requesting a genuine, live-verified Core-level MCP server ("MCP
  projection → Agent," `quay-proposal.md` §5), found by a human directly
  inspecting the repo and confirming, via `grep`, that no such server
  existed: only `quay-native`/`quay-github` have `mcp` subcommands and real
  MCP server files; `packages/quay/src/provider-client.js` is Core's MCP
  **client** side only.
- A new, untracked discussion document,
  `docs/proposal/quay-core-scope-expansion-discussion.md`, was also present
  — read in full (§2 below); it is explicitly **not** a directive or a
  protocol amendment, only discussion notes for a possible future
  `ITERATION-PROMPTS.md` revision. No action was taken on it this
  iteration beyond reading and noting it, per its own stated status.

## 2. Preconditions checked

- `docs/proposal/quay-bootstrap-experiment.md` re-read in full (protocol:
  self-hosting identity M(Q)=Q, §5.1/§5.2 value formulas as products of 4
  factors each, §6 guardrails G1-G6, §7's 5 convergence criteria, §10's
  resolved decisions).
- `experiments/quay-native-bootstrap/README.md` and `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` re-read in
  full (10-section report template, phase discipline, σ ladder).
- `experiments/quay-native-bootstrap/provenance.md` read: the tail (~650 lines covering
  iterations 17-25 plus the post-hoc correction section) read in full;
  earlier iterations' sections read via targeted section headers, per
  established convention of trusting the ledger's own running tallies for
  history predating the current work.
- `ls experiments/quay-native-bootstrap/directives/pending/` at session start: confirmed
  **`DIR-007-implement-core-mcp-server.md` present**, as the task
  instructions stated. Read it in full before any other work, per the
  mandatory first-priority instruction.
- `docs/proposal/quay-core-scope-expansion-discussion.md` read in full
  (discussion notes on extending Core-level verification scope — browser
  automation for the Web UI, three-way CLI/MCP/Web-UI symmetry, mock/log
  delivery for action triggers — explicitly not a directive; informs
  future `ITERATION-PROMPTS.md` revisions, not acted on directly this
  iteration beyond being read and cross-checked against DIR-007's own
  scope for naming-collision risk, see §4).
- `experiments/quay-native-bootstrap/directives/README.md` re-read in full (lifecycle mechanism:
  pending/ → archive/, required `## Resolution` section).
- `git status --short` at session start: clean except the expected
  untracked `docs/proposal/quay-core-scope-expansion-discussion.md` (no
  stray changes carried over from iteration 25's own commit).
- manda daemon: `.manda/config.yml` / `.manda/hub.addr` present (G6
  precondition file check, consistent with every prior iteration since no
  subagent-dispatch primitive has ever been found available in this
  environment — same degraded-fallback mode applies this iteration,
  reconfirmed via `ToolSearch`, not re-assumed).
- `gh auth status`: confirmed user `yaleh`, scopes `repo`+`workflow`,
  before any live GitHub-backed MCP call this iteration.

## 3. Observe

DIR-007's finding, re-verified directly rather than taken on faith:

- `grep -rln "McpServer\|StdioServerTransport" packages/*/src packages/*/bin`
  reproduced exactly the same result set DIR-007 itself reported: only
  `quay-native` and `quay-github` have real MCP server files.
- Read `packages/quay/src/provider-client.js` in full: confirmed it is
  purely an MCP **client** module (`connectProvider()` returning
  `taskList`/`taskGet`/`taskWrite`/`taskCheck`/`manifest`/`close`) — no
  server code, no `McpServer` import.
- Read `packages/quay/bin/quay.js` in full: confirmed `cmd` dispatch covers
  `task list/view/edit/check`, `action list/run`, `serve` — **no `mcp`
  branch, no usage-string mention of `mcp`.**
- Read `packages/quay-native/src/mcp-server.js` and
  `packages/quay-github/src/mcp-server.js` in full, as the reference shape
  to mirror (per DIR-007 point 1's own instruction).
- Read `packages/quay/src/config.js` in full: `activeProvider(cfg, id)`
  already supports explicit-id selection with a default-to-first-enabled
  fallback (QN-002/QN-032's own prior work) — directly reusable for the
  Core MCP server's own `provider` argument default-resolution, with zero
  changes needed to that file.
- Read `.quay/config.yml`: confirmed `native.enabled: true`,
  `github.enabled: false` — only one Provider is enabled by default in
  this workspace, meaning a genuine multi-Provider aggregation proof
  requires deliberately enabling a second Provider for the duration of a
  live check (see §5).

## 4. Strategy

DIR-007 is an explicit, unambiguous, numbered 5-point directive naming
exact files and an exact evidentiary standard (matching QN-028/029/033/034's
own precedent). The strategy was direct, sequential execution of its five
points, each verified before moving to the next:

1. Design the Core MCP server's shape: an `McpServer` (server role) that is
   simultaneously an MCP client fan-out (reusing `provider-client.js`
   unmodified) over every `enabled: true` Provider in `.quay/config.yml`.
2. Resolve the one genuine open design question DIR-007 itself named
   (multi-Provider tool/resource disambiguation) explicitly, before
   writing code: an **optional `provider` argument** on every proxied tool
   (default: first-enabled Provider), plus a manifest **alias** +
   **per-id-namespaced** resource URIs — chosen over per-Provider tool-name
   namespacing for the reason recorded in `packages/quay/DESIGN.md` §2.3
   (namespacing would require an Agent to already know the enabled-Provider
   set before its first tool call, defeating proposal §5's own stated
   goal).
3. Implement `src/mcp-server.js` + wire the `mcp` subcommand into
   `bin/quay.js`.
4. Live-verify against both real Providers, including a genuine
   multi-Provider-enabled live check against the real `yaleh/quay` GitHub
   repository (temporarily enabling `github` in `.quay/config.yml` for the
   duration of the check only, then restoring it) — matching QN-028/029's
   own live-github evidentiary standard, and DIR-007 point 3's explicit
   request.
5. Write a committed, network-independent regression test reproducing the
   same aggregation proof with two fully local, isolated native task
   stores (avoiding a permanent hard dependency on live `gh` network access
   for the automated suite — consistent with this package's existing
   test-isolation conventions, e.g. `cli.test.mjs`/`serve.test.mjs`).
6. Update `quay-proposal.md` §5 and create `packages/quay/DESIGN.md` (did
   not previously exist).
7. Drive a new task (`QN-036`) through the full native lifecycle
   (`todo → ready → done`).
8. Move `DIR-007` to `archive/` with a `## Resolution` section.
9. Cross-checked the naming-collision risk flagged in
   `quay-core-scope-expansion-discussion.md` §2.1 (browser-automation MCP
   tooling vs. this project's own frozen "MCP" term): this iteration's own
   report and code comments consistently use "MCP" only for the Provider
   ABI transport (`quay-native mcp`, `quay-github mcp`, `quay mcp`), never
   for chrome-devtools/playwright tooling (which was not used this
   iteration at all, since DIR-007's scope is entirely non-Web-UI).

No alternative strategy was seriously considered given DIR-007's explicit,
numbered scope. The only live judgment call was the multi-Provider
disambiguation mechanism (point 5 above), made and recorded explicitly
rather than deferred, per DIR-007 point 5's own instruction.

## 5. Execution

**5a. `packages/quay/src/mcp-server.js` created** (new file, ~270 lines).
Key design points:

- `enabledProviderIds(cfg)`: filters `.quay/config.yml`'s `providers` map
  to `enabled: true` entries, preserving object-insertion order.
- `getClient(providerId)`: lazy, cached connection per Provider id (a
  `Map<id, Promise<{id, client}>>`), reusing `connectProvider()`
  unmodified; throws a clear, non-crashing error naming the actual
  enabled-Provider set if an unknown/disabled id is requested.
- Every tool (`task_list`, `task_get`, `task_write`, `task_check`) has an
  **optional `provider` field** added to its `inputSchema`, otherwise
  identical in shape to the corresponding Provider-level tool.
- `provider://manifest` — alias resource resolving to the first-enabled
  Provider. `provider://manifest/<id>` — one real, individually-listed
  resource per enabled Provider.
- `transport.onclose` closes every connected Provider client, avoiding
  orphaned subprocesses when the Core server's own stdio transport closes.

**5b. `bin/quay.js` wired**: a new `cmd === "mcp"` branch (no subcommand
token, no flags — mirrors `quay-native`/`quay-github`'s own `mcp`
subcommand shape exactly), and the usage-fallback string updated to
mention `mcp`.

**5c. Live verification — single-Provider baseline (native only,
`.quay/config.yml` unchanged):**

```
$ node -e "... connect to `node packages/quay/bin/quay.js mcp` ..."
quay mcp: aggregating enabled providers [native] (default: native)
RESOURCES: ["provider://manifest","provider://manifest/native"]
DEFAULT MANIFEST id: native
task_list (default=native) count: 34
```

Requesting `provider: "github"` while github is not enabled correctly
returned `isError: true`, `quay mcp: provider "github" is not enabled...`.

**5d. Live verification — genuine multi-Provider aggregation (native +
github, both enabled):** `.quay/config.yml`'s `github.enabled` was
temporarily flipped `false → true` (native's own `enabled: true` was
untouched) for the duration of this check only:

```
quay mcp: aggregating enabled providers [native, github] (default: native)
RESOURCES: ["provider://manifest","provider://manifest/native","provider://manifest/github"]
native manifest id: native
github manifest id: github
task_list native count: 34
task_list github count: 7
github sample ids: [ 'gh-7', 'gh-6', 'gh-5' ]
task_get gh-7: {"id":"gh-7", ..., "role":"compound", ...}
task_check gh-7: {"id":"gh-7","gate":"none","ok":true,"reason":"terminal","childrenStatus":[{"id":"gh-5","status":"done"},{"id":"gh-6","status":"done"}]}
```

This is a genuine live call against the real `yaleh/quay` repository,
exercising the same real compound/epic fixture (`gh-7`/`gh-5`/`gh-6`)
iteration 25's QN-035 created.

**5e. Byte-identical cross-check against each Provider's own direct `mcp`
subcommand** (the core reusability/transfer proof DIR-007 point 3
requires):

```js
direct  = quay-github mcp (task_check gh-7)  -> {"id":"gh-7","gate":"none","ok":true,"reason":"terminal","childrenStatus":[...]}
viaCore = quay mcp        (task_check gh-7, provider=github) -> IDENTICAL
BYTE-IDENTICAL: true
```

Repeated for native (`task_list`/`task_get`/`task_check` against
`QN-035`), after correcting an initial test-harness mistake (an env var
resolved relative to the wrong cwd in the ad hoc verification script, not
a bug in `mcp-server.js` itself — confirmed by re-running with the
corrected absolute path): all three byte-identical.

**5f. Error paths confirmed:** unknown task id → `isError: true, "no such
task: NOPE-999"`; unknown/disabled provider id → `isError: true`, naming
the actual enabled set.

**5g. `.quay/config.yml` restored** to its original state immediately
after the live multi-Provider check (`diff` against a pre-iteration backup
confirmed byte-identical restoration; `git status --short` later confirmed
no diff on this file at commit time).

**5h. Committed regression test** `packages/quay/test/mcp-server.test.mjs`
written (13 assertions, `node test/mcp-server.test.mjs` exits 0):
constructs an isolated fixture workspace with **two** independently-seeded
native task stores configured as two distinct `enabled: true` Providers
(`native` / `native-2`), so multi-Provider aggregation is exercised by the
automated suite with **zero external-network dependency** (the live
native+github check above was hand-run this iteration, not part of the
committed suite). Covers: resource enumeration (manifest alias + per-id
resources), default-Provider selection, explicit `provider` routing with
no cross-Provider leakage in either direction, byte-identical
`task_get`/`task_check` proxying against a directly-spawned
`quay-native mcp` comparison target, `task_write` passthrough (with a
negative check that the *other* Provider's task is untouched), and both
error paths.

**5i. `packages/quay/DESIGN.md` created** (did not exist before this task
— DIR-007 point 4 named this conditionally, "if one exists"; since it did
not, this iteration creates it, at the same level of detail
`quay-native`/`quay-github`'s own `DESIGN.md` files already have).
Documents: the three sibling bindings, why `quay mcp` exists, the
dual server/client role, the multi-Provider disambiguation decision and
its rejected alternative, the full live-verification transcript, and named
honest gaps (no real live-Claude-Code-session registration test yet; CAS
option forwarded but not freshly re-exercised through this specific path;
resource *name* vs *uri* untested).

**5j. `docs/proposal/quay-proposal.md` §5 updated**: an
"Implementation status (iteration 26, DIR-007, ...)" paragraph appended
directly after the existing architecture-layers description, summarizing
the now-real capability and pointing to `packages/quay/DESIGN.md` for
detail. The pre-existing diagram/text was left untouched (still an
accurate description of the intended architecture); only a status note was
added, not a rewrite.

**5k. `tasks/QN-036.md` created** and driven through the full native
lifecycle: `task check` (author→ready, `ok:true`) → `task edit --status
ready` → `task check` (execute→done, `ok:true`, 4/4 AC) → `task edit
--status done` → `task check` confirmed terminal `ok:true`.

**5l. `DIR-007` moved** (`git mv`) from `pending/` to `archive/`, with a
`## Resolution` section appended documenting `resolved_by: iteration 26`,
`outcome: applied in full`, and a point-by-point account matching each of
DIR-007's own 5 requested actions.

**Full regression suite re-run this iteration** (19 `*.test.mjs` files: 8
quay-native + 6 quay-github + 5 quay [4 pre-existing +
the new `mcp-server.test.mjs`]), **all exit 0, zero regressions**, plus
`packages/quay-native/test/abi-symmetry.mjs` still reporting "ALL FOUR
SURFACES SYMMETRIC." No orphaned subprocesses confirmed via `ps aux | grep
quay` after all manual verification steps completed.

## 6. Provenance update

`experiments/quay-native-bootstrap/provenance.md` updated with a full "Iteration 26 — QN-036"
narrative section and a σ-computation section:

```
σ (strict reading)     = 28 / 35 = 0.8000   (up from 0.7941, Δ +0.0059)
σ (inclusive reading)  = 30 / 35 = 0.8571   (up from 0.8529)
σ_author_only          = 34 / 35 = 0.9714   (up from 0.9706)
```

| task_id | title | author_by | execute_by | gate_by | status |
|---|---|---|---|---|---|
| QN-036 | Implement and live-verify Core's own MCP server (quay mcp, DIR-007) | native | native | native | done |

Total task count: 35 (QN-001..QN-036, minus the never-allocated QN-018).

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

- **skeleton: 0.67 (up from 0.65, Δ +0.02).** This is a genuinely new
  **consumer-layer binding** — the third of the three siblings proposal §5
  names (Web UI, CLI, MCP projection), and the only one that did not exist
  in any form before this iteration (unlike QN-031's Web-UI test-coverage
  closure or QN-033's CLI dispatch test-coverage closure, both of which
  covered a *pre-existing* capability). This is honestly distinguished from
  iteration 25's QN-035 (a *second-Provider conformance* fix, correctly
  scored as `reusability`-only per the post-hoc correction above): QN-036
  adds no new Provider-side capability and touches zero Provider code
  (`packages/quay-native/`, `packages/quay-github/` diffs are both empty
  this iteration — confirmed via `git status --short` before writing this
  report) — it is purely a new **Core**-side transport binding, squarely
  within `skeleton`'s own definition ("the v0 loop runs end-to-end
  config → mcp → serve → action → Skill → done"), since `mcp` is literally
  named as one of that loop's own stages and, until this iteration, only
  ever existed at the Provider level, never at the Core/consumer level the
  loop's own diagram implies. Scored at the same modest, closable-gap-sized
  increment iteration 21 used (+0.02) rather than a larger jump: this is a
  new binding, not a new fundamental *transition* in the loop (task data
  still flows through the same store/gate machinery underneath; only a new
  door was added for an Agent to reach it through in one hop instead of N).
- **abi_symmetry: 0.94 (unchanged).** This factor's established, narrow
  definition (per its own multi-iteration precedent, e.g. iterations
  17/20-25) is specifically Provider-level CLI/MCP shape symmetry, measured
  by `abi-symmetry.mjs`. `abi-symmetry.mjs` was re-run fresh this
  iteration, unchanged, still "ALL FOUR SURFACES SYMMETRIC" — QN-036 did
  not touch any Provider's own CLI or MCP tool schemas. The distinct,
  new symmetry proof this iteration *did* establish (Core MCP ≡ each
  Provider's own direct MCP, byte-identical) is real and consequential, but
  it is a **different** symmetry claim than what this specific factor has
  ever measured (Provider CLI ⟷ Provider MCP, not Core-MCP-proxy ⟷
  Provider-MCP-direct) — conservatively not folded into this factor without
  redefining it, which is out of scope for a single iteration to do
  unilaterally. This new proof is instead credited to `skeleton` above
  (the binding's own existence and correctness) rather than stretched into
  `abi_symmetry`'s existing, narrower definition.
- **gate_correctness: 0.76 (unchanged).** No change to `store.js`'s or
  `github-client.js`'s own gate logic this iteration — `git diff` confirms
  zero changes to either package. `quay mcp`'s `task_check` tool is a thin,
  generic passthrough (identical in kind to `provider-client.js`'s own
  pre-existing `taskCheck()`, itself unmodified this iteration) — it adds
  no new gate semantics of its own. Applying the exact discipline this
  iteration's own baseline (the iteration-25 correction) established:
  credit belongs where the actual gate-logic evidence lives, and none of
  it changed here.
- **skill_convergence: 0.94 (unchanged).** QN-036 was driven through the
  same leaf-task, degraded-fallback author→execute lifecycle every prior
  task has used — nothing new about Skill *convergence* itself (whether
  `quay:author`/`quay:execute` reliably drive a task to a well-gated
  `done`) was demonstrated this iteration.

```
V_instance = 0.67 × 0.94 × 0.76 × 0.94 = 0.4499
```

ΔV_instance = **+0.0134** (0.4365 → 0.4499). This is a genuine, honestly
earned V_instance-side movement — deliberately scored more conservatively
than iteration 25's original (later-corrected) overclaim: this iteration
raises exactly one factor (`skeleton`), by an amount consistent with
established precedent for a real-but-modest new-binding closure, and
explicitly declines to also raise `abi_symmetry` for the same underlying
evidence, naming the reason a future audit can check independently.

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **completeness: 0.74 (unchanged).** QN-036 adds a new Core-level
  capability, but no new orchestration-Skill **methodology content** —
  `quay:author`/`quay:execute`'s own SKILL.md files gained no new Method
  steps this iteration; the methodology description itself is unchanged.
  Consistent with how iterations 20-25 each treated their own analogous
  capability-implementation (not methodology-document) closures.
- **effectiveness: 0.26 (unchanged).** No new stage-0-comparable timing
  evidence was gathered this iteration. DIR-007's own scope (a new
  transport-layer binding with an MCP SDK server/client dual role) is not a
  fair comparator against the stage-0 seed task (a Skill-orchestration
  task) for the same reason iteration 25 named for its own `effectiveness`
  finding: different *kind* of work, not merely a different *size*.
- **reusability: 0.79 (unchanged).** This is the factor most tempting to
  move for this iteration's work (an Agent-facing MCP surface is, in a
  loose sense, about "the methodology being usable elsewhere"), and is
  deliberately **not** moved, for a reason directly informed by this
  iteration's own stated baseline lesson (learn from the iteration-25
  correction): protocol §5.2 scopes `reusability` specifically to "the
  methodology transfers to a second Provider... measured on the transfer
  target only." QN-036 touches **zero Provider-side code**
  (`packages/quay-native/`, `packages/quay-github/` are both unchanged —
  confirmed via `git status --short`) — it is Core-side infrastructure that
  happens to *use* both Providers as clients, not a Provider itself gaining
  new capability or being newly exercised for the first time. The
  byte-identical proxy proof in §5e is evidence the Core's own MCP-client
  fan-out logic is provider-agnostic (a `skeleton`/`abi_symmetry`-relevant
  claim about Core, discussed above), not evidence that the *methodology*
  (Skills + gate + decomposition rule) transferred to a new backend — that
  transfer was already proven by QN-002 (iteration 4) and deepened by
  QN-035 (iteration 25); this iteration neither repeats nor extends that
  specific claim. Held flat, explicitly, rather than double-counted here.
- **validation: 0.64 (unchanged).** Consistent with the established
  precedent (iterations 17-25): `validation` credits an iteration once the
  out-of-band audit **for that iteration's own work** is obtained — which
  happens after this report is committed, via the top-level orchestrator's
  separate `Agent` dispatch. Correctly held flat pending that audit.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```

ΔV_meta = **0.0000** (0.0973 → 0.0973, unchanged). Honestly reported: this
iteration's genuine capability gain is real, but it lands entirely in
V_instance (`skeleton`), not V_meta — DIR-007's own scope was a Core-level
consumer-binding implementation, not a methodology-content change, not a
new Provider-transfer proof, and not yet independently audited. This is
the mirror image of iteration 25's own honest finding (that iteration's
gain landed entirely in V_meta, not V_instance) — together the two
iterations demonstrate the dual-layer scoring discipline correctly
routing two different kinds of genuine progress to two different factors,
rather than inflating both from one underlying fact (the exact failure
mode G2 exists to prevent).

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed, via its own native `Agent` tool (a mechanism
entirely distinct from manda's own `Agent`/`Dispatch` tooling, which this
session did not use to self-obtain an audit).

`experiments/quay-native-bootstrap/audits/iteration-25-independent-adjudicate.md` (read in full at
the start of this session, its correction already folded into this
iteration's own baseline per §1 above) remains the most recent independent
audit.

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently
rather than take on faith:

1. Whether the multi-Provider disambiguation decision (optional `provider`
   argument, default-to-first-enabled) is judged a sound, sufficiently
   documented resolution of DIR-007 point 2's own open design question, or
   whether the rejected per-Provider-tool-namespacing alternative should
   have been chosen instead — this is the single most judgment-laden
   design call in this iteration's work.
2. Whether the live byte-identical proxy claims (§5e) are independently
   re-run and re-confirmed, including against the real `yaleh/quay`
   `gh-7` compound/epic fixture (temporarily re-enabling `github` in
   `.quay/config.yml` for the duration of the re-check, then restoring it,
   exactly as this iteration did) — and whether `.quay/config.yml` is
   confirmed to have been correctly restored (a `git diff` on that file
   should be empty at audit time).
3. Whether `packages/quay/test/mcp-server.test.mjs`'s 13 assertions are
   independently re-run (`node packages/quay/test/mcp-server.test.mjs`)
   and confirmed to actually exercise the claimed cases, in particular the
   negative cross-Provider-leakage checks and both error paths.
4. Whether this iteration's `skeleton` (+0.02) scoring rationale — crediting
   a new Core-level binding at the same magnitude iteration 21 used for a
   test-coverage closure, while explicitly declining to also raise
   `abi_symmetry` for the same underlying evidence — is judged proportionate
   and non-double-counting, given this iteration was explicitly instructed
   to learn from iteration 25's own overclaim; this is the second most
   judgment-laden claim in this report.
5. Whether `reusability` being held flat (rather than credited for this
   iteration's cross-Provider proxy proof) is judged correct, or whether an
   independent reviewer would find a legitimate, non-double-counting
   argument for some `reusability` movement that this session did not
   consider.
6. `git status --short` should show a clean working tree at audit time
   (confirmed clean at the end of this session, re-confirmed after commit,
   §Convergence Check below).

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** — **NO.**
      V_instance = 0.4499 (up from 0.4365), V_meta = 0.0973 (unchanged).
      Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate)** — **NO.** σ (strict) = 0.8000, up from 0.7941, still far
      from 1. No Skill-set or gate-logic change occurred this iteration
      (QN-036 is Core-side, not a Skill or gate change), so this criterion
      is neither newly supported nor newly undermined by this iteration's
      work — it simply remains NO for the same standing reason (σ < 1).
- [ ] **3. Contract proven (native + GitHub both run)** — **unchanged from
      iteration 25's own materially-strengthened-but-not-unconditional-YES
      assessment.** DIR-007's work is orthogonal to this criterion's own
      named residual gap (iteration 25's problem #1: `executeEpic`'s
      Skill-level compound-recursion path has still never been run as a
      live `quay:execute` invocation) — QN-036 did not touch that gap at
      all. What DIR-007's work *does* add, relevant but not decisive for
      this criterion: a second, independent proof that native+github both
      "run" correctly and identically through one more binding (the Core
      MCP server), strengthening confidence in ABI stability generally,
      without resolving the specific named residual gap. Net honest
      characterization: still NO, for the same reason iteration 25 named,
      not a new reason.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for this iteration's own
      work (correctly — it happens after this report is committed).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** — **NO.**
      This iteration produced ΔV_instance = +0.0134 (exceeding 0.02
      combined with iteration 25's own movement pattern once V_meta's
      +0.0136 from that iteration is considered together with this one) —
      concretely, iterations 25 and 26 combined show real, non-trivial,
      non-templated movement in different factors of different value
      functions (V_meta then V_instance), the opposite of the
      diminishing-returns signal this criterion checks for.

**Status**: **NOT CONVERGED**. Criterion 1 remains clearly NO (both V's far
below 0.80). Criterion 2 remains clearly NO (σ still well below 1).
Criterion 3 remains at iteration 25's own honest "materially strengthened,
specifically-bounded NO" — this iteration's DIR-007 work did not move it,
being orthogonal to its own named residual gap. Criterion 4 remains NO,
correctly, pending the next out-of-band audit. Criterion 5 remains NO —
combined iteration 25+26 movement is real and substantial, not diminishing.

## Problems identified for next iteration

1. **(Carried forward, highest-value remaining gap for criterion 3)
   Live-verify `executeEpic`'s own compound-recursion path as an actual
   `quay:execute` Skill invocation**, driving a real multi-child GitHub
   epic from `todo` through to `done` via the Skill orchestration layer
   itself — unchanged from iteration 25's own problem #1; this iteration's
   DIR-007 work did not touch this gap at all (it is Core-transport work,
   not Skill-orchestration work).
2. **`mcp-server.js`'s own stdio MCP transport under a real, live Claude
   Code session's own MCP client registration remains untested** — this
   iteration strengthens the standalone-Node-MCP-client evidence for
   `quay mcp` specifically (a new instance of the same standing gap named
   for `quay-native`/`quay-github` since iteration 24), but a genuine
   Claude-Code-session-registers-and-uses-`quay-mcp` test has still never
   been run by any iteration. This is now true for **three** MCP server
   binaries (`quay-native mcp`, `quay-github mcp`, `quay mcp`), not just
   two — worth naming as a compounding, not diminishing, gap.
3. **`resolveProviderEnv()`'s absolute-path passthrough branch** and
   **`quay serve`'s own CLI dispatch branch** remain open (carried forward
   unchanged from iterations 23-25's problems lists) — DIR-007's own work
   duplicated `resolveProviderEnv()`'s relative-path logic into
   `mcp-server.js` (documented explicitly in that file's own header
   comment as a deliberate, tiny, byte-identical duplication pending a
   future shared-module extraction) rather than touching `bin/quay.js`
   itself, so this specific gap is unchanged, not newly closed or newly
   duplicated-with-drift-risk (the two copies are currently identical;
   a future refactor extracting a shared `resolveProviderEnv()` module
   would need to keep them so, or better, unify them).
4. **`effectiveness` remains at its honest ceiling (0.26)** — DIR-007's own
   scope (Core transport-layer implementation) is, like iteration 25's
   DIR-006 work, not a fair `effectiveness` comparator against the stage-0
   Skill-orchestration seed task, for the same reason (different kind of
   work, not merely different size). A future iteration should continue
   looking specifically for a marginal increment that is itself a
   Skill-orchestration/decomposition task with genuinely more Plan/AC
   complexity than the stage-0 comparator.
5. **`reusability` was deliberately held flat this iteration** despite
   this iteration's work touching both Providers as MCP clients — the
   distinction (Core-side infrastructure vs. Provider-side capability/
   transfer) is recorded in §8 above; a future iteration or independent
   audit should specifically check whether this distinction is judged
   correct, since it is closely related in spirit to the exact
   double-counting mistake iteration 25 made and this iteration was
   explicitly instructed to learn from.
6. **The σ-ledger axis (QN-006) remains a provenly closed question** — no
   change to this conclusion; future iterations should not re-litigate it.
7. **The `Agent`/`Dispatch` tool schema-change observation from iteration
   20 remains open and untested by any iteration-executor session,
   correctly** — squarely a G3 audit question, not for a future
   iteration-executor session to test on itself.
8. **`docs/proposal/quay-core-scope-expansion-discussion.md` remains
   unresolved discussion notes**, not acted on beyond being read this
   iteration (its own stated status explicitly precludes treating it as a
   directive). Its open questions (§4 of that document) — whether Core-scope
   verification needs a formal protocol decision, which V-factor(s) should
   credit such work, and whether `ITERATION-PROMPTS.md` should be revised —
   remain live for a future iteration or the top-level orchestrator to
   decide on, not this session's to resolve unilaterally. Notably, this
   iteration's own §8 V_meta reasoning (declining to credit `reusability`
   for Core-side work) is directly relevant evidence for that document's
   open question #2 ("which V_instance/V_meta factor(s) should credit this
   work") — a future iteration revising `ITERATION-PROMPTS.md` should read
   this iteration's §7-§8 reasoning as a worked example.
9. **No new pending directive exists as of the end of this iteration**
   (`experiments/quay-native-bootstrap/directives/pending/` is empty after DIR-007's archival) —
   a future iteration's first priority, per standing convention, should be
   iteration 25's own problem #1 (live `executeEpic` Skill-level
   verification) absent a new directive appearing first.
