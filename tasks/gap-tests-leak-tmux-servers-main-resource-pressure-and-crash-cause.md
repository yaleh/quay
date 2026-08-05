---
id: gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause
title: "tests LEAK tmux servers — the MAIN resource pressure and very likely the
  three-crash cause (manager found + cleared 217, oldest 12h): all from
  plugin/test/send-keys-verified.test.mjs's skv-ok sessions — isolation design
  is RIGHT (each leaks a TMUX_TMPDIR=/tmp/skv-XXXXXX/sock, never touches default
  socket, NOT the 'kill-through-isolation' class of crash #3) but tests never
  kill the servers they spawn, and tonight's dozens of full-suite runs left a
  fresh batch each round; PSI cpu avg10 94.18 → 31.47, gate WAIT→GO, tmux
  servers 217 → 10 after cleanup — THIS is the main resource pressure, NOT
  laneCount and NOT the other two projects (manager's earlier attributions both
  incomplete); 9 residual leaks remain (8 /tmp/session-liveness-*/sock oldest
  16h53m + 1 /tmp/enter-repro-79bc/sock) left for inner judgment (a mounted
  observer pid 2598198 may use one); fix is a CLASS not one file: tests that
  spawn external processes/servers must reclaim them in teardown (same family as
  gap-tests-never-clean-up-their-tmpdirs); mechanically checkable: after a test
  run NO tmux server or /tmp dir carrying the test's characteristic prefix
  (skv-/session-liveness-/enter-repro-) may remain — the assertion goes at the
  END of the suite covering the whole class at once; reconsider: ① three-crash
  root cause now has a concrete mechanism (accumulate over time → load spikes
  before crash) where load was an unexcluded candidate; ② the 07:26 resource
  ABORT and 07:50 cross-project pause were both right decisions with incomplete
  attribution; ③ gate is GO now, M3 validation suite can run"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者（2026-08-05）——**找到并已清除一个真实资源泄漏，很可能就是三次崩溃的成因**。立案为最高
优先级的测试卫生缺陷。

**【发现】系统里有 217 个 tmux server 进程，最老的已跑 12 小时**。全部来自
`plugin/test/send-keys-verified.test.mjs` 创建的会话 `skv-ok`。

- **隔离设计是对的，缺的是清理**：每个泄漏 server 都有自己的 `TMUX_TMPDIR=/tmp/skv-XXXXXX/sock`，
  从不碰默认 socket——**不是第三次崩溃那种「杀穿隔离」的问题**，那部分设计正确；
- **问题是测试跑完从不 kill 自己起的 server**，而今晚全套件跑了几十轮，每轮都留下一批。

**【已清理，过程与安全措施】**：按 PID 逐个 `kill -TERM`，只杀 TMUX_TMPDIR 匹配 `/tmp/skv-*` 的，
**绝不用 `tmux kill-server`**（第三次崩溃就是那条路径）；执行前显式校验默认 server pid 2591128 不在
待杀名单里。结果：207 个已清除，quay-0 / meta-cc-3 / archguard-4 三个会话全部存活。

**【效果，这是关键证据】PSI cpu avg10 从 94.18 降到 31.47，resource-gate.sh --for full-suite 从
WAIT 转 GO，tmux server 从 217 降到 10。⇒ 这个泄漏是当前资源压力的主要来源，不是 laneCount，也不是
另外两个项目。** 管理者之前把主因归给 laneCount、又归给 meta-cc/archguard，两次都不完整。

**【残留 9 个也是泄漏，先没动，请一并立案】**：`/tmp/session-liveness-*/sock` 8 个（最老 16 小时
53 分）+ `/tmp/enter-repro-79bc/sock` 1 个，来自 session-liveness 相关测试。数量小、且不确定挂载中的
观察者（pid 2598198）是否用着其中之一，**留给内层判断后再清**。

**【更正 2026-08-05 08:55Z——范围更大 + 外层措辞误导】**
1. **泄漏源不止 session-liveness**：管理者 08:52 数到 **12 个**带隔离 TMUX_TMPDIR 的 tmux server 还
   活着，最老 `session-liveness-l4SQh4/sock` **17h52m**；最新 4 分钟那个来自 **`ol-tok`**（heavy-op-
   token 测试夹具），非 session-liveness 系列。⇒ **多个测试夹具共有的 teardown 缺失**，和 skv-ok 同族。
2. **外层 08:48 措辞误导**：写「清理 10 个残留泄漏」——实际清的是 **/tmp 目录**（session-liveness-*
   9 + enter-repro 1），**不是 tmux server 进程**（17h 老的进程 socket 目录被删但进程没被杀）。措辞
   会被后续 tick 误当「已解决」。**管理者已补杀 12 个进程**（12+1→1，只剩默认 server），三会话存活。
3. **管理者自我更正**：07:5x 的「先不动 9 个 session-liveness server」顾虑是多余的——观察者 2598198
   的 environ **没有 TMUX_TMPDIR**，从不使用那些隔离 socket；那 9 个当时可安全清掉，保守间接让它们
   活到了 ABORT #3。**记在管理者头上**。
4. **判据形态确认**：套件尾部断言前缀扩展为 `skv-` / `session-liveness-` / `ol-tok-` / `enter-repro-`。

### 选定机制（外层裁定：立案，最高优先级测试卫生）

1. **一整类，不只修一个文件**——测试起了外部进程/服务器却不在 teardown 里回收。
   **同族任务**：`gap-tests-never-clean-up-their-tmpdirs`。交叉标注。
2. **机械断言放套件尾部**——测试跑完后系统里不应残留任何带该测试特征前缀（`skv-` /
   `session-liveness-` / `enter-repro-`）的 tmux server 或 /tmp 目录；**一次覆盖全类**。
3. **修复**：send-keys-verified.test.mjs 的 teardown 必须 kill 自己起的 server（带 TMUX_TMPDIR
   校验，绝不用 tmux kill-server）；session-liveness / enter-repro 相关测试同理。
4. **重估（连带）**：
   - 三次崩溃根因现在有具体机制（随测试轮数累积 → 崩溃前负载飙升），此前负载是未排除候选；
   - 07:26 资源 ABORT、07:50 跨项目暂停：两个决定当时都对，但归因都不完整；
   - 资源门现 GO，M3 验证套件可跑（但 laneCount 显式传参传播 AC16 仍未修——重跑须临时手段）。

### 精确根因 + 修法优先级（2026-08-05 09:2xZ，管理者源码验证）

**根因（比「teardown 缺失」更精确，也更易修）**：`send-keys-verified.test.mjs` 的
`newHermetic().cleanup()`（55-67 行）只 `fs.rmSync(tmp, {recursive,force})`——删掉临时目录（含
socket 路径），**全文件零处调用 `tmux kill-server`/`kill-session`**（grep kill 命中数=0）。**删目录
≠ 杀进程**：由 `tmux new-session -d -s S bash` 起的 server，socket 文件被删后仍作为孤儿进程活着——
正是今晚两波泄漏（TMUX_TMPDIR=/tmp/skv-*/sock 存在但目录早已不在）。

**范围更窄（好事）**：同族用 isolateTmuxEnv/newHermetic 模式的有 quay-init-tmux-detection.test.mjs
（8 处 new-session、4 处 kill）与 session-liveness.test.mjs（6 处 new-session、3 处 kill）——**两者都
有 kill 调用**，只有 send-keys-verified.test.mjs 是**零**。⇒ 不是整族缺 teardown，是**这一个文件的
这一个 helper 缺一行**。本文件真正起 server 的测试是 104 行（skv-noecho）与 121 行（skv-ok）——对应
两波不同前缀的泄漏。

---

## ⚠️ 管理者撤回声明（2026-08-05 09:2xZ，第四次崩溃后重写）

**本节以下的修法在 09:17Z 版本里写的是「加一行 `tmux(['kill-server'], env)`」，并标注
「管理者验证 TMUX_TMPDIR 隔离对 kill-server 同样有效」。这句话是错的，现予撤回。**

**撤回依据（实测，代价是第四次全灭）**：管理者去实测该断言时，把测试拆成两次独立
Bash 调用，`export ISO_TMPDIR=...` 在第二次调用里已丢失（工具本身文档写明 shell 状态
不跨调用保留）。于是 `sockDir=undefined` → `TMUX_TMPDIR` 这个 key 被 Node 丢弃 → 又主动
`delete env.TMUX` → **既无 `-S`/`-L`、无 `$TMUX`、也无 `TMUX_TMPDIR`** → `tmux kill-server`
落到**默认 socket**，杀掉 quay-0 / meta-cc-3 / archguard-4 全部会话
（outer pid 2600919、inner 2600928、默认 server 2591128 全部死亡，实测确认）。

**结论：`kill-server` 的危险不在于「隔离写法对不对」，而在于它的爆炸半径由环境决定，
而环境可以静默丢失。** 一旦丢失，失败模式不是报错，是**清空整台机器的 tmux**。

**仓库内已有正确写法可直接照抄**（读码实测，非推断）：

| 文件 | 写法 | 爆炸半径 |
|---|---|---|
| `session-liveness.test.mjs` | `tmux(["kill-session", "-t", session], env)` ×3 | 只杀指名会话 |
| `quay-init-tmux-detection.test.mjs` | `tmux(['kill-server'], env)` ×4 | **整个 server（同类风险，已埋在生产代码里）** |

三个文件的 `-S` 用法**均为 0 处**——全部靠环境变量选 socket，即全部依赖运气而非机制。

---

## 修法（撤回后的安全版本）

- **① 立即修（优先）**：`cleanup()` 里 `rmSync` 之前，对本 helper 起过的会话逐个
  **`tmux(["kill-session", "-t", <会话名>], env)`**——本文件会话名是已知常量
  （`skv-ok`、`skv-noecho`）。最坏情况是「杀一个不存在的会话」→ 报错，
  **不可能清空默认 socket**。最后一个会话被杀后 server 自行退出，达到同样的回收效果。
- **②【新增，同等优先】把 `quay-init-tmux-detection.test.mjs` 现有 4 处 `kill-server`
  一并改成 `kill-session -t <名>`**——那 4 处是**已经存在于生产代码中的同类风险**，
  今晚没炸只是因为环境变量一直没丢。
- **③【机制性收窄，建议】socket 选择改用 `-S <显式路径>` 而非 `TMUX_TMPDIR` 环境变量**：
  `-S` 是命令行参数，丢失会报错而非回退默认 socket。这是把「依赖运气」变成「机制保证」
  的关键一步（`-S`/`-L` > `$TMUX` > `TMUX_TMPDIR` 的优先级今晚已实测确认）。
- **④ 减少起 server 的必要性**：`send-keys-verified.test.mjs` 四个测试里只有两个
  （104 行 `stty -echo`、121 行「送达真的落地」）**必须**要真 pane；
  另两个（用法错误、目标不存在）不需要活会话。
- **⑤ 套件尾部残留断言（第二道防线）**：仍值得做，但是防未来同类文件的兜底，不是唯一手段。

## Acceptance Criteria

- [ ] AC1: **套件尾部断言**——测试跑完后无 `skv-` / `session-liveness-` / `ol-tok-` / `enter-repro-`
      前缀的 tmux server 或 /tmp 目录残留（机械检查，一次覆盖全类）
- [ ] AC2: **teardown 回收——用 `kill-session -t <名>`，禁止 `kill-server`**（2026-08-05 撤回重写，
      见上方「管理者撤回声明」）。`send-keys-verified.test.mjs` 的 `newHermetic().cleanup()` 在
      `rmSync` 前，对本文件已知会话名逐个 `tmux(["kill-session","-t", "skv-ok"|"skv-noecho"], env)`。
      **判据（负控制，必须实跑）**：故意把 `env` 的 socket 选择弄空（模拟环境变量丢失），
      该 cleanup 必须**报错或无害**，且 `tmux list-sessions` 显示真实会话**未受影响**——
      这条负控制正是 09:2xZ 第四次全灭暴露的失败形态，不做它就等于没验
- [ ] AC2b: **同类风险一并消除**——`quay-init-tmux-detection.test.mjs` 现有 **4 处**
      `tmux(['kill-server'], env)` 改为 `kill-session -t <名>`。理由：那 4 处与被撤回的建议是
      同一形态，**已埋在生产代码里**，今晚未炸仅因环境变量未丢
- [ ] AC2c: **机制性收窄（建议，非阻塞）**——socket 选择从 `TMUX_TMPDIR` 环境变量改为
      `-S <显式路径>` 参数（三个文件当前 `-S` 用法均为 0）。参数丢失会报错，环境变量丢失会
      静默回退默认 socket——今晚全灭的机制根
- [ ] AC3: **残留清理**——8 个 session-liveness-* + 1 个 enter-repro 泄漏在判断后清除（先确认挂载
      观察者 pid 2598198 未用，再清）
- [ ] AC4: **回归控制**——217 泄漏形态不再复现：连续多轮套件后 server 数稳定（不随轮数累积）；
      实测输出贴任务体
- [ ] AC5: **与 gap-tests-never-clean-up-their-tmpdirs 交叉标注**——同一族（测试起外部资源不回收）
- [ ] AC6: **崩溃根因关联**——三次崩溃调查记录补「tmux 泄漏累积」为具体机制（负载飙升候选获解释），
      此前无定论
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group engine`（沿用测试卫生族声明）

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC4 实跑输出贴任务体（多轮后 server 数稳定）
- [ ] 测试起外部进程/服务器必在 teardown 回收；套件尾部断言在；泄漏不再累积
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/test/send-keys-verified.test.mjs（teardown kill 自己起的 server，TMUX_TMPDIR 校验）
- plugin/test/heavy-op-token*.test.mjs（ol-tok 泄漏源，同族 teardown）
- plugin/test/session-liveness.test.mjs（同族 teardown）
- plugin/scripts/（套件尾部泄漏断言：skv-/session-liveness-/enter-repro- 前缀扫描）
- scripts/test.sh（套件尾部挂泄漏断言，若并入）
- tasks/gap-tests-never-clean-up-their-tmpdirs.md（AC5 交叉标注）
- orchestration/（三次崩溃根因调查记录补 AC6 关联）

## Contract

measure   leaked_servers = `ls -d /tmp/skv-* /tmp/session-liveness-* /tmp/enter-repro-* 2>/dev/null | wc -l` stdout 的数字段
band      leaked_servers = 0（套件跑完后无测试特征前缀的残留 server/目录）
invariant teardown_reclaims_spawns = 1（测试起的 server 必在 teardown kill，带 TMUX_TMPDIR 校验）
invoke    `grep -n "kill\|teardown\|TMUX_TMPDIR\|skv" plugin/test/send-keys-verified.test.mjs`
control   构造测试起 server 不回收 ⇒ 套件尾部断言抓住（AC1）；修复后多轮套件 server 数稳定（AC4）
resume    套件尾部断言与 teardown 修复分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T08:1xZ
changed: 外层受管理者资源泄漏发现裁定立案（最高优先级测试卫生）。四处收紧：
(1) **主因更正**——tmux 泄漏是当前资源压力主要来源（PSI 94→31、gate WAIT→GO、server 217→10），
    非 laneCount、非另外两项目（管理者两次归因不完整，已记录）；
(2) **一整类**——不只修 send-keys-verified，套件尾部机械断言一次覆盖全类（skv-/session-liveness-/
    enter-repro- 前缀）；
(3) **残留 9 个留内层判断**——挂载观察者 pid 2598198 可能用其一，先确认再清；
(4) **崩溃根因关联**——三次崩溃获具体机制（随轮数累积 → 崩溃前负载飙升）。
status: todo——测试泄漏主因；最高优先，与 OS-anchor / laneCount 并列前排。
