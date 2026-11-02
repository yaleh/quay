---
id: gap-ci-red-on-version-tagged-commit
title: CI 对「被打成版本 tag 的提交」恒红 —— build 形态在该提交上解析成 release 形态，套件里 tracked-vs-build
  的比较全部失败
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

2026-11-02 切 v0.31.1 时实测：发布提交 280c11461（tag v0.31.1 指向它）的 CI run 41411076224 三个 job 红（test 里的 plugin-packaging / npm-pack-e2e，以及 dist-verify-node-floor），失败签名统一：
- plugin/test/plugin-packaging.test.mjs:86：`plugin.json version must match packages/quay/package.json`，actual `0.31.1` vs expected `0.31.1-dev`；
- dist-verify-node-floor 步骤日志：`[sync-vendor] stamping the built plugin tree (build-form, branch-aware)...` → `STAMP-VERSION: mode=build root=/_work/quay/quay source=.../VERSION = 0.31.1 => every carrier must == 0.31.1`；
- packages/quay/test/npm-pack-e2e.test.mjs:188 同类（temp copy 的 stamp-version --check 判 carrier 不等于 0.31.1-dev）。

机制（读码 + 对照实测）：scripts/resolve-version.ts 的 build 模式规则是「HEAD 恰好落在 tag vX.Y.Z（或当前分支 release/*）⇒ 裸 X.Y.Z；否则 X.Y.Z-dev」。plugin/scripts/sync-vendor.sh:559 在测试期对 REPO_ROOT 本体执行 `stamp-version.mjs --mode build --repo-layout --root REPO_ROOT --git-root REPO_ROOT`，于是：提交一旦被打上版本 tag，CI（fetch-depth: 0，能看见 tag）在该提交上解析出 release 形态 ⇒ 把工作树的 carriers 改写成 X.Y.Z；而套件里多处比较「tracked 形态（X.Y.Z-dev）vs build 形态」，于是红。

对照读数（2026-11-02 实测，同一命令）：
- 分支 author（VERSION=0.32.0）：`node --experimental-strip-types scripts/resolve-version.ts --mode build --root /data/home/yale/work/quay` → `0.32.0-dev`
- detached at v0.31.1 → `0.31.1`

这意味着任何提交在自己被 tag 之后跑的 CI 都会红。v0.31.0 的提交没红，只是因为那次 CI 在 tag 推上去之前已完成（run 41400838981 success @ 6eceaf088；tag 于 06:46:38Z 创建）。这不是提交本身的缺陷：真正的发布闸 verify-plugin-channel（真实安装该 tag 的产物）在 v0.31.1 上通过。

影响：release-cut 的次序就是「push 提交 → 立刻打 tag → dispatch」，因此发布提交的 CI 读数恒为红，并会污染 release-cut preflight 依赖的「最近决定性 CI」读数。

## Acceptance Criteria

- [x] AC1：给出可跑判据，证明「在被打成 vX.Y.Z tag 的提交上跑测试期 build 形态 stamp 后，tracked-vs-build 比较仍绿」——同一提交同一组用例的修复前后对比（修前红、修后绿），命令与读数贴进任务。
- [x] AC2：修复必须让「release 形态」只作用于产物、不作用于被测试的工作树，或让 CI 的 checkout 看不到版本 tag（fetch-tags: false）。二选一须写明理由与被否决方案的代价。
- [x] AC3：负向控制——普通 develop 提交（无 tag）跑同一路径，读数必须与修复前一致（`0.32.0-dev`），证明修复没有把 dev 形态也改掉。
- [ ] AC4：给出「tag 提交的 CI」一次真实全绿 run 的 URL（生产载体读数，不是 fixture）（待外部）

## Definition of Done

- [ ] 落地改动在 develop 上，且其 CI 绿。（待外部）
- [ ] 在下一次真实发布里观察到发布提交的 CI 为绿（或明确记录为什么选择「接受红并豁免」而不是修）（待外部）
- [x] 一行可验证的回归判据留在仓库里（测试或 CI 步骤），任何人重跑都能看到。

## ADR-007 dark-axis record

该轴仍暗,理由:修复只改 resolve-version 的 build 模式判定分支（named branch 与 detached tag 的优先级），无包/依赖结构变化，L_D/L_G 无可测结构量。

## Evidence

修复选型（AC2）：取「release 形态只作用于产物、不作用于被测试的工作树」。理由：根因在 resolve-version 的 build 判定把「HEAD 恰好落在 tag」一律判成 release build，而 release build 的产物只在 detached@tag / release/* 检出上成立；named branch 上的 tag 是 CI-on-tagged-commit（被测试的工作树），必须保持 -dev。被否决方案（让 CI checkout 看不到 tag，fetch-tags: false）的代价：actions/checkout@v4 在 `fetch-depth: 0` 下 refspec 固定含 `+refs/tags/*:refs/tags/*`，`fetch-tags: false` 只在浅克隆（fetch-depth>0）时生效，对 `fetch-depth: 0` 无效（读 vendored checkout 源码 git-source-provider.ts:172-184 与 git-command-manager.ts:281-283 确认）；要做到看不到 tag 只能弃用 `fetch-depth: 0`（破坏 test-group-downgrade-check 的 enforcement baseline 8ea050c7）或 checkout 后删本地 tag（CI-only hack，不修 resolver 这个真正的判定器）。

AC1 修复前后读数（同一 temp repo：VERSION=0.0.1，分支 develop，tag v0.0.1 打在 HEAD）：
- 修前（develop 的 resolver）：`node --experimental-strip-types scripts/resolve-version.ts --mode build --root <repo>` → `0.0.1`（release 形态 ⇒ sync-vendor 戳工作树 ⇒ tracked-vs-build 红）
- 修后（同一命令，named branch + tag at HEAD）：→ `0.0.1-dev`（stamp 变 no-op ⇒ tracked-vs-build 绿）
- 修后（同提交转 detached@tag，产物形态保留）：→ `0.0.1`

AC3 负向控制（本 worktree 分支 task/gap-ci-red-on-version-tagged-commit，无 tag，VERSION=0.32.0）：
- `node --experimental-strip-types scripts/resolve-version.ts --mode build` → `0.32.0-dev`（与修复前一致）

回归判据（DoD 3）：`scripts/resolve-version.test.ts` 新增/改写两条——pure 层「matching tag at HEAD only strips the suffix on a DETACHED HEAD, never on a named branch」+ REAL git 层 case (c)/(c2)（named branch+tag ⇒ -dev；detached@tag ⇒ bare）。运行：`node --no-warnings --experimental-strip-types --test scripts/resolve-version.test.ts` → 15 pass / 0 fail。

## Touches

- scripts/resolve-version.ts
- scripts/resolve-version.test.ts
- plugin/scripts/sync-vendor.sh
- plugin/test/plugin-packaging.test.mjs
- packages/quay/test/npm-pack-e2e.test.mjs
- .github/workflows/ci.yml
- tasks/gap-ci-red-on-version-tagged-commit.md