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
status: done
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

- [x] AC1: **套件尾部断言**——测试跑完后无测试特征前缀的 tmux server 或 /tmp 目录残留（机械检查，一次覆盖全类）。
      前缀 = session 名锚定 `skv-|ol-|topo-|isc-|sb-|enter-repro-`（进程）+ /tmp `skv-|session-liveness-|ol-prod-|
      enter-repro-|quay-sb-|quay-topo-|quay-isc-|quay-init-tmux-`（目录）——2026-08-07 扩展覆盖跨主机族（见执行证据 ⑦）
      → `plugin/scripts/tmux-leak-scan.sh`（`pgrep -a tmux` + `ls -d /tmp/<前缀>*` 快照扫描，绝不调用 tmux）
      已接入 `scripts/test.sh` 的全量套件尾部（heavy-op 分支，assert-clean-tree 后）——与 assert-clean-tree
      同一模式：只在串行化的全量默认路径跑（scoped 并行 worktree 的瞬态 fixture 会造成跨 worktree 假阳性，
      与 assert-clean-tree 跳过 scoped 同理）。scoped 验证由任务方按 dispatch 手动 `pgrep`/scan。
- [x] AC2: **teardown 回收——用 `kill-session -t <名>`，禁止 `kill-server`**（2026-08-05 撤回重写，
      见上方「管理者撤回声明」）。`send-keys-verified.test.mjs` 的 `newHermetic().cleanup()` 在
      `rmSync` 前，对本文件已知会话名逐个 `tmux(["kill-session","-t", "skv-ok"|"skv-noecho"], env)`。
      **判据（负控制，必须实跑）**：故意把 `env` 的 socket 选择弄空（模拟环境变量丢失），
      该 cleanup 必须**报错或无害**，且 `tmux list-sessions` 显示真实会话**未受影响**——
      这条负控制正是 09:2xZ 第四次全灭暴露的失败形态，不做它就等于没验
      → 负控制已作为 send-keys-verified.test.mjs 的第 5 个测试实跑通过（见下方执行证据），
      cleanup 用 `-S <显式 socket>` + `kill-session`，最坏（-S 也丢）落到默认 socket 也只能报「no such session」。
- [x] AC2b: **同类风险一并消除**——`quay-init-tmux-detection.test.mjs` 现有 **4 处**
      `tmux(['kill-server'], env)` 改为 `kill-session -t <名>`。理由：那 4 处与被撤回的建议是
      同一形态，**已埋在生产代码里**，今晚未炸仅因环境变量未丢
      → 4 处全部改为 `tmuxAt(socketPathFor(sockDir), ['kill-session', '-t', <名>], env)`（每测试建的会话逐个杀）。
- [x] AC2c: **机制性收窄（建议，非阻塞）**——socket 选择从 `TMUX_TMPDIR` 环境变量改为
      `-S <显式路径>` 参数（三个文件当前 `-S` 用法均为 0）。参数丢失会报错，环境变量丢失会
      静默回退默认 socket——今晚全灭的机制根
      → send-keys-verified 全部直接 tmux 调用与 cleanup 走 `-S <sockPath>`（helper 脚本 env 契约解析到同一 socket）；
      quay-init-tmux-detection 的 kill 调用走 `-S`。session-liveness 的 makeHermeticProbe 本就 kill-session（env 契约，
      -S 不适用，注释已说明）。测试断言「-S 丢失 ⇒ 报错而非回退默认」在负控制里覆盖。
- [x] AC3: **残留清理**——8 个 session-liveness-* + 1 个 enter-repro 泄漏在判断后清除（先确认挂载
      观察者 pid 2598198 未用，再清）
      → 已核实：挂载观察者 pid 2598198 已不在；`/tmp/enter-repro-*` 无残留；管理者清的 8 个 session-liveness
      已不在。另发现并清掉今日新产生的孤儿残留（2 个 session-liveness-* 目录、`/tmp/skv-exp`、
      `/tmp/quay-init-tmux-Fufu1c`、`/tmp/ol-prod-tAZds5`，及一个 `ac2bproj-0` 孤儿 server——用 kill-session 按
      实际 socket 杀），每个先核实无活 server 再动；真实会话 quay-0 全程未受影响。
