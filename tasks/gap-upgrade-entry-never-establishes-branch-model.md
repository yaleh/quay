---
id: gap-upgrade-entry-never-establishes-branch-model
title: 交付/升级入口 shipped quay-init.sh 从不建立分支模型——落地基线的 remedy 对真实用户不可达，升级后的旧项目结构性落不了地
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
goal_ac: AC-239
---
## Finding

**实测（2026-09-11，本机直连 orangevps 的 git 输出；⛔ 非推断）**

`gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`（done）修好了**判定**与**一个入口**：
`packages/quay/src/branch-model.ts` 的 `classifyBranch` / `ensureBranchModel` 接进了 **TS `quay init`**
（`packages/quay/src/init.ts:427`），anti-drift 也改成报 `BASELINE-MISMATCH`（exit 3）而不是
「N violation(s)」。它给出的 remedy 逐字是 `quay init --force --adopt-branch-model`。

**但交付/升级路径跑的不是那个入口。** `plugin/scripts/verify-deliver-coldstart.sh` 的 AC-238 升级动作
跑的是 **shipped shell `plugin/scripts/quay-init.sh`**（SPEC §5 的部署/升级入口；`/quay:init` skill 走的
也是它）。该脚本对 `adopt` 的 `grep` 命中数 = **0**；它对分支模型唯一做的事是往 config 里写一行
`fork_baseline: develop`（`plugin/scripts/quay-init.sh:995` / `:2217`），**既不判定该 ref 是否存在、
也不判定它接不接主线、更不建立它**。

⇒ 同一条原则（「不接主线的 develop 不能当落地基线」）存在**两个入口**，只修了一个；而没修的那个正是
**真实用户升级旧项目时走的那个**（硬规则 5b：修好一个 ≠ 只在那一处）。

**真机直接量 —— 三份升级副本全部同形**：

| 副本（orangevps `$HOME`） | 默认分支 | develop | `merge-base --is-ancestor main develop` | develop 上 `tasks/*.md` |
|---|---|---|---|---|
| `quay-verify-upgrade-9eda8c70-root`（AC-238 已通过） | main | d95dac8 | **FALSE** | 0 |
| `quay-verify-upgrade-1c202737-root`（AC-238 已通过） | main | d95dac8 | **FALSE** | 0 |
| `quay-verify-upgrade-289a49dc-root`（AC-238 已通过） | main | d95dac8 | **FALSE** | 0 |

`git merge-base --is-ancestor main develop` = FALSE 就是 `branch-model.ts` 的兼容性谓词本身
⇒ `classifyBranch(develop)` = **divergent** ⇒ 三份副本的 `develop` **全部不可用作落地基线**。
（三份副本均无 `origin/HEAD`、无 `master`，`develop` 停在 d95dac8 / 2025-10-14，其 mrge-base 之后
main 前进了 553–589 个提交。）

**后果不止本任务的人工任务**：同一个副本上，meta-cc **自己既有的** `DIR-100` 也以同一形态失败 ——
`.quay/fan-in-DIR-100-wk-prod-1789111230.log`：
`{"step":"anti-drift","exit":1,"reason":"ANTI-DRIFT HARD FAIL: task DIR-100 — 1566 violation(s)"}`
（2026-09-11T08:37:47Z，与人工任务 ac239 的 08:14:29Z 同形）。即**该副本上任何任务都落不了地**。

**为什么 remedy 到不了用户手里**：`ensureBranchModel` 目前唯一的 CLI 面是 `quay init`，而 `quay init`
非 dry-run 时会**重写整个 config 面**（`generateConfigContent`）。一个有既有 `gates:` / `loop:` /
`routines:` 的旧项目跑它就是**配置被清空** —— 而这恰恰是 `quay-init.sh` 那条「已有 config ⇒ 配置保留
分支」刻意避免的事（`bound: delivered-vendor` 的升级语义也建立在这条上）。
⇒ 在旧项目上，用户**没有**一条既能建立分支模型、又不毁掉自己 config 的路。

## Proposal

方向（⛔ 具体落点由执行者按源码实际形态定，本段不是预设结论）：

1. **让 shipped `quay-init.sh` 走单一判定源**：⛔ 不要在 shell 里重实现 `classifyBranch`（ADR-004 单一
   来源），而是由它调用交付物的 `branch-model` 面。缺的是一条**只做分支模型、不碰 config 面**的入口
   （形如 `quay init --dry-run` 之外的 `--branch-model-only`，或在 `quay-init.sh` 的 config-preserving
   分支里调用同一个函数）。
