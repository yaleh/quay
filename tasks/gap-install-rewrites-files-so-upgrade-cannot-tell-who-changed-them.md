---
id: gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them
title: "Install rewrites exactly the two tick docs — the fastest-churning files — so upgrade skips them and the target silently keeps an obsolete methodology"
status: todo
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

- [ ] AC1: **字节相同**——落地后逐个 `cmp` 落地文件与产物，**差异数为 0**（实跑输出贴任务体，**逐个不抽样**）
- [ ] AC2: 三个值集中在**一个**配置文件（`repo_root` / `test_command` / `tmux_session`），不多不少
- [ ] AC3: **运行时读取**——脚本与 tick 文档不含烘焙值；`git grep -F` 三个字面量在出厂子树内命中 **0**
- [ ] AC4: **双项目负控制**——同一产物装进两个不同项目，
      **两边落地文件互相字节相同**，唯一差异是配置文件（两边的 `diff -r` 输出都贴出）。
      **这条一旦成立，升级就不可能再有冲突**
- [ ] AC5: **升级真实测试**——装旧版 → 装新版 ⇒ 所有落地文件等于新产物，
      **`CONFLICT` 计数为 0**（实跑输出贴任务体）
- [ ] AC6: **反向负控制（CONFLICT 必须仍然会响）**——使用者**真的改一个落地文件**后再升级
      ⇒ 必须报 `CONFLICT` 且不覆盖。**这条不过，AC5 不算数**——
      把「静默跳过」换成「静默覆盖」是更坏的交易
- [ ] AC7: **残留检测按字面量而非可解析性**——检测脚本对 `/home/yale/work/quay` 的判定
      必须是**字面量匹配**；负控制：在一台该路径**存在**的机器上（即本机）仍能报出残留（实跑贴出）
- [ ] AC8: **meta-cc 具体数字**——现有机制下的 meta-cc 冷启动**不中止**；
      落地完成后统计**落地文件中与产物不同的文件数**，
      **那就是升级时会被跳过的文件数**（数字贴进任务体）
- [ ] AC9: 测试用 `node:test` 且带 `// @test-group product`（安装/升级是用户可见契约）

## Definition of Done

- [ ] AC4 与 AC6 两条负控制的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**升级时「跳过」是唯一安全动作，因为替换改的和人改的在文件系统上同形**；
      修好之后 **`CONFLICT` 才第一次只有一个含义**
- [ ] 任务体保留**三次口径对账**（全仓 346/320/15 → 出厂子树 63/20/5 → **落地时真被改写 2**）——
      **同一个数字被数错两次，两次都是口径错而非算术错**；
      **扫描口径不写清，规模数字就不可比，而规模决定优先级**

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
出厂子树内字面量 **63 / 20 / 5**，与管理者一致。
**口径对账是外层这次的主要贡献之一**：外层第一次按全仓扫得 346/320/15，
与管理者的数字相差极大——**因为真正会被落地的只有出厂子树**；
不写清口径，下一个人会「复核」出管理者报错了的结论。
**外层补了一条框架性理由**：今天 `CONFLICT` 是歧义的（替换改的？人改的？）所以只能被跳过；
**字节相同之后它只剩一个含义——使用者真的改了**。
**⇒ 本次改动的深层收益不是「更干净」，是把一个已失去信息量的信号恢复成可行动的信号。**
**AC6 与 AC7 是外层新增**：AC6 保证 `CONFLICT` **仍然会响**——
把「静默跳过」换成「静默覆盖使用者的修改」是更坏的交易，**AC6 不过则 AC5 不算数**；
AC7 来自管理者提醒的那个坑——占位符 `/home/yale/work/quay` **在本机真实存在**，
所以残留检测**必须按字面量而非可解析性**，且负控制要求**在本机也能报出残留**。
**并预先堵死最省事的错误修法**：不许把 `--force` 当成解决冲突的手段。
**AC8 保留人的要求**：不中止 meta-cc 冷启动，用它产出「升级时会被跳过的文件数」这个具体数字。