- [x] AC4: **回归控制**——217 泄漏形态不再复现：连续多轮套件后 server 数稳定（不随轮数累积）；
      实测输出贴任务体
      → 3 轮 send-keys-verified + quay-init-tmux-detection 实测：每轮后 tmux server 数恒为 2（真实 quay-0 对）、
      泄漏前缀进程 0、/tmp 泄漏目录 0、`tmux-leak-scan.sh` 每轮 CLEAN。见下方执行证据。
- [x] AC5: **与 gap-tests-never-clean-up-their-tmpdirs 交叉标注**——同一族（测试起外部资源不回收）
      → 已在 `tasks/gap-tests-never-clean-up-their-tmpdirs.md` 加「交叉标注（2026-08-05，AC5）」节。
- [x] AC6: **崩溃根因关联**——三次崩溃调查记录补「tmux 泄漏累积」为具体机制（负载飙升候选获解释），
      此前无定论
      → 已追加 `orchestration/restart-plan-2026-08-04-third.md` §6（2026-08-05 更新）。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group engine`（沿用测试卫生族声明）
      → 三个涉及文件均为 node:test 且带 `@test-group`（send-keys-verified=governance、quay-init=product，
      沿用各自既有分组；新增负控制测试在同一 node:test 文件内）。

## 执行证据（2026-08-05，worktree /home/yale/work/quay-worktrees/tmux-leak）

**① AC2 负控制实跑**（send-keys-verified.test.mjs 第 5 个测试，通过）：
```
✔ AC2 negative control — cleanup with a LOST socket-selection env is harmless: kill-session can only error (no-such-session), never wipe the default socket's real sessions (325ms)
```
它在 09:2xZ 的失败形态下实测：`env` 的 `TMUX`/`TMUX_TMPDIR` 全删后 `tmux kill-session -t skv-nc` 落默认 socket →
`can't find session: skv-nc`（exit 1），`tmux list-sessions` 前后会话数不变（真实 quay-0 未受影响）。

**② 两个改动测试文件单文件全绿**：
```
send-keys-verified.test.mjs: 5 pass / 0 fail  (含 AC2 负控制)
quay-init-tmux-detection.test.mjs: 6 pass / 0 fail
```

**③ scoped 套件**（`bash scripts/test.sh --for-task gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause --test-concurrency=1`）：
```
tests 48 · pass 47 · fail 0 · cancelled 0 · skipped 1
```
（`--test-concurrency=1` 序列化避开已知负载敏感族 M6 的并发竞态——该族在文件头声明 KNOWN-LOAD-SENSITIVE，
并发默认并发度下 M6 偶发 `countMountProcesses` 2≠1，串行下 pass；非本任务改动引起。）

**④ AC4 多轮稳定性**（3 轮，每轮后计数）：
```
baseline: tmux servers=2 (真实 quay-0), 泄漏前缀=0
ROUND 1: servers=2  leak-prefix=0  /tmp leak dirs=0  scan=CLEAN
ROUND 2: servers=2  leak-prefix=0  /tmp leak dirs=0  scan=CLEAN
ROUND 3: servers=2  leak-prefix=0  /tmp leak dirs=0  scan=CLEAN
```

**⑤ 套件尾部扫描**（AC1 判据，修复后）：
```
tmux-leak-scan: clean — no residual test tmux servers/dirs (prefixes: skv-|session-liveness-|ol-tok-|enter-repro-)
```
（修复前同一扫描正确报出 `/tmp/session-liveness-ArJFw6`、`/tmp/session-liveness-WDE1Ph`、`/tmp/skv-exp` ——
残留确实能被机械抓住；基线清理后归零。）

**⑥ invoke 判据**（Contract）：
```
grep -n "kill\|teardown\|TMUX_TMPDIR\|skv" plugin/test/send-keys-verified.test.mjs
```
→ cleanup() 在 rmSync 前逐个 `tmuxAt(sockPath, ["kill-session","-t", name], env)`；全文件零 `kill-server` 调用
（仅注释说明为何不用）。

**⑦ 2026-08-07 重验（outer priority dispatch —— 现场仍有 156+ 泄漏 server）**