2. **该路径要有可区分的取值**：divergent 且未给 adopt 决定 ⇒ 拒绝并打印 remedy（fail-closed，与 TS
   `quay init` 同形）；给了 ⇒ adopt（旧 tip 保留为 `<branch>-pre-quay-init-<sha>`，零销毁）。
3. **修好的可核判据**：本机的 `verify-deliver-coldstart.sh` ⑦b 已有落地基线前置
   `AC239_BASELINE_STATUS`（compatible / divergent / absent / unreadable）；修好后它应从 `divergent`
   翻成 `compatible` —— 那就是「修好了」的读数，⛔ 不是「我加了个 flag」。

## What was implemented

**落点（全部在 Touches 内）**：

1. `packages/quay/src/init.ts` —— 新增 `InitOptions.branchModelOnly`。`runInit` 在**config-exists 守卫
   之前**处理它：只跑 `ensureBranchModel`（同一个判定函数），立即返回新 outcome `"branch-model-only"`，
   **不写 config、不 mkdir tasks/、不铺 profiles/launch-settings**。既有 config 是这条入口的**正常输入**
   ⇒ 那条「已存在就拒绝」的守卫对它不适用。
2. `packages/quay/src/cli/init.ts` —— `--branch-model-only`：打印报告；divergent 且未给 adopt ⇒
   退出码 1（fail-closed，报告里已带 `remedy:` 行）；非 git / 无提交（`skipped`）⇒ 如实报 SKIPPED 且
   **不判失败**（读不懂与不合格不同形，硬规则 3b）；`--dry-run` ⇒ 照报但退出 0（dry run 的职责是说
   会发生什么，不是拒绝）。
3. `plugin/scripts/quay-init.sh` —— `--adopt-branch-model` 旗标（`:95`）+ `ensure_target_branch_model`
   （定义 `:2478`，调用 `:2545`）。它**排在所有写入之前**（`write_config` / `write_template` / mkdir
   之前），判定全部委托给交付物 CLI：`node $PLUGIN_ROOT/vendor/quay/dist/quay.js init
   --branch-model-only [--adopt-branch-model] [--dry-run] --root <target>`（`:2510`）。shell 里
   **没有**第二份 ancestry 判定。
   **三种出口彼此可区分**（这是本步的设计核心）：

   | 情形 | 出口 | 行为 |
   |---|---|---|
   | 交付物判 compatible / 已 adopt | 0 | 继续升级 |
   | 交付物报 `[BLOCKED] landing-baseline` | 1 | 打印 remedy、拒绝、**什么都不写** |
   | 交付物没给出判决（崩溃 / 无此旗标 / 读不了项目） | 3 | can't-evaluate 消息，⛔ **不**冒充「基线是分叉」 |
   | 交付物 CLI 本身缺失 | 3（非 dry-run 时 2，见下） | 先复用既有 `ensure_vendor_runtime` 尝试 auto-build |

   ⛔ **第 3 行是本步的一半价值**：`case` 比对报告里的字面 token（`:2524-2532`）才进拒绝路径 ——
   任何非零退出都被当成「分叉」会是硬规则 3b 的教科书违例（读不懂的判官返回判决值）。
   用 `case` 而非 `printf | grep -q`：`set -o pipefail` 下 `-q` grep 可能 SIGPIPE 上游，
   使谓词在**为真时读成假**（本仓库已记过这个形态）。
4. `packages/quay/src/cli/help.ts` —— **5b 产物之一**：`quay init --help` 实际打印的是这里
   （`bin/quay.ts:146` `printHelp(cmd)` 在派发前拦截），而它**连** `--adopt-branch-model` 都还没有 ——
   上一个任务把旗标加进了 `cli/init.ts` 的（实际不可达的）内联 help，漏了**活的**那一面。两条都补上。
5. `packages/quay/test/branch-model.test.mjs` —— **10 条新断言**（文件 19 → 29 条）：
   - `runInit`/CLI 的 config-free 入口 8 条：拒绝 / adopt / 兼容 no-op（AC4）/ 非 git skip /
     **写侧负控制（config sha256 逐字不变）** / 「config-free 入口优先于 config-exists 守卫」；
   - **shipped `quay-init.sh` 本身 2 条**（拒绝 + 兼容不拒绝）。第 2 条是「把交付面钉在可执行判据上」，
     ⛔ 不让「shipped 入口会判定基线」这件事只活在任务体散文里：删掉 `:2545` 那个调用点，shipped 入口
     就会静默退回「分叉也 exit 0」，而这条测试会红。两条都只跑**拒绝/判定**路径（排在闭集写入之前）
     ⇒ 各约 2.9s，无写入、无 lane 副作用。
   **可证伪性（负控制，实跑）**：把 4 个被改的源码文件换回 pre-fix 版本（测试文件保留），
   ```
   ℹ tests 29   ℹ pass 20   ℹ fail 9      （9 条红的全部是本次新增的；其余 20 条与改动无关，全绿）
   ```
   换回后 `ℹ pass 29  ℹ fail 0`。⇒ 这 10 条**确实**在「没有这个修复」时取假。

