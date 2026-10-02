---
id: gap-registry-scan-skip-predicate-matches-absolute-path
title: registry-bare-filename-scan 的跳过谓词按【绝对路径】逐段匹配——worktree
  只要位于带禁名的路径下，载体枚举就静默归零、fan-in 静态相位整片转红
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: v1
---
## Finding

**What.** `plugin/scripts/registry-bare-filename-scan.ts` 的递归枚举把「跳过目录」的判定施加在
**绝对路径的每一段**上，而不是相对 `root` 的路径。载体枚举因此与检出的**落点路径**耦合：
只要 `root` 自身的祖先链里出现任何一个禁名段，`listFiles()` 就一次都不下降、只剩 root 顶层的文件。

两个落点（均实测、2026-10-02，行号为当前文件）：

- `SKIP_DIR_NAMES`（`:82-85`）——`.git` `node_modules` `.quay` `.archguard` `worktrees` `dist` `vendor`
  `archive` `docs` `measurements` `experiments` `packages` `tasks` `.claude` `fixtures`。
- `dirContainsSkip(fullDir)`（`:210-212`）——`return fullDir.split(path.sep).some((seg) => SKIP_DIR_NAMES.has(seg));`
  调用点 `:230`：`if (!SKIP_DIR_NAMES.has(e.name) && !dirContainsSkip(full)) stack.push(full);`
  其中 `full = path.join(current, e.name)`，`current` 起于 `root`（绝对路径）⇒ 匹配的对象是**绝对路径**。

`!SKIP_DIR_NAMES.has(e.name)`（按 basename）本来就是正确的相对判定；`dirContainsSkip(full)` 才是缺陷面。

**Measured evidence（同一棵树、两个 root 路径）.** 同一份 `gap-goal-round-records-unreachable-drafts` 检出放在两处，同一命令：

```text
node plugin/scripts/registry-bare-filename-scan.ts --scan --json --root <root>
```

| root | scriptCount | carrierCount | referencedScripts |
|---|---|---|---|
| `/data/home/yale/work/quay-worktrees/<task>`（常规，仓库外） | 364 | 418 | 11 |
| `/data/home/yale/work/quay/.claude/worktrees/<name>`（`EnterWorktree` 的默认位置） | 364 | **2** | **0** |

⇒ 差值与**代码**无关，只与落点路径里的禁名段有关（第二条同时命中 `worktrees` 与 `.claude` 两个禁名）。

**Consequence in the fan-in.** `runner-static-gate.ts:619` 以 `--check --root <repo_root>` 调用它；`--check` 跑
**已知样本负控制**——要求 `supervisor-bus-identity.sh` 能在载体 `plugin/scripts/quay-deliver.ts` 里被扫到
（该引用是一处真实字符串字面量 `file: "supervisor-bus-identity.sh"`）。枚举归零 ⇒ 控制找不到 ⇒

```text
RED: known-sample supervisor-bus-identity.sh not found by scan (carrier plugin/scripts/quay-deliver.ts drifted or scanner broken)
STATIC_CHECK_FAILED: registry-bare-filename-scan exit=1
# tests 0 / # pass 0 / # fail 45 / # suite red static-check
```

机械 fan-in 因此在**静态相位**红掉，且 `# tests 0`——一条测试都没跑。**实测代价**：一次真实落地（D①，
`gap-goal-round-records-unreachable-drafts`）被这个假红挡住两轮；两次都在低负载（load 8.7）下
**确定性复现**，失败形态（「已知样本找不到」）指向上游 carrier 漂移，是**错误的方向**。

<!-- dedup-ref -->
**Dedup（立案前查询，2026-10-02）**：任务库里命名**本机制**（跳过谓词按绝对路径逐段匹配 ⇒ 载体枚举归零）
的任务不存在（`dirContainsSkip` 命中 0）。机制相邻但**不同**的两条（均 done）：
`gap-dead-set-registry-bare-filename-scan`——本 checker 的创建者，建立了行形状与 `--check` 生产调用点，
但从未触及跳过谓词；`gap-ac157-exclusion-wiring-criterion-divergence`——也提到 `SKIP_DIR_NAMES`，但缺陷在
**另一个文件** `plugin/scripts/runtime-usage-inventory.ts`（NUL 哨兵 + 字面 `archive/` 判据不一致），
与本条的「绝对路径逐段匹配」是两回事。

**Why it is a mechanism defect, not a local annoyance.** 判别动作不是读 delta，而是拿同一条命令对着
两个 root 各跑一次比较载体数——这说明失败与**代码**无关，只与**检出的落点路径**有关。
⇒ 任何落在带禁名路径下的 worktree（尤其 Claude Code 的 `.claude/worktrees/`，它同时命中 `worktrees`
与 `.claude` 两个禁名）都会**静默**失灵；而失败形态（「已知样本找不到」）指向上游 carrier 漂移，
**指向错误的方向**。

**Fix direction（落笔方按实际代码定，不要照抄）.** 让跳过判定相对 `root` 求值（枚举本来就知道 `root`）；
即只有 `root` **之下**的段才参与匹配。修完必须同时保持：`root/node_modules/…` 仍被跳过（这是跳过集的
本意），而 `root` 的**祖先**路径中出现禁名**不**影响枚举。

## AC

- [x] AC1（能取假，点名枚举数量，⛔ 不是断言函数返回值）：造一个 fixture 根，其**祖先路径**含禁名段（例如 `.../worktrees/x/` 或 `.../.claude/w/`），该 fixture 下应被枚举的载体必须被枚举出来——断言 `listFiles()`/`--scan --json` 枚举出的**载体数量**等于同一 fixture 放在不含禁名祖先时枚举出的载体数量；把跳过判定改回按绝对路径求值 ⇒ 必须红。
- [x] AC2（负控制，另一半）：`root` **之下**名为 `node_modules`/`dist`/`vendor` 的目录**仍然**被跳过（改过头把跳过集废掉 ⇒ 红）——同一 fixture 下断言这些目录里的被枚举文件计数为 0。
- [x] AC3（无回归）：在本仓库真实 root 上 `registry-bare-filename-scan.ts --check` 仍 PASS，且 `--scan --json` 的 `carrierCount` 与修改前一致（实测 418 量级；⛔ 不写死数字，写成「与基线一致」并在实现时贴实测基线值）。
- [x] AC4（能取假，单测）：在 `plugin/test/registry-bare-filename-scan.test.mjs` 里断言「祖先含禁名段时载体数 == 不含时载体数」，把修复改掉 ⇒ 红。

## DoD

真实落地标准：修复落到 `plugin/scripts/registry-bare-filename-scan.ts` 后，**同一份检出**在**含禁名祖先段**的
落点（如 `.claude/worktrees/`）与常规落点（仓库外 `quay-worktrees/`）上 `--scan --json` 的 `carrierCount`
**一致**（贴两个真实读数，⛔ 不是只贴 fixture）；`--check` 在真实仓库根仍 PASS；AC2 的负控制
（root 之下 `node_modules`/`dist`/`vendor` 仍被跳过）与 AC4 的单测**双向都取假**。
⛔ 仅让「已知样本 canary」不再红、而枚举仍随落点路径变化，不算达成——那只是把症状挪走；
判据必须钉在**载体枚举数量**这个量上。

## Touches

- plugin/scripts/registry-bare-filename-scan.ts
- plugin/test/registry-bare-filename-scan.test.mjs
- tasks/gap-registry-scan-skip-predicate-matches-absolute-path.md