现场（本机）实测仍有 156–158 个泄漏 tmux server（topo-factory/topo-idem/isc-factory/sb-*/ol-*），
大部分来自**跨主机复现发现的工厂/引导脚本直建会话**：`quay-topology.sh --session topo-factory`、
`--session isc-factory`、session-bootstrap `--socket <sock>` 建的 `sb-*`，均由 spawnSync 直建在
hermetic socket 上，**不在 helper 的 `started` 集合里** → 原 cleanup 只杀 `started`，rmSync 删目录后
server 变孤儿（删目录 ≠ 杀进程，正是本任务标题的机制）。**这是 2026-08-06 跨主机复现发现的 3 个新文件的
残余泄漏点**，本次补修：

- `session-topology.test.mjs` / `inner-session-check.test.mjs` / `session-bootstrap.test.mjs` 的 hermetic
  cleanup 改为 **`list-sessions` 全扫 + 逐个 `kill-session -t`**（socket 是本测试私有 mkdtemp，全扫不可能碰
  真实会话；仍保留 `started` 集合兜底），绝不用 kill-server。
- `tmux-leak-scan.sh` 前缀扩展：进程扫描改 **session 名锚定** `-s skv-|ol-|topo-|isc-|sb-|enter-repro-`
  （裸 `ol-`/`sb-` 会误报 `/tmp/tmuxisol-*` 含 "sol-"）；/tmp glob 加 `ol-prod-`/`quay-sb-`/`quay-topo-`/
  `quay-isc-`/`quay-init-tmux-`。一次覆盖全类（AC1）。

**修复前泄漏实跑（证明残余点真实）**：`session-topology` 一轮 topo 40→43（+3，工厂会话未被回收）；
`inner-session-check` isc 22→23（+1）；`session-bootstrap` sb 30→35（+5）。**修复后重跑零新增**：
topo 42→41、isc 恒 23、sb 恒 35。`session-liveness` 完整跑 52 pass / 0 fail / 1 skip，ol 恒 63
（本文件 makeHermeticProbe cleanup 本就正确，正常完成不泄漏；现场 ol-* 均为历史中断跑残留）。

**AC4 重验（3 轮，修复后，泄漏前缀计数不随轮数累积）**：
```
BASELINE: topo=35 isc=22 sb=35 ol=65
ROUND 1: before=[topo=35 isc=22 sb=35 ol=65] after=[topo=35 isc=22 sb=35 ol=65]
ROUND 2: before=[topo=35 isc=22 sb=35 ol=65] after=[topo=35 isc=21 sb=35 ol=64]
ROUND 3: before=[topo=35 isc=21 sb=35 ol=64] after=[topo=35 isc=21 sb=35 ol=64]
```
每轮 42 tests / 39 pass / 3 fail——3 fail 均为**既有漂移**（session-topology AC2/AC4 断言旧脚本名
`topology-check.sh`/`quay-topology.sh`、session-bootstrap AC5 断言 `session-bootstrap.sh`；SKILL.md 已改为
`quay-session.ts` 命令，primary develop 同源一致），**与本任务泄漏修复无关**，非本任务引入。

**负控制（AC1 判据，扫描抓住真实残留）**：`tmux-leak-scan.sh` 对现场 156+ 孤儿完整报出（topo-factory/
ol-*/isc-factory/sb-*），exit 1。现场残留为**历史 + 并发 worktree 累积**（观察者 worktree 无本次 list-sessions
修复、其全量跑仍在泄漏）；本任务修复后我方每轮跑零新增。残留清理须按 AC3 流程人工逐一 kill-session（禁
kill-server），且须避开并发 worktree 的活动 fixture。

## Definition of Done

- [x] AC1–AC7 全部勾上；AC4 实跑输出贴任务体（多轮后 server 数稳定）——2026-08-07 重验，AC4 3 轮实测见执行证据 ⑦
- [x] 测试起外部进程/服务器必在 teardown 回收；套件尾部断言在；泄漏不再累积——send-keys-verified +
      quay-init-tmux-detection + 跨主机族 3 文件（session-topology/inner-session-check/session-bootstrap）
      cleanup 均 kill-session 回收（list-sessions 全扫兜底）；tmux-leak-scan.sh 接入全量尾部；AC4 3 轮泄漏前缀
      计数稳定不累积
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——**未勾**：develop 现有 3 个既有漂移失败
      （session-topology AC2/AC4、session-bootstrap AC5，断言旧脚本名 `topology-check.sh`/`quay-topology.sh`/
      `session-bootstrap.sh`，SKILL.md 已改 `quay-session.ts` 命令），与本任务泄漏修复无关，非本任务引入；
      primary develop 同源一致。本任务相关文件自身 39/42 pass，3 fail 全部为该漂移