## Acceptance Criteria

- [x] AC1 shipped `plugin/scripts/quay-init.sh` 在目标项目的 `develop` 不接主线时**不再静默放过**：
      留下可核痕迹（拒绝并打印 remedy，或按显式 adopt 决定修复），且判定来自**单一实现** —— 用
      `grep -c` 证明 shell 侧没有第二份 `merge-base --is-ancestor` 之类的手搓判定（命中数为 0 或
      指出那唯一一处并说明为何它不是第二份实现）。
      > **① 判定来自单一实现（调用点唯一）**：`plugin/scripts/quay-init.sh` 里对「分支模型」只有
      > **一个**动作点 —— `:2545` `ensure_target_branch_model`（定义 `:2478`），其 `:2501`
      > `bm_args=(init --branch-model-only)`、`:2510` `bm_out="$(node "$qrl" "${bm_args[@]}")"` 调的是
      > **交付物 CLI**；判定本体仍在 `packages/quay/src/branch-model.ts` 的 `classifyBranch`
      > （ADR-004 单一来源）。shell 侧**只比对报告里的一个字面 token**（`:2524-2532` 的
      > `case "$bm_out" in *"[BLOCKED] landing-baseline"*`）来区分「交付物给出了分叉判决」与
      > 「交付物根本没给出判决」—— **比对判决不是计算判决**，判定仍是 branch-model.ts 的。
      >
      > **② 位置判定（不是关键词判定，硬规则 2）** —— ancestry/兼容性谓词族逐条 grep：
      > ```
      > $ F=plugin/scripts/quay-init.sh
      > $ grep -nE 'merge-base|is-ancestor|rev-list|branch --merged|--contains|show-ref|symbolic-ref|rev-parse' $F
      >   2346:  if ! git -C "$WORKSPACE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      >   2462:# ... 散文注释里出现 `merge-base` 一词（本次新增的说明文字）
      >   2472:# ... 散文注释里出现 `git merge-base --is-ancestor`（同上，是「⛔ 不要这么做」的告示）
      >
      > $ grep -nE '<同上族>' $F | grep -vE '^[0-9]+:[[:space:]]*#'   # 只留命令位
      >   2346:  if ! git -C "$WORKSPACE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      > $ ... | wc -l
      > 1
      > ```
      > **那唯一一处不是第二份实现**：它在 `auto_commit_laid_down`（定义 `:2345`，守卫 `:2346`），是
      > 「这个目录是不是一个 git 仓库」的守卫 —— 不读 `develop`、不比较任何两个 ref 的祖先关系、
      > 不产出任何兼容性取值。
      > 另 2 命中是本次新增注释里的散文词，不执行（按位置判定 ⇒ 不计）。
      >
      > **③ 「不再静默放过」的真机读数**（同一次运行里两条都取到）：
      > - 真机副本（orangevps，隔离副本 `/home/yale/quay-ac-bm-copy-root`，源自
      >   `quay-verify-upgrade-289a49dc-root`）**默认**（不给 adopt 决定）：
      >   ```
      >   exit=1
      >   refusal line fired: 1
      >   config sha256 after default run: 7c6ff8e7176e744c82ebb53e6424882de2cbc2168ff6626dbc7d894986d02b52
      >   byte-identical: YES
      >   develop after default run: d95dac810de9b492b2933f0ba308d659f0de2c64   （= 升级前，未被动过）
      >   [BLOCKED] landing-baseline -> develop — 'develop' (d95dac81) is NOT a continuation of the
      >     project's default branch 'main' (b4586b56) — it is 589 commit(s) behind and shares only an
      >     old merge base, so a task diff against it is meaningless.
      >   remedy: Re-run with branch adoption enabled ... CLI `quay init --force --adopt-branch-model` ...
      >   ```
      >   ⇒ 拒绝 ∧ 打印 remedy ∧ 什么都没写。
      > - 本机夹具（默认分支 `main` + 不接主线的 `develop`）同形：`exit=1`、`refused=1`、
      >   config sha256 `40d6a97b…` 前后相同、`develop` 停在 `5d804558`。

