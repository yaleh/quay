---
id: gap-architecture-review-detectors-not-runnable-off-quay-repo
title: architecture-review 的三项检测器在任何出厂安装形态下都跑不起来：raw-.ts-only 解析 + 两项根本不随插件发布 +
  检测器自身要求目标仓有 plugin/scripts
status: ready
labels:
  - gap
parent: null
children: []
extra:
  depends_on: []
---
## Proposal

**Measured 2026-10-14 while running the clean-room acceptance `gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance`.** That acceptance's positive control could not be satisfied: on a fresh non-quay host with the OFFICIAL `dist-plugin` build — rebuilt from develop `4732d018b`, i.e. **with both landed prerequisites** (`gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry`, `gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd`) — `architecture_review` cannot produce a single result. The SAME host's `open_semantic_discovery` and `arch_discovery` DO run (verified round records pasted in that task), so the failure is specific to architecture-review, not to the clean host and not to packaging in general.

Three independent, each-sufficient causes — all dev-tree-only assumptions of exactly the family the sibling tasks already fixed elsewhere:

1. **raw-`.ts`-only resolution.** `kernelDetectorArgv` (`plugin/scripts/quality-gate-driver.ts`) builds `path.join(resolveKernelScriptsDir(), "<name>.ts")`. Its own comment records the residual ("已知残差：只有 dist … 这条仍会 ENOENT"). Measured on the shipped tree: `<plugin>/scripts/identity-replication-check.ts` is absent, `<plugin>/scripts/dist/identity-replication-check.js` IS present ⇒ `node --experimental-strip-types <absent>.ts` exits 1 with empty stdout. `resolveKernelSibling()` (`driver-runtime.ts`) already implements the `.ts`→`scripts/dist/<name>.js` fallback; this call site does not use it.
2. **Two of the three detector scripts do not ship at all.** `find <shipped tree> -name '*guard-lineage*' -o -name '*deletion-closure*'` returns nothing — neither raw `.ts` nor `scripts/dist/*.js` (the source tree carries both `.ts`). So even with (1) fixed, two detectors are simply absent from the artifact.
3. **The detectors themselves are root-gated to a quay checkout.** Each refuses unless the TARGET repo has `<root>/plugin/scripts/`: `identity-replication-check.ts`, `guard-lineage-check.ts`, `deletion-closure-check.ts` each exit 2 with `plugin/scripts not found under <root> — is --root correct?`. So a correctly-located detector STILL cannot analyze a third-party repo.

**Real-host corroboration (not fixture):** on ClaudeCodeUI, whose live anchor runs the official dist kernel, `architecture-review` has fired **164 times and failed 164 times** — every one `unparseable identity-replication output (exit 1)`. Zero results, ever.

**Blind spot:** `plugin/scripts/kernel-sibling-resolution-check.ts` (the AC-225 A-domain enumeration) returns `status: pass` on this code — `resolveKernelScriptsDir()` satisfies its predicate. The checker's rule and the deployability property have diverged, so this class cannot be found by that gate.

## Plan

1. Resolve the three detectors through the established two-layout helper: replace `kernelDetectorArgv`'s hand-built `path.join(resolveKernelScriptsDir(), "<name>.ts")` with `resolveKernelSibling(name)` / `kernelSiblingArgv(name, extra)`; make the three call sites fail-closed on `null` with their own legible `not-evaluated:<token>` (硬规则 3b), never a silent ENOENT.
2. Make the artifact carry all three: extend the dist build so `guard-lineage-check` and `deletion-closure-check` ship as `scripts/dist/*.js` the way `identity-replication-check` already does — via the same closure-derivation single-source mechanism Task D used for the discovery engine, not a build-side hand list.
3. Remove the `<root>/plugin/scripts` precondition: each detector's dev-tree carve-out / catalog input must resolve from the KERNEL's own install, while `--root` keeps naming the repo being analyzed. ⛔ Do not weaken detector semantics — only change where their own inputs come from.
4. Negative control: a third-party fixture root with no `plugin/` must yield a real detector report; quay's own dev-loop output must stay byte-identical modulo path prefix.
5. `scripts/test.sh` green; `kernel-sibling-resolution-check.ts` still exit 0.

## Acceptance Criteria

- [x] AC1: on a scratch host with no quay source checkout and the official dist-plugin install, all three detectors resolve and `architecture_review` returns a non-error fact (round record pasted).
- [x] AC2: `find <shipped tree>` shows all three detector bundles present (pasted).
- [x] AC3: each detector against a root with no `plugin/scripts` returns a real report, not `plugin/scripts not found` (stdout + exit pasted).
- [x] AC4: quay's own dev-loop architecture-review output is unchanged modulo path prefix (before/after pasted).
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done

