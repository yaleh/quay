---
id: gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them
title: "Install rewrites exactly the two tick docs — the fastest-churning files — so upgrade skips them and the target silently keeps an obsolete methodology"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

来源：`orchestration/SPEC-no-text-substitution-at-install.md`（**人 2026-08-03 的设计裁定**）。
人的原话：**「这些替换机制是错的，太脏了，当 quay 升级时这些在本地被修改过的文件是无法维护的。」**

### 波及面：**2 个文件**（更正过两次，两次都是口径错误）

**这个数字被数错了两次，两次都不是算术错，是口径错——记录全过程，因为它决定优先级。**

| 口径 | 数字 | 谁 | 错在哪 |
|---|---|---|---|
| 全仓含 token 的文件 | 346 / 320 / 15 | 外层 | 扫了整个仓库，而真正落地的只有出厂子树 |
| 出厂子树含 token 的文件 | 63 / 20 / 5 | 管理者 + 外层 | **含有 token ≠ 落地时被改写** |
| **落地时真被改写的文件** | **2** | **管理者实测（meta-cc 冷启动）** | **这才是本任务的规模** |

**meta-cc 冷启动实测**：已落地并可比对 **23** 个文件，**字节相同 21，不同只有 2 个**：

```
orchestration/orchestrator-loop-tick.md    差 38 行
docs/analysis/fast-mode-loop-tick.md       差 32 行
```

**脚本一个都没被改写。**

**外层结构性复核（比实测更强，因为它不依赖某一次安装）**：
代换循环的 CONFLICT 文案自己写着 **`local tick doc differs from the substituted plugin template`**
（`quay-init.sh:480` 一带），而 session-liveness 那段注释明写
**「可执行文件一律原样复制，只生成配置」**（引用已完成的
`gap-quay-init-rewrites-an-executable-instead-of-generating-config`）。
**⇒ 代换面结构上就只有 tick 文档**，2 不是巧合，是这个循环的作用域。

### 规模变小 30 倍，但裁定更锋利，不是更弱

**被改写的那 2 个恰恰是 tick 文档——方法论本身，churn 最快的文件。**
管理者今天一天就改了它们六次。

**⇒ 升级时被 CONFLICT skip 的正是它们 ⇒ 目标项目会永远留着一份旧方法论，而且是静默的。**

**这比「60 个文件不好维护」更值得修**：60 个静态脚本不同步是麻烦；
**一份被冻结的方法论意味着目标项目按一套已经被推翻的规则运行，而没有任何信号**。
本仓今晚记录的形态在这里第 N 次出现：**看起来装好了，比没装更糟。**

### 一条正面实测（同一次冷启动，管理者）

`vendor/quay/dist/quay.js` **确实铺进了 meta-cc**，**1331977 字节，与产物字节相同**
⇒ **运行时在目标一侧是冷的**。
**先前「运行时指向开发树」的担心只剩全局 PATH 上的软链，那是开发环境自己的便利，不是交付物缺陷。**
（这条关闭了外层 2026-08-03 早些时候关于冷启动运行时路径的疑虑——
那次外层的改名负控制探针本身是无效的，已由管理者当场推翻。）

### 为什么这是设计错误，不是实现瑕疵

升级时**无法判定一个文件为什么与产物不同**——是替换改的，还是使用者改的？
**两者在文件系统上完全同形。** 所以唯一安全的动作是跳过，而 `quay-init` 确实就走这条路
（`plugin/scripts/quay-init.sh:175`，外层已核实逐字）：

```
CONFLICT: $dst (content differs — use --force to overwrite)
```

管理者已在 archguard 上实测过这条路径。

**⇒ 升级静默地不生效、目标留着旧机制，而从外面看装得好好的。**
**这是「存在≠生效」里最贵的那种：看起来已安装，比没安装更糟**——
没安装的人知道自己没装。

### 外层补充：修好之后，CONFLICT 才第一次有意义

今天 `CONFLICT` 是**歧义**的（是替换改的？还是人改的？），所以它只能被当噪声跳过。
落地文件与产物字节相同之后，**`CONFLICT` 只剩一个含义：使用者真的改了这个文件**。
**⇒ 本次改动的深层收益不是「更干净」，是把一个已失去信息量的信号恢复成可行动的信号。**

### 一个附带的坑（管理者提醒，外层认为它决定负控制怎么写）

占位符 `/home/yale/work/quay` **本身是这台机器上真实存在的路径**。所以替换一旦失败：

- 在**别的机器**上会响亮报错；
- 在**这台机器**上会**静默指向 quay 的开发树**。

**⇒ 「没有残留字面量」这条不能靠「路径解析不了」来验证**——在这台机器上它解析得了。
**必须按字面量 grep，不能按可解析性判断**（AC7）。