- [x] AC2 夹具实测（默认分支 `main` + `develop` 是不接主线的分叉）：默认 ⇒ 升级动作**拒绝**且
      `.quay/config.yml` **逐字未变**（前后 sha256 相同）；带 adopt 决定 ⇒ `develop` 被重指到 main tip
      且旧 tip 保留为 `develop-pre-quay-init-<sha>`。两条真实输出（含退出码）贴回本任务。
      > **夹具**：`/tmp/quay-ac-bm-fix/fixture-divergent`（`bash /tmp/quay-ac-bm-fix/fixture.sh <repo> <dir>`，
      > 脚本已贴在本任务 `## Fixture (reproducible)` 一节；默认分支 `main`，`develop` 从 `main~50` 分叉、从未并回，
      > `.quay/config.yml` 带用户自己的 `gates.custom-user-gate` 与 `loop.routines`）。
      >
      > **默认（不给 adopt 决定）** —— 真跑输出：
      > ```
      > $ bash <worktree>/plugin/scripts/quay-init.sh --root $D --repo-root $D \
      >       --worktree-root $D-worktrees --auto-commit-skip
      > RUN1 exit=1
      > config sha256 before=40d6a97b020ab246dc1b7521b12503476bd5b4a7af7e6b03d576d3dc03103d94
      > config sha256 after =40d6a97b020ab246dc1b7521b12503476bd5b4a7af7e6b03d576d3dc03103d94
      > byte-identical: YES
      > develop unchanged: 5d804558a5e8f134592b37c4c1889323f9ee2f1c
      > refused? 1
      >   pre-existing: .quay/config.yml        ← 闭集报告：config 是「本轮没动」而不是「写了」
      >   unwritten:    .quay/profiles.yml
      >   unwritten:    tasks
      >   unwritten:    goals
      >   unwritten:    .gitignore
      >   unwritten:    .claude/launch.settings.json
      >   unwritten:    .claude/settings.json
      > ```
      > **带 adopt 决定** —— 真跑输出：
      > ```
      > $ ... --adopt-branch-model ...
      > RUN2 exit=0
      > [ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-5d804558] — 'develop' was a
      >   foreign fork (5d804558); preserved as 'develop-pre-quay-init-5d804558' and re-pointed at main (0795c1e2)
      > develop now       = 0795c1e252d8a6751c40620b3bf9a93804809ab3
      > main              = 0795c1e252d8a6751c40620b3bf9a93804809ab3
      > develop == main tip   : YES
      > backup ref        = 5d804558a5e8f134592b37c4c1889323f9ee2f1c
      > backup == old tip : YES
      > main ∈ ancestors(develop) now: TRUE
      > ```
      > **同一条在真机副本上（更强的形态，因为它有一个真实的旧 config）**：
      > ```
      > [ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-d95dac81] — 'develop' was a
      >   foreign fork (d95dac81); preserved as 'develop-pre-quay-init-d95dac81' and re-pointed at main (b4586b56)
      > develop before: d95dac810de9b492b2933f0ba308d659f0de2c64
      > develop after : b4586b56c8b7c05983299b4d792a04dd28a625d9       exit=0
      > backup == old tip: YES
      > main ∈ ancestors(develop) now: TRUE
      > tasks/*.md on develop now    : 103        （升级前 = 0）
      > ```
      > ⇒ 旧 tip 零销毁地被保留，而 `develop` 现在是主线的延续（`tasks/*.md` 由 0 变 103 就是
      > 「落地基线现在真的是主线」的直接量）。