- AC1-AC5 checked with pasted real evidence.
- No detector semantics, trigger computation, or judge-call change; scope is resolution + shipping + root-gating only.
- The sibling checker `kernel-sibling-resolution-check.ts` is extended (or a new control added) so this class is mechanically detectable, not just fixed.

## Evidence

Artifact used below = the REAL `plugin/scripts/publish-dist-branch.sh --no-build` orphan-branch build of this worktree, materialised with `git archive ac-probe-dist | tar -x` (`/tmp/ac-artifact-stub-U3APIX/artifact`, 117 `scripts/dist/*.js`). Host = a fresh `git init` repo with `README.md` + `src/a.ts` and **no `plugin/`** (`/tmp/ac-host`) — no quay source checkout anywhere on the path.

### AC1 — PASS (all three resolve from the installed kernel; the routine returns a non-error fact)

Resolved argv, read off the SHIPPED bundle (`<artifact>/scripts/dist/quality-gate-driver.js`) with a root that has no `plugin/scripts`:

```
identity         => ["node","--no-warnings","<artifact>/scripts/dist/identity-replication-check.js","--root","/scratch/host","--json"]
guard-lineage    => ["node","--no-warnings","<artifact>/scripts/dist/guard-lineage-check.js","--root","/scratch/host","--json"]
deletion-closure => ["node","--no-warnings","<artifact>/scripts/dist/deletion-closure-check.js","a.sh","--root","/scratch/host","--json"]
```

(⛔ none of them is `path.join(kernelScriptsDir, "<name>.ts")` — the shape that produced 164/164 `unparseable identity-replication output (exit 1)` on ClaudeCodeUI.)

`runArchitectureReview(<clean host>)` from that bundle, all three detectors on their defaults:

```
FACT: {"name":"architecture-review","state":"verified","reason":"not-triggered (no candidate clusters)","fired":false}
round record (.quay/architecture-review-round.jsonl written on the clean host):
{"round":0,"judgedAt":"2026-10-13T17:34:14.323Z","state":"not-triggered","triggerReasons":[],"clusterCount":0,"clusters":[],"reason":"no candidate clusters (three detectors produced zero suspicious groupings)"}
```

**Negative control (硬规则 3b — the unresolved case is a NAMED state, not a silent ENOENT read as "ran, no data"):** moving one bundle aside in the same install gives

```
FACT: {"state":"not-evaluated","reason":"not-evaluated:detector-script-unresolved:guard-lineage-check.ts (kernel install carries neither the raw .ts nor scripts/dist/<name>.js — see resolveKernelSibling)"}
```

### AC2 — PASS

```
$ find <artifact> -name '*identity-replication*' -o -name '*guard-lineage*' -o -name '*deletion-closure*'
<artifact>/scripts/dist/deletion-closure-check.js
<artifact>/scripts/dist/guard-lineage-check.js
<artifact>/scripts/dist/identity-replication-check.js
```

Before this change the same `find` returned only `identity-replication-check.js`: the other two were never bundle entries, never bundled, and `publish-dist-branch.sh:178` then deleted their raw `.ts` — **they shipped in no form at all.**

### AC3 — PASS (shipped bundles, root with no `plugin/scripts`)

```
$ node <artifact>/scripts/dist/identity-replication-check.js --root /tmp/ac-host --json
{"root":"/tmp/ac-host","pathConstants":[],"judgmentRewrites":[],…,"rootSurface":{"kind":"absent","pluginScripts":false,…}}   exit=0
$ node <artifact>/scripts/dist/guard-lineage-check.js --root /tmp/ac-host --json
{"root":"/tmp/ac-host","totalGuards":0,"declaredCount":0,"declaredRatio":0,…,"rootSurface":{"kind":"absent","catalogSource":"kernel-install",…}}   exit=0
$ node <artifact>/scripts/dist/deletion-closure-check.js foo.sh --root /tmp/ac-host --json
{"root":"/tmp/ac-host","components":[…],"rootSurface":{"kind":"partial","presentRoots":[],"absentRoots":["plugin","packages","experiments","scripts",".claude/workflows"]},…}   exit=0
```

All three **exit 0 with a real report**; before, each exited 2 with `plugin/scripts not found under <root> — is --root correct?`. Each report carries a three-valued `rootSurface` so "the target has no quay surface" stays distinguishable from "scanned, zero" (硬规则 3b) — the old gate collapsed both into an environment error.

### AC4 — PASS (readings unchanged; one diagnostic key added, declared)

Before (develop's three detectors) vs after (this worktree's), run against the SAME fixed target tree (a pristine `git archive develop` extraction), same args:

