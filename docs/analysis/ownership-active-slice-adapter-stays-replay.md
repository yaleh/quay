# ownership-active slice adapter — `stays` replay (2 real coverage-gap candidates)

Task: `gap-ownership-active-slice-adapter-stays-declaration`.

This records what changed in `docs/analysis/ownership-active-slice-adapter.mjs`, the exact delta shape the two
REAL candidates from the production carrier now produce, and the **premise correction** the replay forced.

---

## ⚠️ 1. Premise correction — the task's title is wrong about *which* ArchGuard has the clause

The task is titled "…computable **on released archguard 0.1.39** (no tool change needed)", and the premise
handed to it was that `proposedCut.stays` "在 archguard 侧已经存在且被忽略". Reading the archguard **source**
confirms the field exists. The **released artifact does not contain it**, and the released artifact is what
`resolveArchguardCli()` resolves:

| reading | evidence |
|---|---|
| source repo `/data/home/yale/work/archguard` @ HEAD | `simulate.ts:284` reads `slice?.proposedCut?.stays`; 13 occurrences of `stays` in `dist/` |
| **published** `@yalehwang/archguard@0.1.39` tarball (`npm pack`, unpacked) | `package/dist/analysis/slice-delta/simulate.js` is **426 lines, zero occurrences of `stays`** |
| installed copy the adapter resolves (`~/.claude/plugins/npm-cache/…/archguard`) | same 426-line `simulate.js`; zero `stays` |
| release vs. feature ordering (source git log) | `release: 0.1.39` = `954fd7f4` **2026-10-10 13:11 +0800**; the clause lands at `ac525558` **2026-10-10 18:18 +0800** and `e3c77aef` 18:24 — **~5 h after the release**, and `package.json` still says `0.1.39` (unversioned working state) |
| npm registry | `npm view @yalehwang/archguard versions` → nothing above `0.1.39` |

**Consequence.** With the *released* CLI the adapter's new declaration is **inert**: the tool ignores the
unknown field and refuses with exactly the same `切法覆盖不足` (measured below). Making the two candidates
computable therefore needs **an ArchGuard release carrying the `stays` clause**, which does not exist yet.
The adapter change is nevertheless correct, forward-compatible and zero-harm (the extra field is ignored by
older primitives), and it is what makes the candidates computable the moment such a release ships.

To keep that inertness **visible rather than silent** (hard rule 3b: "cannot evaluate" must not be shaped like
"passed"), `computeSliceDelta` now attaches to a coverage refusal that had a declaration:

```
stays_declared:       [ { dir, symbols } ]   // what we asked for
stays_ignored_by_tool: true                  // …and the tool refused for 覆盖不足 anyway => clause absent
```

A build **with** the clause never sets `stays_ignored_by_tool` (asserted in the test).

## 2. The contract, as read from ArchGuard's own source (verbatim anchors)

- `proposedCut.stays?: SliceStay[]`, `SliceStay = { dir: string; symbols: string[]; note?: string }`
  — `src/analysis/slice-delta/types.ts:34`; the field is **top-level on `proposedCut`**, not per-move.
- `dir` must be an internal graph node; `symbols` must be a non-empty array (`simulate.ts:284`–`303`).
- Trust boundary: ArchGuard **structure-checks** the declaration but **never verifies that a declared name
  occurs on any edge**. An undeclared name is never defaulted to "stays" — it stays `not-evaluated`
  (`types.ts` SliceStay doc: "`stays` is a declaration, not a fallback").
- Conflicts ⇒ `not-evaluated` `目的地冲突`: the same name staying under two different `dir`
  (`simulate.ts:297`–`303`), or a name both moved and staying (`simulate.ts:307`–`311`).
- Reconciliation (`simulate.ts:382`/`389`/`397`): `uncovered = names − moved − stayed`;
  `staying = names ∩ stayed`; `survives = staying.length > 0`.
- **Matching is by symbol NAME globally, not per edge** — `destOfSymbol.has(n)` / `stayedSymbolDir.has(n)`
  never look at the edge's `to`.
- Partial-migration shape (the path this task triggers): the original edge **SURVIVES** (it is not in
  `removedEdges`), each genuinely-moved name adds a retargeted `addedEdges` entry
  (`source: "retarget-from-removed-edge"`; excluded when the target edge already exists, as it does here),
  `affectedConsumers[].becomes === "survives"`, and
  `accounting[]` carries `{ survives: true, staying: [...], strength: null }` — `strength` is **always null**
  (a directory graph carries no symbol→file localization; `types.ts:127`). This is *not* the full-migration
  path, where the edge disappears.
- Report location: `accounting` / `affectedConsumers` are **top-level** report fields, emitted only when the
  declaration (or a multi-destination/unknown edge) is present (`simulate.ts:719`/`725`).

