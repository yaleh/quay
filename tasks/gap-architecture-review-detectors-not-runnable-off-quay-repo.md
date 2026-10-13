---
id: gap-architecture-review-detectors-not-runnable-off-quay-repo
title: architecture-review 的三项检测器在任何出厂安装形态下都跑不起来：raw-.ts-only 解析 + 两项根本不随插件发布 +
  检测器自身要求目标仓有 plugin/scripts
status: todo
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

- [ ] AC1: on a scratch host with no quay source checkout and the official dist-plugin install, all three detectors resolve and `architecture_review` returns a non-error fact (round record pasted).
- [ ] AC2: `find <shipped tree>` shows all three detector bundles present (pasted).
- [ ] AC3: each detector against a root with no `plugin/scripts` returns a real report, not `plugin/scripts not found` (stdout + exit pasted).
- [ ] AC4: quay's own dev-loop architecture-review output is unchanged modulo path prefix (before/after pasted).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done

- AC1-AC5 checked with pasted real evidence.
- No detector semantics, trigger computation, or judge-call change; scope is resolution + shipping + root-gating only.
- The sibling checker `kernel-sibling-resolution-check.ts` is extended (or a new control added) so this class is mechanically detectable, not just fixed.