```
identity-replication-check   keys only in AFTER: ['rootSurface']   common keys with DIFFERENT values: []
guard-lineage-check          keys only in AFTER: ['rootSurface']   common keys with DIFFERENT values: []
deletion-closure-check       keys only in AFTER: ['rootSurface']   common keys with DIFFERENT values: []
```

Every pre-existing field is byte-identical. Sole difference: the new `rootSurface` field (see AC3). **Declared deviation from a literal reading of "unchanged modulo path prefix":** the detector JSON gains exactly that one key; the *architecture-review* output is unchanged — running the same routine on quay's own tree before/after gives identical mechanical clustering and trigger (`fired: true`, `reasons: ["candidate-clusters=1"]`, `clusterCount: 1` both sides; the later `judged`/`gapFiled` fields differ only because that comparison itself spawned a real LLM judge whose first reply came back markdown-fenced). `clusters`/`trigger` do not read `rootSurface`.

### AC5 — PASS

`bash scripts/test.sh --for-task gap-architecture-review-detectors-not-runnable-off-quay-repo --allow-thin` on the worktree merged with develop `6a56891c9` ⇒ `ℹ tests 172 / ℹ pass 172 / ℹ fail 0 / SCOPED_EXIT=0` (158 selected files, incl. `plugin/test/shipped-set.test.mjs`, which builds the real artifact 3× and gates the size ceiling). Scoped-gate cache recorded at `developSha 6a56891c9`.

### DoD — the class is mechanically detectable, not just fixed

`kernel-sibling-resolution-check.ts` gains **P5 `raw-kernel-dir-join`**: `path.(join|resolve)(resolveKernelScriptsDir()|path.dirname(kernelSelfPath()), …)` in a file that **never** routes a sibling name through `resolveKernelSibling`/`kernelSiblingArgv`. Red-on-prefix control (the same checker binary, two roots):

```
$ … kernel-sibling-resolution-check.ts --root <this worktree>      → PASS — 426 kernel file(s) scanned, 0 naive kernel resource resolution(s)   exit 0
$ … kernel-sibling-resolution-check.ts --root <develop extraction> → RED (1):
  - [raw-kernel-dir-join] (kernel install dir) @ plugin/scripts/quality-gate-driver.ts:659 path.join(resolveKernelScriptsDir(), name),        exit 1
```

The existence check runs on comment-stripped source (develop's file mentioned `kernelSiblingArgv()` **in a comment** — reading that as "already routed through the resolver" would have left the one file this rule exists for permanently green, 硬规则 2). The file-level exemption is load-bearing, not a blanket waiver: a raw join sitting next to a `resolveKernelSibling` call is the documented fail-closed fallback arm and stays green (promotion-driver / driver-runtime). Pinned by 6 unit cases + 4 new mutation-case phases (P5 inject → RED, restore, fallback-arm → GREEN, comment-only mention → RED) in `checker-mutation-cases/kernel-sibling-resolution-check.sh`.

⛔ `resolveKernelPluginRoot()` joins are deliberately out of the rule's directory set: their targets are loose shipped resources (`scripts/assert-clean-tree.sh`, `vendor/quay/dist/quay.js`) that ship verbatim and have no dist bundle to fall back to — including it reddened meta-driver / runner-concurrency / runner-tree-state on the first draft.

### Out-of-scope residue (硬规则 5b — reported, not silently fixed)

The same derivation scan surfaced **two more live siblings of the class** on this tree, both previously absent from the artifact in every install form: `judgment-consumer-check.ts` (spawned by `outer-driver.ts:318` via `kernelSiblingArgv`) and `suite-load-sampler.ts` (spawned by `full-suite-runner.ts:1895` via `resolveKernelSibling`). Because the fix is the SHAPE, both now ship as `scripts/dist/*.js` too, and the shipped-set baseline was re-anchored from the artifact's own reading (281 → 284 files, `--size-ceiling` re-verified PASS).

## Touches

- tasks/gap-architecture-review-detectors-not-runnable-off-quay-repo.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/identity-replication-check.ts
- plugin/scripts/guard-lineage-check.ts
- plugin/scripts/deletion-closure-check.ts
- plugin/scripts/kernel-sibling-resolution-check.ts
- plugin/scripts/publish-dist-branch.sh
- plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh
- packages/quay/scripts/build-plugin-dist.mjs
- plugin/shipped-set-baseline.json
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/identity-replication-check.test.mjs
- plugin/test/guard-lineage-check.test.mjs
- plugin/test/deletion-closure-check.test.mjs
- plugin/test/kernel-sibling-resolution-check.test.mjs
- packages/quay/test/build-plugin-dist.test.mjs
