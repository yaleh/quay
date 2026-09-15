---
id: gap-ci-suite-red-on-fresh-checkout-beyond-config-yml
title: CI 在真正干净的 checkout 上仍有 10 个测试文件红——不是 .quay/config.yml 问题,是至少 4
  类不同根因(生产数据依赖 / CI 环境缺步骤 / 硬编码路径 / 已知 reflog-baseline 模式)
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
## Finding

**证据来源（2026-09-15 investigating a GitHub Actions CI run on develop, commit `9dd806756` — after the `.quay/config.yml` bootstrap fix landed and confirmed working; source: `gh run view --job=104231864466 --log-failed` on run `34921960393`, full run took 18m8s, i.e. this is NOT a timeout artifact, the suite ran to completion and reported 10 genuinely failing files）**：

The `.quay/config.yml` bootstrap fix (this session, already landed) was necessary but not sufficient for CI to be green on a truly fresh `actions/checkout@v4`. Ten test files still fail, in (at least) four DISTINCT root-cause classes — do not treat this as one problem:

**Class A — genuinely reads real, gitignored production runtime data (`.quay/*.jsonl`), by this repo's own stated design philosophy (CLAUDE.md 硬规则 4 推论三: prefer real-carrier reads over fixtures) — these were presumably never meant to pass on a checkout with zero accumulated history, but currently fail LOUD (AssertionError) instead of gracefully reporting NOT-EVALUATED when the carrier is empty/absent, which is the wrong failure shape (see the `registry-bare-filename-scan` fix landed earlier this same session as the reference pattern: distinguish "carrier absent, can't evaluate" from "carrier present, predicate failed" — exit 3, not exit 1/AssertionError):**
- `packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs` — `AC5 (window consistency): ... on real data` → `AssertionError: real production data renders ≥1 fanin segment in the page`
- `packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` — `AC7 (production regression): real .quay data renders ≥1 <rect> in BOTH cards` → `AssertionError: fan-in bar renders ≥1 <rect> from real worker-outcome.jsonl`
- `packages/quay-native/test/goal-ac-write-face.test.mjs` — `AC1 — the detector is green on the real repo and its --json reading is OK with no violators` → `AssertionError: default run must be green, got 1`
- `plugin/test/prod-data-audit.test.mjs` — `AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks` → error references `checker-cost.jsonl@/home/runner/work/quay/quay/.quay/checker-cost.jsonl` (empty/absent on a fresh checkout)