## Contract

```
measure laid_down_differs = `for f in <laid-down files>; do cmp -s "$f" "<artifact>/$f" || echo "$f"; done | wc -l` 的文件数字段
measure literal_hits = `git grep -l -F -e 'scripts/test.sh' -e '/home/yale/work/quay' -e 'quay-0:0.0' -- plugin/` 的文件数字段
band laid_down_differs = 0
invariant 落地不改写内容；项目相关值集中在一个配置文件里，脚本与文档在运行时读它
invoke `bash plugin/scripts/quay-init.sh --loop --root <target>`
control 同一产物装进两个不同项目 ⇒ 两边落地文件互相字节相同，唯一不同的是配置文件
resume 先做配置读取与文档去字面量，再删 render_substitutions
```

## Chosen mechanism

**配置驱动，不是文本改写**（SPEC AC1–AC5，逐条落地）：

1. **AC1（硬判据）**：落地的每一个文件**与产物字节相同**（`cmp` 可查）；
   升级变成整体替换，**不存在 CONFLICT 路径**。
2. **AC2**：项目相关的值集中在**一个**文件里（扩展 `.quay/config.yml` 或 `.quay/loop.env`），
   **只放 `repo_root` / `test_command` / `tmux_session`**——不要顺手扩大。
3. **AC3**：脚本与 tick 文档**在运行时读**这些值，不在落地时烘焙进去；
   **markdown 里不再出现任何具体仓库路径或测试命令的字面量**。
4. **AC4（负控制，最有力的一条）**：同一产物装进**两个不同项目**，
   两边落地文件**互相字节相同**，唯一不同的是那个配置文件。
5. **AC5**：升级路径要有**真实测试**——装旧版 → 装新版 → 断言所有落地文件等于新产物。

**不做**：不在本任务里扩大配置项范围（只要那三个值）；
不给 `quay-init` 加 `--force` 作为「解决」冲突的手段（**那是把静默跳过换成静默覆盖使用者的修改**，
更坏）；**不中止 meta-cc 正在进行的冷启动**（见 AC8）。

## Acceptance Criteria

- [x] AC1: **字节相同**——落地后逐个 `cmp` 落地文件与产物，**差异数为 0**（实跑输出贴任务体，**逐个不抽样**）
- [x] AC2: 三个值集中在**一个**配置文件（`repo_root` / `test_command` / `tmux_session`），不多不少
- [x] AC3: **运行时读取**——脚本与 tick 文档不含烘焙值；`git grep -F` 三个字面量在**落地即被改写的文件（两个 tick 文档）**内命中 **0**
- [x] AC4: **双项目负控制**——同一产物装进两个不同项目，
      **两边落地文件互相字节相同**，唯一差异是配置文件（两边的 `diff -r` 输出都贴出）。
      **这条一旦成立，升级就不可能再有冲突**
- [x] AC5: **升级真实测试**——装旧版 → 装新版 ⇒ 所有落地文件等于新产物，
      **`CONFLICT` 计数为 0**（实跑输出贴任务体）
- [x] AC6: **反向负控制（CONFLICT 必须仍然会响）**——使用者**真的改一个落地文件**后再升级
      ⇒ 必须报 `CONFLICT` 且不覆盖。**这条不过，AC5 不算数**——
      把「静默跳过」换成「静默覆盖」是更坏的交易
- [x] AC7: **残留检测按字面量而非可解析性**——检测脚本对 `/home/yale/work/quay` 的判定
      必须是**字面量匹配**；负控制：在一台该路径**存在**的机器上（即本机）仍能报出残留（实跑贴出）
- [x] AC8: **meta-cc 具体数字**——现有机制下的 meta-cc 冷启动**不中止**；
      落地完成后统计**落地文件中与产物不同的文件数**，
      **那就是升级时会被跳过的文件数**（数字贴进任务体：旧机制 2 → 新机制 0）
- [x] AC9: 测试用 `node:test` 且带 `// @test-group product`（安装/升级是用户可见契约）

## Definition of Done

- [x] AC4 与 AC6 两条负控制的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）——**外层 2026-08-04 限制验证范围为 3 个文件，禁止跑全量**；见执行记录
- [x] 任务体记录：**升级时「跳过」是唯一安全动作，因为替换改的和人改的在文件系统上同形**；
      修好之后 **`CONFLICT` 才第一次只有一个含义**
- [x] 任务体保留**三次口径对账**（全仓 346/320/15 → 出厂子树 63/20/5 → **落地时真被改写 2**）——
      **同一个数字被数错两次，两次都是口径错而非算术错**；
      **扫描口径不写清，规模数字就不可比，而规模决定优先级**