## Touches

- tasks/gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/test/send-keys-verified.test.mjs（teardown kill 自己起的 server，TMUX_TMPDIR 校验）
- plugin/test/quay-init-tmux-detection.test.mjs（AC2b：4 处 kill-server 改 kill-session -t）
- plugin/test/heavy-op-token*.test.mjs（ol-tok 泄漏源，同族 teardown）
- plugin/test/session-liveness.test.mjs（同族 teardown）
- plugin/test/session-topology.test.mjs（2026-08-07 跨主机族：hermetic cleanup 改 list-sessions 全扫，杀工厂建的 topo-factory/topo-idem —— 见执行证据 ⑦）
- plugin/test/inner-session-check.test.mjs（2026-08-07 跨主机族：同上，isc-factory）
- plugin/test/session-bootstrap.test.mjs（2026-08-07 跨主机族：同上，sb-*）
- plugin/scripts/tmux-leak-scan.sh（套件尾部泄漏断言工具；2026-08-07 前缀扩展覆盖跨主机族：session 名锚定 skv-|ol-|topo-|isc-|sb-|enter-repro- + /tmp 目录 glob；收窄自 plugin/scripts/ 以消除 overbroad glob 派发串行化）
- scripts/test.sh（套件尾部挂泄漏断言，若并入）
- tasks/gap-tests-never-clean-up-their-tmpdirs.md（AC5 交叉标注）
- orchestration/restart-plan-2026-08-04-third.md（AC6 崩溃根因关联的具体文件；收窄自 orchestration/ 以消除 overbroad glob 派发串行化）

## 跨主机复现（管理者 2026-08-06 15:4xZ，B 机只读观测）

**范围比已知的更宽——至少 3 个新增泄漏源文件，均不在上面的 Touches 列表里。**

B（orangevps）decommission 前的例行核实（`pgrep -af 'claude|tmux'`，只读，未做任何清理——
跨主机 kill/批量进程操作禁止执行，这条证据留给 A 侧或人授权后处理）：

| 项 | 值 |
|---|---|
| B 上 `tmux: server` 进程数 | **24** |
| 涉及的会话名前缀 | `ol-*`、`sb-ac1/ac3/ac4/mgr/idem`、`topo-factory/idem`、`isc-factory`、`escprobe` |
| 已知来源（原任务已列） | `ol-*` → `session-liveness.test.mjs`（同族） |
| **新增来源（本次新查，原任务未列）** | `sb-*` → `plugin/test/session-bootstrap.test.mjs`；`topo-*` → `plugin/test/session-topology.test.mjs`；`isc-factory` → `plugin/test/inner-session-check.test.mjs` |

⇒ **这不是"send-keys-verified 一个文件的问题"，是这一族会话夹具测试（tmux new-session 起测试会话）普遍缺 teardown 的模式**——本任务标题当初聚焦单一根因，实测范围已扩大到至少 5 个文件（`send-keys-verified` / `session-liveness` / `session-bootstrap` / `session-topology` / `inner-session-check`）。

**未做的事，明确记录**：管理者未清理 B 上任何这些进程（跨主机 kill 禁止），也未修改上述 3 个新增文件——只报出实测证据。AC7（若后续加）应覆盖这 3 个新文件的 teardown，而不只是 AC1-AC6 原定的 3 个。

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

## 交叉标注（2026-08-07，gap-suite-cutoff-what-tears-test-process-at-session-topology 执行内层）

本任务原假设「泄漏经 OOM 成为切断源」**已被 gap-suite-cutoff 决定性排除**（dmesg 今日无 OOM；
mem_avail=10.4GB）。泄漏仍是资源压力与崩溃史的真源，但**不是当前 8/7 SIGKILL 的机制**。
gap-suite-cutoff 执行内层另发现**泄漏扫描覆盖缺口**（本任务地盘，记录不代修）：当前 105 个
tmux server 进程的前缀大量是 `ol-*`（ol-payload / ol-ac9 / ol-multi-ac4 …）、`isc-factory`、
`topo-*`、`sb-ac`，而 `tmux-leak-scan.sh` 白名单只有 `skv-|session-liveness-|ol-tok-|enter-repro-`
——实际泄漏类不在扫描内。建议本任务把白名单扩到实测泄漏前缀，或改为按「进程数回落断言」覆盖全类。