## 3. What the adapter now does

In `buildSliceInput`, next to the existing fully-covered `restore` set, the complement is computed and
declared:

1. Collect `allMoved` = every symbol named by any move.
2. Walk **every internal edge the cut touches** (`importedNames ∩ allMoved ≠ ∅`) — *not* only edges whose `to`
   is a moved-from dir, because the primitive selects touched edges by imported NAME (§2). For each such edge,
   the names that do not move are the names that stay **in that edge's `to` dir**; aggregate them per dir.
3. Refuse (emit no `stays` at all) when the declaration would be a `目的地冲突`: one name staying under two
   different dirs ⇒ `stays_skipped = "CROSS_DIR_CONFLICT:<names>"`. The cut then stays under-covered, honestly.
4. Two further invariants hold **by construction** and are asserted on the output in the test:
   every declared name occurs on a real edge's `importedNames` (AC6), and the declared set is disjoint from
   every `moves[].symbols` (AC7).
5. `stays` travels as `slice.proposedCut.stays` and is omitted entirely when nothing is partial (so a
   fully-covered cut is byte-identical to before — regression-tested).

`partial_edges` (the edges whose importer keeps a surviving edge but gains a retargeted one) are added to
`involved`, so they are no longer reported as "untouched" in `mustNotChange.untouchedDirs`.

## 4. The two real candidates — before / after

Both come from `.quay/ownership-shadow-proposals.jsonl` (records 75 and 76, 2026-10-10). `packages/quay/src`
at the two recorded commits is the **same git tree**, `00467d64403217aadacda527b8d7a1b898d312e5` — the
`tree_sha` the carrier itself recorded. Graph = `archguard analyze` over `git archive <commit>
packages/quay/src`, vendored as `plugin/fixtures/ownership-active-slice/locked-tree-00467d64.arch.json`
(sha256 `6b03a0055b981acd8784dd51917b114fd7e92d5a475db748b066353f6b1afdc1`).

> The carrier stores the refusal text but **not** the `moves`. The moves used here are reconstructed to
> reproduce the recorded uncovered sets; that reconstruction is **verified**, not assumed — the released CLI's
> refusal on this graph reproduces the carrier's own `downgrades` string (record 75 verbatim; record 76 up to
> its truncation point). See §5.

### BEFORE — released `@yalehwang/archguard@0.1.39` (the CLI `resolveArchguardCli()` actually resolves)

```
cand① cli -> gate/config   status: not-evaluated
  切法覆盖不足：边 cli -> gate/config 的 importedNames=[resolveWorkspaceRootOrThrow, resolveRunnerOptions]
  中 [resolveRunnerOptions] 未被任何 move 的 symbols 覆盖 —— 目录粒度上无法判断这条边是否随搬迁消失，本实现不猜
cand② gate -> gate/config  status: not-evaluated
  切法覆盖不足：边 gate -> gate/config 的 importedNames=[shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS,
  resolveRunnerOptions, discoverWorkspaceRoot, loadWorkspaceGates, loadWorkspaceGateMetadata, readGatesConfig,
  GatesConfig] 中 [shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS, resolveRunnerOptions, GatesConfig] 未被任何 move 的 sy…
```

(The first line is **character-identical** to carrier record 75's `downgrades` except the prototype's trailing
word: `本原型不猜` there, `本实现不猜` here.)

### AFTER — an ArchGuard 0.1.39 build that carries the `stays` clause

The adapter declares, for both candidates:

```json
"stays": [{ "dir": "gate/config", "symbols": ["CoverageFloorEntry","DEFAULT_ACCEPTANCE_TIMEOUT_MS",
  "FixedEntry","GateConfig","GatesConfig","It0Entry","RedGreenEntry","RunnerOptions","TestPassEntry",
  "resolveRunnerOptions","shQuote"] }]
```

(the union of the uncovered names over all four edges into `gate/config` — every one of them occurs on a real
edge, AC6).

**cand① — `cli -> gate/config`** (target `accounting` entry, verbatim):

```json
{"edge":"cli -> gate/config",
 "names":["resolveWorkspaceRootOrThrow","resolveRunnerOptions"],
 "moving":[{"name":"resolveWorkspaceRootOrThrow","to":""}],
 "staying":["resolveRunnerOptions"], "unaccounted":[], "destinations":[""], "survives":true, "strength":null}
```

`status` is no longer `not-evaluated`; `removedEdges` does **not** contain `cli -> gate/config`; the only
removed edge is `"" -> gate/config (resolveAcceptanceTimeoutMs) [intra-directory]` (the fully-covered one).
`affectedConsumers` for the target: `becomes: "survives"`, `moved_from_dir: "gate/config"`, `moved_to_dir: ""`.