- [x] AC3 端到端翻转：同一夹具上，升级动作之后 `verify-deliver-coldstart.sh` ⑦b 的
      `AC239_BASELINE_STATUS` 由 `divergent` 翻成 `compatible`（真实输出贴回；⛔「我加了个 flag」不算）。
      > **⚠️ 判据来源的诚实说明**：⑦b 这个前置**本身**还没进 `develop` —— 它在
      > `task/gap-aged-project-post-upgrade-driver-e2e` 的提交 `abed1351f`（该任务 status=ready，
      > 未落地；`git merge-base --is-ancestor abed1351f develop` = NO，`grep -c AC239_BASELINE_STATUS
      > plugin/scripts/verify-deliver-coldstart.sh` = 0）。所以下面**不**是自造的近似读数，而是把
      > ⑦b 的**原命令行与解析函数逐字取出**后跑出来的：
      > ```
      > # ⑦b 的原命令（step_upgrade_drive_continue ⓪c）
      > bl_out="$(cd "$root" && node "$qrl" init --dry-run --adopt-branch-model --root "$root" 2>/dev/null)"
      > # ⑦b 的原解析器（从 abed1351f:plugin/scripts/verify-deliver-coldstart.sh 逐字提取，未改一字）
      > ac239_baseline_state() { ... [REUSED]→compatible ; [ADOPTED]/[BLOCKED]→divergent ;
      >                               [CREATED]→absent ; 其余→unreadable ... }
      > ```
      > ⛔ 本次**没有**改 `verify-deliver-coldstart.sh`（DoD 禁「给验证器加一条绕过」，且它不在
      > 本任务 Touches 内）。等那个任务落地后，⑦b 就是现成的消费者。
      >
      > **本机夹具 —— 翻转前后（同一条命令、同一个解析器）**：
      > ```
      > BEFORE: rc=0 :: [ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-5d804558]
      >                      — would preserve 'develop' as 'develop-pre-quay-init-5d804558' and re-point 'develop' at main
      >         AC239_BASELINE_STATUS=divergent
      >
      >   （升级动作，带 adopt 决定，exit=0；用户自己的 gates.custom-user-gate 与 loop.routines 原样保留）
      >
      > AFTER : rc=0 :: [REUSED] landing-baseline -> develop — 'develop' contains 'main'
      >                      (0 commit(s) ahead, 0 behind) — a valid quay landing baseline
      >         AC239_BASELINE_STATUS=compatible
      > ```
      > **真机升级副本 —— 同一翻转**（`/home/yale/quay-ac-bm-copy-root`，由 npm-pack 交付物
      > 装进全新 prefix `~/.quay-ac-bm.npm` 后驱动）：
      > ```
      > BEFORE: rc=0 :: [ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-d95dac81]
      >         AC239_BASELINE_STATUS=divergent
      > AFTER : rc=0 :: [REUSED] landing-baseline -> develop — 'develop' contains 'main'
      >                      (0 commit(s) ahead, 0 behind) — a valid quay landing baseline
      >         AC239_BASELINE_STATUS=compatible
      > ```
      > ⇒ **divergent → compatible 的翻转是升级动作**（唯一变量是 adopt 决定）造成的；⛔ 不是
      > 加旗标、不是换读数口径：`--dry-run` 全程只判定不写，前后两次跑的**只有 ref 状态**不同。

- [x] AC4 负控制：`develop` 本来就兼容（main 是它的祖先）时，升级动作**不**做任何 branch 变更
      —— `git rev-parse develop` 前后逐字相同，且 AC1 的拒绝分支不触发。
      > 夹具 `/tmp/quay-ac-bm-fix/fixture-compatible`（`develop` 就是主线的延续，main 是它的祖先），
      > 跑**默认**升级动作（不给 adopt）：
      > ```
      > $ bash <worktree>/plugin/scripts/quay-init.sh --root $D --repo-root $D \
      >       --worktree-root $D-worktrees --auto-commit-skip
      > exit=0
      > refusal branch fired? 0
      > develop before=dd4c774eb6b0709d5b68e178f8eac9c1788855d7
      > develop after =dd4c774eb6b0709d5b68e178f8eac9c1788855d7
      > develop 逐字相同: YES
      > main 逐字相同   : YES
      > backup refs created: 0
      >   [REUSED] landing-baseline -> develop — 'develop' contains 'main' (1 commit(s) ahead, 0 behind)
      >     — a valid quay landing baseline
      > ```
      > ⇒ 两个方向都取到：**不拒绝**、**也不移动**。

## Definition of Done

- [x] 修的是**产品路径**（shipped `quay-init.sh` 或它调用的交付物面），⛔ 不是给 e2e / 验证器加一条绕过。
      > 改动全部落在产品面：`plugin/scripts/quay-init.sh`（shipped 升级入口）、
      > `packages/quay/src/init.ts` + `packages/quay/src/cli/init.ts`（它调用的交付物面）、
      > `packages/quay/src/cli/help.ts`（`quay init --help` 的活 help）、
      > `packages/quay/test/branch-model.test.mjs`（回归断言）。
      > ⛔ `plugin/scripts/verify-deliver-coldstart.sh` **一字未改**（`git diff --name-only develop...HEAD`
      > 不含它）；本任务只**跑**它的 ⑦b 读数。