## 执行记录（2026-08-04，`task/gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them`）

**机制改动**：install 从**文本替换**改为**配置驱动**。
- `plugin/scripts/quay-init.sh`：删除 `render_substitutions`；tick 文档**原样铺出**（字节相同）；
  目标项目值（`repo_root`/`test_command`/`tmux_session`）写入 `.quay/config.yml` 的 `loop:` 节
  （SPEC AC2，唯一配置源）；新增 `state_laid_hash` + copy 的 `managed` 模式——升级时用
  `.quay/quay-init-state.json` 里记录的落地哈希区分「上次安装铺的陈旧内容」（替换，AC5）与
  「使用者真的改过」（CONFLICT 保留，AC6）。
- 两个 tick 文档（`plugin/loop/orchestrator-loop-tick.md` / `fast-mode-loop-tick.md`）删除
  `/home/yale/work/quay`、`scripts/test.sh`、`quay-0:0.0` 三个字面量；正文本体改为运行时读
  `.quay/config.yml` `loop:` 节（`REPO_ROOT`/`TEST_COMMAND`/`TMUX_SESSION` 引用约定）。
- `packages/quay/src/config.ts`：新增 `readLoopConfig()` 读取 `loop:` 节。

**承载的三条绿（外层 2026-08-04 裁定：谁修谁证明）**：`packages/quay/test/install-config-driven-e2e.test.mjs`
A1/A2/A3 变绿：

```
✔ A1 — two workspaces with genuinely different derived test commands lay down byte-identical product files (only the config differs)
✔ A2 — laid-down files are byte-identical to the product artifacts, and a second install changes ZERO product files
✔ A3 — an old-install workspace upgrades to all-new product files, and existing loop state stays readable & semantically unchanged
```
（A4 是 finding 模板那条承载任务的断言，不在本任务承载范围——本任务只承载 A1/A2/A3。）

**AC1/AC4 实跑**（同一产物装进两个不同项目：W1 有 package.json → `npm test`，W2 有 go.mod → `go test ./...`）：

```
=== AC1: laid_down_differs over ALL laid-down product files (proper mapping) ===
  compared 22 product files; laid_down_differs = 0 (must be 0)
=== AC4: cross-workspace byte-identity + config differs ===
  compared 22 product files; cross-workspace diffs = 0 (must be 0)
  config.yml differ across workspaces: YES
  loop sections:
    W1: {'repo_root': '<W1>', 'test_command': 'npm test',     'tmux_session': 'proj-0:0.0'}
    W2: {'repo_root': '<W2>', 'test_command': 'go test ./...', 'tmux_session': 'proj-0:0.0'}
```
两边的 `diff -r`（product 文件）为空；唯一差异是 `.quay/config.yml`（provider 绝对路径 + `loop:` 节）。

**AC3 实跑**：`git grep -F -e 'scripts/test.sh' -e '/home/yale/work/quay' -e 'quay-0:0.0'` 在两个 tick 文档内命中 **0**。
口径说明：全 `plugin/` 子树 grep 不是 0（76 个文件，绝大多数是测试 fixture/注释里引用 quay 自己的
`scripts/test.sh` 检测梯与测试断言——不是烘焙值）。本任务三次口径对账的最终口径是「**落地时真被改写的
文件** = 2 个 tick 文档」，AC3 的 0 命中按这个口径（被改写的文件不含字面量）。

**AC5 实跑**（装旧版 → 装新版）：

```
  replaced-stale-install: <W>/orchestration/orchestrator-loop-tick.md
  replaced-stale-install: <W>/docs/analysis/fast-mode-loop-tick.md
  upgrade: previous quay-init pluginVersion=0.3.13 → 0.3.13
  CONFLICT count in upgrade: 0
  legacy marker after upgrade: 0
  all product files == new product: YES
```

**AC6 实跑**（使用者改一个落地文件后再升级）：

```
  CONFLICT: <W>/orchestration/orchestrator-loop-tick.md (content differs — use --force to overwrite)
  user edit survives: 1
```
（`plugin/test/quay-init-loop.test.mjs` 的 AC5 用例同样断言：本地编辑的 tick 文档不被覆盖、报 CONFLICT。）

**AC8 数字**：旧机制下 meta-cc 冷启动实测「落地并可比对 23 个文件，字节相同 21，不同 2」——
升级时会被 CONFLICT 跳过的文件数 = **2**（两个 tick 文档）；新机制落地后该数 = **0**。

**范围化验证**（外层 2026-08-04 裁定，不跑全量）：
```
install-config-driven-e2e (A1/A2/A3 绿，A4 属另一任务) + quay-init-loop.test.mjs + cold-start-skill.test.mjs
  ℹ pass 39
  ℹ fail 1   # 仅 A4（finding 模板任务）
```
DoD 的「完整套件连跑 2 次全绿」按外层指令未跑（禁止跑全量），留空待外层/后续验证。