**Class B — CI runner is missing a setup step this test's own fixture needs (NOT a "production data" issue — these would need the same fix on ANY fresh checkout, including a real contributor's first `git clone`, not just CI specifically):**
- `plugin/test/axis-generator.test.mjs` (3 sub-failures: "AC2 prefriction-count" family) → `AssertionError: Committer identity unknown … *** Please tell me who you are. … git config --global user.email … git config --global user.name … fatal: empty ident name`. The GitHub Actions runner (and any bare fresh clone) has no git identity configured, and this test's own fixture apparently does a real `git commit` without first setting a scoped identity for its own fixture repo. Fix belongs in the TEST's own fixture setup (`git config user.email/user.name` scoped to the fixture repo it creates), not a CI-wide `git config --global` (that would mask the same latent gap for a real contributor's first clone).
- `plugin/test/launch-settings.test.mjs` — `AC7 — the settings file loads cleanly under claude --settings (no validation error)` → `AssertionError: claude --settings must exit 0: undefined … null !== 0` (actual=null, meaning the `claude` binary likely isn't found/executable at all in this environment — `null` exit code from a spawn is the Node signature for "process could not be spawned" or was killed by a signal before producing a real exit code). Needs investigation: does this test require the `claude` CLI to be installed on the test-running machine, and if so, is that a reasonable requirement for CI (may need to skip/NOT-EVALUATE when `claude` isn't on PATH, rather than assume it always is).

**Class C — a genuine hardcoded-path portability bug in the test itself, unrelated to "missing runtime state":**
- `plugin/test/outer-cron-registry.test.mjs` — `registryBaseFor / registryFileFor: 全局 per-layer 路径 + slug 分片 + QUAY_GLOBAL_DIR 覆盖` → `AssertionError: Expected values to be strictly equal: + '/tmp/fake-global/-home-runner-work-quay-quay' - '/tmp/fake-global/-home-yale-work-quay'`. The test's own expected value literally has the string `-home-yale-work-quay` baked in — i.e. it hardcodes the repo-author's own local absolute path (`/home/yale/work/quay`) as the expected slug, rather than deriving the expected slug from the ACTUAL repo root the test is running against. This will fail for every contributor and every CI runner whose checkout path isn't literally `/home/yale/work/quay` — a real, unconditional portability defect, not an environment-setup gap.

**Class D — a known, already-documented pattern (session memory: `frozen-sha-baseline-expires-into-permanent-not-evaluated.md`) resurfacing on a fresh checkout specifically because reflog depth is checkout-local and a fresh clone's reflog is empty/shallow:**
- `plugin/test/direct-to-develop-bypass-check.test.mjs` — `AC3 回放·CLI — 全量扫描（生产基线 b11ce720）NOT-EVALUATED：reflog 被 gc 剪 ⇒ 不伪装成「未发现 direct」` → `AssertionError: 部分可分类 ⇒ 0 < ratio < 1`. The test's own name says it EXPECTS a NOT-EVALUATED outcome for this exact reflog-exhaustion scenario, but the actual classification ratio assertion (`0 < ratio < 1`) still fails outright rather than the test correctly special-casing the NOT-EVALUATED shape as a pass. Needs the test author to check whether this is the test itself not handling its own documented NOT-EVALUATED case, or whether the frozen baseline SHA (`b11ce720`) genuinely needs to be re-pinned/refreshed.

**Not yet fully diagnosed — flag for the implementer, do not guess:**
- `packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs` — `AC3: the rendered label set equals the %D-nonempty commit set; develop appears once` → `AssertionError: develop label appears on exactly one commit (got 0, was 6)`
- `packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs` — `AC8: the decorations data layer is unchanged` → same underlying assertion (`develop label appears on exactly one commit`)
- Both look like they depend on the `develop` ref's git-decoration visibility (`git log --decorate`-style `%D` output) at the exact commit CI checked out — worth checking whether this is a git-decoration/ref-state difference specific to `actions/checkout@v4`'s checkout mechanics (e.g. does it leave `develop` as a real local branch ref, or only as a detached HEAD / remote-tracking ref, which would change what `%D` reports) versus a real behavioral difference.

Also note: `plugin/test/long-term-guarantee-goal-backed-check.test.mjs` also failed in this same CI run, but that was traced to a real, separate regression (two tasks I filed in this same session carrying `delivery-critical` without `goal_ac`) and has ALREADY been fixed (labels corrected) — do not re-list it as part of this finding's scope; mention it only as a note that it's resolved.

**查重（本次已做，非关键词，逐机制核对，非重复）**：`gap-config-yml-example-and-ci-bootstrap`（该 id 在任务库中已不存在，可能已被合并/重命名——但其修复内容 `.quay/config.yml` 引导已确认落地于 develop，本 finding 明确是它的下游/独立问题）与 `gap-dist-closure-missing-driver-anchor-js`（已 done，修 dist 打包闭包对 driver-anchor 的动态路径引用盲区，与本 finding 的「CI 测试套件在真实全新 checkout 上的红」完全不同机制）均已核对，非重复。逐个测试文件名（`outer-cron-registry.test.mjs`、`prod-data-audit.test.mjs`、`axis-generator.test.mjs`、`launch-settings.test.mjs`、`direct-to-develop-bypass-check`、git-graph 相关）搜索任务库无同名机制任务命中。`gap-dashboard-fanin-card-not-in-auto-refresh`（已 done）与 `gap-dashboard-fanin-panel-and-timeline-bars`（已 done）是本 finding 中 Class A 两条测试所在的原始实现任务，与本 finding（测试在无生产数据的全新 checkout 上应如何优雅降级）不同机制，非重复，仅作交叉引用。

## AC (draft, implementer refines per class)

- [ ] AC1 (Class A): each of the 4 listed production-data-dependent tests distinguishes "carrier absent/empty" from "carrier present but assertion fails" and reports a NOT-EVALUATED-shaped outcome (not a thrown AssertionError) for the former — verified on both a fresh checkout (NOT-EVALUATED) and this repo's own long-lived checkout (still asserts real content, no regression).
- [ ] AC2 (Class B): `axis-generator.test.mjs`'s own fixture sets a scoped git identity for the repo it creates (not `--global`); `launch-settings.test.mjs` either skips/NOT-EVALUATEs when `claude` isn't on PATH, or CI gets `claude` installed if that's actually a reasonable baseline requirement (implementer decides which, with reasoning).
- [ ] AC3 (Class C): `outer-cron-registry.test.mjs`'s hardcoded `-home-yale-work-quay` expectation is replaced with a value derived from the actual test-run root — verified green on a checkout at a DIFFERENT path than `/home/yale/work/quay` (real portability test, not just re-running in place).
- [ ] AC4 (Class D): `direct-to-develop-bypass-check.test.mjs`'s own documented NOT-EVALUATED case (reflog-exhausted-on-fresh-checkout) is verified to actually short-circuit before the ratio assertion, or the frozen baseline is refreshed — implementer's choice, justified.
- [ ] AC5 (git-graph pair): root cause identified for why `develop`'s decoration is invisible on a fresh `actions/checkout@v4` checkout but present on a long-lived local checkout; fixed or confirmed as a fresh-checkout-specific test precondition that needs its own accommodation.
- [ ] AC6: full `bash scripts/test.sh` (or the equivalent CI invocation) verified green on a genuinely fresh `git clone` at a path other than any existing long-lived checkout (the standard this whole finding is measured against) — this is the actual DoD, not each file in isolation.

## Definition of Done

CI (GitHub Actions, `actions/checkout@v4`, fresh clone, no prior repo history/state) runs `scripts/test.sh` (or its CI-invoked equivalent) to a green exit code — verified via an actual CI run, not a local re-run inside an already-long-lived checkout. Each of the 10 originally-failing files above is either fixed to gracefully NOT-EVALUATE in the absence of production data (Class A), fixed at the test's own fixture/environment-assumption level (Class B), fixed as a genuine portability bug (Class C), fixed to correctly recognize its own documented NOT-EVALUATED case or has its frozen baseline refreshed (Class D), or has its git-graph-decoration root cause identified and resolved (undiagnosed pair). Do not paper over any of these by loosening an assertion to "always pass" — the fix must preserve each test's ability to catch a real regression on a repo that DOES have the relevant data/state.

## Touches

- packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
- packages/quay-native/test/goal-ac-write-face.test.mjs
- plugin/test/prod-data-audit.test.mjs
- plugin/test/axis-generator.test.mjs
- plugin/test/launch-settings.test.mjs
- plugin/test/outer-cron-registry.test.mjs
- plugin/test/direct-to-develop-bypass-check.test.mjs
- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs
- packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs
- tasks/gap-ci-suite-red-on-fresh-checkout-beyond-config-yml.md