- [x] AC3 的翻转是在**真机升级副本**上读出来的（本任务已给出三份副本的 `divergent` 读数作为 before）。
      > 真机副本 = orangevps 上 `/home/yale/quay-ac-bm-copy-root`（`cp -a`
      > `quay-verify-upgrade-289a49dc-root` 的隔离副本，源副本只读、未写）。before 读数
      > `AC239_BASELINE_STATUS=divergent`、`develop=d95dac8`（与本任务 Finding 表里的三份副本同形），
      > after 读数 `compatible`、`develop=b4586b56`（= main tip）、`tasks/*.md` 0→103。
      > 交付物是**真 npm-pack 产物**：`bash packages/quay/scripts/package.sh` 出
      > `quay-0.6.1.tgz`（452 files，含 `plugin/vendor/quay/dist/quay.js`，其中 `branch-model-only`
      > 命中 6）+ `quay-native-0.6.1.tgz`，`npm install -g --prefix ~/.quay-ac-bm.npm` 装进**全新 prefix**。
      > ⚠️ 诚实标注：`develop-deliver-tgz.sh` 的构建点是 `develop` tip（本任务尚未 fan-in ⇒ 取不到本分支），
      > 所以这里用**同一条 npm-pack 路由**手工产 tgz + 手工装进新 prefix，其余（shipped `quay-init.sh`、
      > 真实旧副本、真实 config）都是生产形态。

- [x] 硬规则 5b 产物：把「分支模型必须在入口处建立」这条原则的其它适用点 grep 一遍，命中数与前 3 条
      贴进提交；命中数写不出 ⇒ 视为只修了被报出来的这一个。
      > **谓词 = 「生产面里写 `fork_baseline` 或建立分支模型的文件」**（排除 `node_modules`/`dist`/
      > 测试/tasks/archive/doc）：
      > ```
      > $ grep -rl 'fork_baseline' --include=*.sh --include=*.ts packages/ plugin/ \
      >     | grep -v node_modules | grep -v '/dist/' | grep -v '/test/' | grep -v '^plugin/test/' | sort
      > packages/quay/plugin/scripts/quay-init.sh     ← package.sh 的生成快照（gitignored），同 plugin/scripts/quay-init.sh
      > packages/quay/src/branch-model.ts             ← 判定本体（单一实现）
      > packages/quay/src/init.ts                     ← 入口②：TS quay init（上一任务已接 ensureBranchModel）
      > plugin/scripts/config-key-consumer-check.ts   ← 消费者（检查键有没有读者），不写
      > plugin/scripts/fork-baseline.ts               ← 消费者（决定任务从哪 fork），不写
      > plugin/scripts/quay-init.sh                   ← 入口①：本次修的 shipped 入口
      >
      > $ grep -rln 'ensureBranchModel' --include=*.ts --include=*.mjs --include=*.sh . \
      >     | grep -v node_modules | grep -v '/dist/'
      > packages/quay/src/branch-model.ts
      > packages/quay/src/init.ts
      > packages/quay/test/branch-model.test.mjs
      > plugin/scripts/quay-init.sh
      > plugin/test/worker-driver.test.mjs
      > ```
      > **命中数 = 3 个生产文件**（`plugin/scripts/quay-init.sh` / `packages/quay/src/init.ts` /
      > `packages/quay/src/branch-model.ts`），前 3 条按「写 `fork_baseline` 的位点」列出：
      > ```
      > $ grep -rn 'fork_baseline' --include=*.sh --include=*.ts packages/ plugin/ \
      >     | grep -v node_modules | grep -v '/dist/' | grep -v '/test/' | grep -v '^plugin/test/'
      > packages/quay/src/branch-model.ts:32:  // role names the shipped mechanism and `.quay/config.yml`'s `fork_baseline` already carry; …
      > packages/quay/src/init.ts:80:  // silently wrote `fork_baseline: develop` (`quay-init.sh:995/:2217`) without ever establishing it.
      > plugin/scripts/fork-baseline.ts:25:// Invariant (Contract): fork_baseline_is_dependency = 1 — …
      > ```
      > **逐条处置**：① shipped `quay-init.sh`（两个 heredoc 写入位点 `:1002`/`:2224`）—— **本次修**，
      > 写入前先建立；② `packages/quay/src/init.ts` —— 已由上一任务接进 `ensureBranchModel`，本任务
      > 补的是它缺的**config-free 面**；③ `packages/quay/src/cli/help.ts` —— **上一任务漏掉的活的**
      > help 面（`bin/quay.ts:146` 在派发前拦截，`quay init --help` 打印的是这里，而它连
      > `--adopt-branch-model` 都没有）—— 本次一并补上。**其余命中全部是消费者或生成快照，不是入口。**
      > ⇒ 「分支模型必须在入口处建立」这条原则的入口已全部覆盖；`quay-native` **没有**自己的 init
      > 分支模型写入点（`grep -n 'fork_baseline|ensureBranchModel' packages/quay-native/bin/quay-native.ts
      > packages/quay-native/src/*.ts` = 0 命中），它复用同一个 `runInit`。

