---
id: gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause
title: "tests LEAK tmux servers — the MAIN resource pressure and very likely the three-crash cause (manager found + cleared 217, oldest 12h): all from plugin/test/send-keys-verified.test.mjs's skv-ok sessions — isolation design is RIGHT (each leaks a TMUX_TMPDIR=/tmp/skv-XXXXXX/sock, never touches default socket, NOT the 'kill-through-isolation' class of crash #3) but tests never kill the servers they spawn, and tonight's dozens of full-suite runs left a fresh batch each round; PSI cpu avg10 94.18 → 31.47, gate WAIT→GO, tmux servers 217 → 10 after cleanup — THIS is the main resource pressure, NOT laneCount and NOT the other two projects (manager's earlier attributions both incomplete); 9 residual leaks remain (8 /tmp/session-liveness-*/sock oldest 16h53m + 1 /tmp/enter-repro-79bc/sock) left for inner judgment (a mounted observer pid 2598198 may use one); fix is a CLASS not one file: tests that spawn external processes/servers must reclaim them in teardown (same family as gap-tests-never-clean-up-their-tmpdirs); mechanically checkable: after a test run NO tmux server or /tmp dir carrying the test's characteristic prefix (skv-/session-liveness-/enter-repro-) may remain — the assertion goes at the END of the suite covering the whole class at once; reconsider: ① three-crash root cause now has a concrete mechanism (accumulate over time → load spikes before crash) where load was an unexcluded candidate; ② the 07:26 resource ABORT and 07:50 cross-project pause were both right decisions with incomplete attribution; ③ gate is GO now, M3 validation suite can run"
status: todo
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

## Acceptance Criteria

- [ ] AC1: **套件尾部断言**——测试跑完后无 `skv-` / `session-liveness-` / `ol-tok-` / `enter-repro-`
      前缀的 tmux server 或 /tmp 目录残留（机械检查，一次覆盖全类）
- [ ] AC2: **teardown 回收**——send-keys-verified.test.mjs（及同族）测试结束 kill 自己起的 server，
      带 TMUX_TMPDIR 校验、绝不用 tmux kill-server（第三次崩溃路径）
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