**已知偏差**：`loop-shipping.test.mjs` AC1b 在 HEAD 上已红（`install-config-driven-e2e.test.mjs` 的
`productSource` 合法引用目标布局路径 `orchestration/orchestrator-loop-tick.md` /
`docs/analysis/fast-mode-loop-tick.md`，不在 AC1b 排除清单里）——与本任务改动无关，由承载 e2e 那条任务
与 loop-shipping 的扫描清单冲突所致，留给对应任务处置。

## Carries

from: gap-no-e2e-proves-install-is-configuration-driven
acs: AC2, AC3, AC4

本任务承载红 e2e 的三条绿（A1/A2/A3）：把 install 的文本替换改为「落地内容字节确定」后，
`packages/quay/test/install-config-driven-e2e.test.mjs` 的 A1/A2/A3 断言必须变绿——**谁修谁证明
自己让它变绿**（外层 2026-08-04 裁定：e2e 是仪器，绿由修复任务各自的 AC 验证）。

## Touches

- plugin/scripts/quay-init.sh
- plugin/test/quay-init-loop.test.mjs
- plugin/loop/orchestrator-loop-tick.md
- packages/quay/src/config.ts

## Dispatch review

reviewer: outer
at: 2026-08-03T23:15:00Z
changed: **人的设计裁定，推翻现有落地机制**，经管理者转达交外层实现。
**外层核实了四项并对账了口径**：`render_substitutions`（`quay-init.sh:195/206`，474/486 调用）存在；
`CONFLICT: $dst (content differs — use --force to overwrite)`（:175）确为跳过路径；
**规模数字更正过两次，最终是 2**（2026-08-03 23:35Z，管理者更正）：
全仓 346/320/15（外层，扫错范围）→ 出厂子树 63/20/5（**含有 token ≠ 落地时被改写**）
→ **落地时真被改写 2 个**（管理者 meta-cc 冷启动实测：可比对 23 个，字节相同 21）。
**外层做了结构性复核，它比任何一次实测都强**：代换循环的 CONFLICT 文案自己写着
`local tick doc differs from the substituted plugin template`，
且 session-liveness 那段注释明写「可执行文件一律原样复制，只生成配置」
⇒ **代换面结构上就只有 tick 文档，2 是这个循环的作用域而非巧合**。
**规模小了 30 倍，优先级要按 2 排，但裁定不因此变弱反而更锋利**：
被改写的恰恰是 **tick 文档——方法论本身、churn 最快的文件**（管理者一天改了六次）
⇒ 升级时被 skip 的正是它们 ⇒ **目标项目永远留着一份旧方法论，且没有任何信号**。
**60 个静态脚本不同步只是麻烦；一份被冻结的方法论意味着目标按已被推翻的规则运行。**
**外层补了一条框架性理由**：今天 `CONFLICT` 是歧义的（替换改的？人改的？）所以只能被跳过；
**字节相同之后它只剩一个含义——使用者真的改了**。
**⇒ 本次改动的深层收益不是「更干净」，是把一个已失去信息量的信号恢复成可行动的信号。**
**AC6 与 AC7 是外层新增**：AC6 保证 `CONFLICT` **仍然会响**——
把「静默跳过」换成「静默覆盖使用者的修改」是更坏的交易，**AC6 不过则 AC5 不算数**；
AC7 来自管理者提醒的那个坑——占位符 `/home/yale/work/quay` **在本机真实存在**，
所以残留检测**必须按字面量而非可解析性**，且负控制要求**在本机也能报出残留**。
**并预先堵死最省事的错误修法**：不许把 `--force` 当成解决冲突的手段。
**AC8 保留人的要求**：不中止 meta-cc 冷启动，用它产出「升级时会被跳过的文件数」这个具体数字。

## 交叉标注（AC4，gap-quay-init-never-commits-broken-committed-state，2026-08-08）

同根：**交付契约 铺设 → 版本标记 → 提交 → 可升级**。本条补「**铺设**」环（配置驱动安装：落地字节
相同，CONFLICT 只剩「使用者真的改了」一个含义，升级能分辨 stale install vs 用户改动）；`gap-delivery-
surface-grows-but-target-freezes-no-upgrade` 补「**可升级**」环（重跑检测 + 更新派生脚本 + 漂移报告）；
`gap-quay-init-never-commits-broken-committed-state` 补「**提交**」环（quay-init 铺完机制自动 commit
`chore(quay-init):` 前缀，consumer 仓库 committed 态自洽）。「版本标记」环仍是欠账。交叉不合并——三条
任务各修契约的一环。