## 一次自己的失误（记录，不掩盖）

实现完成、测试全绿之后，我做「把源码换回 pre-fix 版本跑红」的负控制时，用
`git checkout HEAD -- <4 个源码文件>` 恢复 —— 而**当时对 `quay-init.sh` 的第二个改动还没提交**
（只存在于工作树），于是它被恢复成**上一个提交**的版本，改动静默消失。发现方式不是「觉得不对」，
而是**回读文件**：`grep -c 'case "$bm_out" in' plugin/scripts/quay-init.sh` = 0。
⇒ 已重新落地该改动并**回读 git 对象确认**（`git show HEAD:plugin/scripts/quay-init.sh | grep -c …` = 1），
且在新提交信息里明写了「上一个提交的信息声称了它但并未包含它」——⛔ 不做历史改写、不掩盖。
教训的两半：① 负控制的「恢复」必须以**当前工作树快照**为源，不能以 HEAD 为源；
② 判「改回去了没有」要回读**对象内容**，不能只看命令退出码（本次退出码全 0）。

## Scoped 门（`--for-task … --allow-thin`）

**第一轮红 —— 一个真实的、被本任务触发的 ratchet，非代码缺陷**：

```
  scoped check: run_checker "quay-init-closure-ratchet-stale" … --check-stale --root <worktree>
  changed: plugin/scripts/quay-init.sh
FAIL: quay-init-closure-ratchet: laydown source changed since the baseline was recorded — re-anchor
      required (run --reanchor). changed=1 added=0 removed=0
STATIC_CHECK_FAILED: quay-init-closure-ratchet-stale exit=1
```

`plugin/scripts/quay-init.sh` 是那台 **shrink-only** 棘轮记录的四个 laydown-source 指纹之一 ⇒ 改它
必然让 `--check-stale` 变红，直到重新锚定（工具自己给出的动作就是 `--reanchor`）。按它的处方**机械重新
锚定**（跑的是**真实 laydown**，不是夹具）：

```
$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor --root <worktree>
PASS: quay-init-closure-ratchet: re-anchored baseline → 3 files / 568 bytes (fingerprint caae383400d31ffe…, 4 source files)
```

**footprint 逐字未变（3 files / 568 bytes，与旧 baseline 相同）** —— 这是「本条改动没有让 quay-init 多铺
一个文件」的直接量（新步骤只判定，排在闭集写入之前）。变的只有 `quay-init.sh` 那一项 sha。
（该 baseline 文件因此进了本任务 Touches。）

## 可区分取值（can't-evaluate 不与合格同形，硬规则 3b）

交付物 CLI 缺失时**不允许**被当成「基线没问题」放过。实测（把 plugin 快照复制一份、删掉
`vendor/quay/dist/`）：

```
# 真实运行（无 --dry-run）
$ CLAUDE_PLUGIN_ROOT=<fake> bash <fake>/scripts/quay-init.sh --root $D … --auto-commit-skip
exit=2
  vendor runtime missing from plugin source (gitignored dist/ — a fresh clone has no built bundles).
  Attempting auto-build via sync-vendor.sh (AC2, path 2) ...
ERROR: plugin source has no built vendor runtime and the auto-build did not produce one …
（develop 未被触碰）

# --dry-run（此处 ensure_vendor_runtime 只报告不构建 ⇒ 走到本任务自己的 can't-evaluate 守卫）
exit=3
  would-ensure-vendor-runtime: plugin source lacks the built vendor runtime …
ERROR: cannot judge this project's branch model — the delivered CLI is absent: <path>
       Refusing to continue: an unjudged landing baseline is not a passing one.
```

⇒ 两个出口都**可区分**（exit 2 / exit 3，各自带明确说明），**没有一个**与「compatible（exit 0）」或
「divergent（exit 1 拒绝）」同形；**没有**把「读不懂」报成「基线是分叉」（那会是硬规则 3b 的镜像失败：
把 can't-evaluate 说成一个具体的 verdict）。
⚠️ 诚实标注：`return 3` 这条守卫在 `ensure_vendor_runtime` 保持自己的 fail-closed 契约时**只在
`--dry-run` 下可达**（非 dry-run 时它先 exit 2）；保留它是为了在「没判定却继续」与「判定为分叉」之间
留一道结构性的分界，而不是因为它被频繁走到。