**cand② — `gate -> gate/config`** (target `accounting` entry, verbatim):

```json
{"edge":"gate -> gate/config",
 "names":["shQuote","DEFAULT_ACCEPTANCE_TIMEOUT_MS","resolveRunnerOptions","discoverWorkspaceRoot",
          "loadWorkspaceGates","loadWorkspaceGateMetadata","readGatesConfig","GatesConfig"],
 "moving":[{"name":"discoverWorkspaceRoot","to":""},{"name":"loadWorkspaceGates","to":""},
           {"name":"loadWorkspaceGateMetadata","to":""},{"name":"readGatesConfig","to":""}],
 "staying":["shQuote","DEFAULT_ACCEPTANCE_TIMEOUT_MS","resolveRunnerOptions","GatesConfig"],
 "unaccounted":[], "destinations":[""], "survives":true, "strength":null}
```

All four names the carrier recorded as uncovered appear in `staying`; `unaccounted` is empty; the edge is not
removed. (The `cli -> gate/config` entry in the same run shows `staying: ["resolveRunnerOptions"]` — the same
slice drives both candidates; record ① and record ② are two readings of one cut.)

**Both runs:** `scc 4 -> 4`, `guards.clean: false`, `negative_control.falsified: false` ⇒ the adapter reports
`status: "guard-violated"` with `NEGATIVE_CONTROL_NOT_FALSIFIED`. That is a property of *this cut* (it retargets
a symbol without changing the cycle's membership — `gate/config/factories` still import the directory), not of
the declaration; "the delta is computed" is exactly what the adapter's `guard-violated` status means
(exit 1 = evaluated, guard tripped). It is not a `not-evaluated`.

## 5. AC4 — coverage is matched by NAME, globally

The primitive settles `uncovered` by `!destOfSymbol.has(n) && !stayedSymbolDir.has(n)`, never consulting the
edge's `to`. So one declaration settles **every** edge carrying that name: `resolveRunnerOptions` is imported
by four different edges into `gate/config` and is declared **once**.

The consequence is not a defect this task tries to fix or bypass — it is pinned honestly instead: the tests
assert on the **target edge's own `accounting` entry** (`gate -> gate/config`, four staying names), never on
the report-wide `status`, and separately require its sibling (`gate/factories -> gate/config`, ten staying
names) to carry a *different* per-edge entry. If matching were per-edge the two entries would be one verdict;
the assertion distinguishes them.

This also explains why the complement must be computed for **every edge the cut touches**, not only edges into
a moved-from dir: an edge that merely *contains* a moved name (a re-export/barrel path) is reconciled too, and
its non-moved names have to be declared staying in its own `to` dir.

## 6. AC5 — the cross-directory degradation is real and tested

When one name is uncovered on edges into **two different** dirs, declaring it twice would make ArchGuard
report `目的地冲突` (`simulate.ts:297`) — a `not-evaluated`, not a fix. The adapter detects it first and emits
**no** `stays` (`stays_skipped = "CROSS_DIR_CONFLICT:shared"`), so the cut stays under-covered and the tool
keeps refusing. Tested with a synthetic graph; the assertion is on a state that is actually reachable.

## 7. AC3 — the negative control

The test mutates the module's **own emitted slice** (rewrites the `--slice` file the adapter wrote, deleting
`resolveRunnerOptions` from the declaration) and hands it to the real CLI. The cut is refused again. The AC1/AC2
assertions are therefore not vacuous: a declaration missing one real name does not compute.

## 8. Coverage of the change

- `plugin/test/ownership-active-slice-adapter.test.mjs` — 9 tests. On a host whose ArchGuard implements
  `stays`: **9 pass**. On a host carrying only the released `@yalehwang/archguard@0.1.39` (this one's default):
  **5 pass, 4 skip** — AC1/AC2/AC3/AC4 and the rule-3b test skip, each with an explicit reason naming the
  released-version gap and reporting `stays_ignored_by_tool`. They are never silently green.
- `plugin/test/ownership-active-loop.test.mjs` — 53/53 pass unchanged (the fully-covered path emits no
  `stays`).

## 9. Boundary — what this does NOT do

- It does **not** touch the ArchGuard/archguard repository, create or activate any Goal/task, or change any
  existing safety gate or the three-consecutive-rounds admission threshold.
- It does **not** make the two candidates pass the *restricted-proposal* gates — only makes `slice_delta`
  able to **compute** a result for them.
- It does **not** ship the `stays` clause: that is an ArchGuard release, and until it exists the change is
  inert on the adapter's default CLI resolution (§1). The adapter reports that inertness
  (`stays_ignored_by_tool`) instead of hiding it.