## Fixture (reproducible)

`/tmp/quay-ac-bm-fix/fixture.sh`（AC2/AC4 的夹具构造，逐字）：

```bash
#!/usr/bin/env bash
set -uo pipefail
WT="$1"; DIR="$2"; MODE="${3:-divergent}"
rm -rf "$DIR"; mkdir -p "$DIR"
git -C "$DIR" init -q -b main
git -C "$DIR" config user.name  "ac-bm-fixture"
git -C "$DIR" config user.email "ac-bm@example.com"
mkdir -p "$DIR/scripts" "$DIR/.quay"
printf '#!/usr/bin/env bash\nexit 0\n' > "$DIR/scripts/test.sh"; chmod +x "$DIR/scripts/test.sh"
for i in $(seq 1 60); do echo "$i" > "$DIR/m$i.txt"; git -C "$DIR" add -A; git -C "$DIR" commit -q -m "mainline commit $i"; done
if [ "$MODE" = "--compatible" ]; then
  git -C "$DIR" branch develop main
  git -C "$DIR" checkout -q develop
  echo "verified work" > "$DIR/verified.txt"; git -C "$DIR" add -A; git -C "$DIR" commit -q -m "verified work on develop"
  git -C "$DIR" checkout -q main
else
  git -C "$DIR" checkout -q -b develop "main~50"
  echo "ancient" > "$DIR/legacy.txt"; git -C "$DIR" add -A; git -C "$DIR" commit -q -m "ancient develop work (2025)"
  git -C "$DIR" checkout -q main
fi
cat > "$DIR/.quay/config.yml" <<'YAML'
providers:
  native:
    enabled: true
    tasks_dir: ./tasks
gates:
  custom-user-gate:
    - name: mine
      script: ./scripts/gates/mine.sh
loop:
  routines:
    - user-owned-routine
  fork_baseline: develop
YAML
```

## fan-in 首轮红 —— develop 侧既有红（按 fail-closed 归本任务）

`scripts/test.sh` 全量那一轮 `5658 pass / 1 fail`，唯一红不在本任务 Touches 内：
`packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` 的 AC6，
`AssertionError: group count (27) == subject-mention count (28)`。按本仓库规矩（100% develop 侧的红
在复现于 ≥2 个任务之前仍算本任务的红）先复现、再定位、再修，⛔ 不 exit-not-landed。

**根因（实测，⛔ 非推断）**：`taskIdFromSubject` 的 Forms 2/3 用**闭集动词表** `翻|reset` 取
`tasks:` 之后的**第一个** token 当任务 id。而 develop 上真实存在
`3789315e0 tasks: carry gap-goal-criteria-bare-failing-exit-unattributable AC state from author (6/8 ticked)`
（`git merge-base --is-ancestor 3789315e0 develop` = 真），`carry` 不在闭集里
⇒ 该提交被判成任务 id **`carry`**，真正的 id 被漏掉 ⇒ AC6 的 subject-only 对账差 1。
同一根在 500 提交窗口里还有 8 条 `carry` + 1 条 `refresh` 被同样错判（实测读数，见提交信息里的 5b grep）。

**修法（定义机制，不是给动词表打补丁）**：把四个 form 各自的「已知前缀」守卫收敛成**一个**模块级常量
（`TASK_ID_PREFIXES` / `TASK_ID_SLUG`，Forms 4/5/6 改为复用它），Forms 2/3 改为取
「第一个**带已知前缀**的 token」而不是「第一个 token」。理由：动词表是开放集（每个 driver 动作一个动词，
每加一个动词就漏一次 id —— `carry` 就是最新加的那个），守卫必须长在 **id** 上，这与 Forms 4–6 早已采用的
判据一致。没有已知前缀 token ⇒ 返回 `null`（显式落进 `unattributedCount`），
⛔ 不再返回 `carry` 这种「读不懂伪装成合格」（硬规则 3b）。

⛔ 本任务的产品面（`quay-init.sh` / `init.ts` / `cli/help.ts`）**一字未改**；上面这条是 develop 侧既有红的
修复，独立于分支模型改动，只是按 fan-in 的 fail-closed 规矩归本任务并写进 `## Touches`。

## Touches

- `plugin/scripts/quay-init.sh`
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/src/branch-model.ts`
- `packages/quay/src/init.ts`
- `packages/quay/test/branch-model.test.mjs`
- `packages/quay/src/serve-git.ts`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-upgrade-entry-never-establishes-branch-model.md`
