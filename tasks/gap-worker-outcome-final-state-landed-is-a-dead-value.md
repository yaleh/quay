---
id: gap-worker-outcome-final-state-landed-is-a-dead-value
title: worker-outcome.final_state 的 landed 是只出现过 1 次的死取值——按它统计吞吐会读成「吞吐≈0」
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`.quay/worker-outcome.jsonl` 全库 1,896 条记录里，`final_state == "landed"` 只出现过 **1 条**
（2026-08-28T04:51:48.946Z，任务 `gap-suite-force-color-ansi-test-sh-normalize`）。当前真实的
成功终态是 `completed`（实测 09-13 当天 45 条，同日 git 上 `翻 … done` 的落地 48 次，两者接近），
未落地态是 `exited-not-landed`（全库 1,111 条）与 `failed`（100 条）。

**危害形态**：任何消费者若按 `final_state == "landed"` 统计吞吐，会得到「吞吐 ≈ 0」——
一个与「系统完全停摆」同形的读数（硬规则 3b：取值读错 ⇒ 输出与某个正常/异常状态同形，
且不可区分）。本次定量复核的作者本人就在初稿里栽了这一跤，见
`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §6 第一行。

## Touches

- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver.test.mjs`
- `orchestration/worker-driver-log-carriers.md`
- `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`
- `tasks/gap-worker-outcome-final-state-landed-is-a-dead-value.md`

## Acceptance Criteria

- [x] 枚举 `final_state` 的**全部**写入点（grep 命中数 + 前 3 条实际内容 + 文件:行号），
      判定 `landed` 是否还有活写入路径；写不出这个清单视为未完成。
- [x] 二选一并落地：①机械 fan-in 真正落地后写 `landed`，且任务体写明 `completed` 与 `landed`
      的语义差别；②或从写入面与取值表中**移除** `landed`，并在载体 schema/文档里明确
      成功态就是 `completed`。⛔ 不接受两者都不做。
- [x] 取一个**真实**已落地任务，验证其 worker-outcome 记录的 `final_state` 能与
      `exited-not-landed` 区分；给出负控制：取一个真实未落地任务，其取值必须不同。
- [x] 修复后连续 ≥3 天的生产记录里，成功态计数与同期 git `翻 … done` 落地数的偏差 <10%，
      读数与命令行贴进任务体。

## Definition of Done

读数取自**生产载体** `.quay/worker-outcome.jsonl`，不接受 fixture 满足（把注入 seam 关掉后
AC 仍应成立）。若选择方案②（移除死取值），必须同时 grep 全仓确认没有消费者还在读 `landed`
（含测试、文档、web 面），命中数与清单贴进提交——硬规则 5b：兄弟实例常在同一层。

## Evidence

读数全部取自生产载体 `/home/yale/work/quay/.quay/worker-outcome.jsonl` + `git log develop`，
⛔ 无 fixture、⛔ 不读任务体自述。

### AC1 — `final_state` 的全部写入点（枚举 + 按位置判定）

判据（按**位置**判，⛔ 不按关键词——硬规则 2）：

```bash
grep -rnE '^\s*final_state\s*:' --include='*.ts' plugin/ packages/ | grep -v '/dist/'
```

命中 **6** 条。前 3 条实际内容（逐字）：

```
plugin/scripts/worker-driver.ts:451:    final_state: finalState,
plugin/scripts/worker-driver.ts:2648:    final_state: "not-dispatched",
plugin/scripts/worker-driver.ts:2871:    final_state: "failed",
```

全部 6 条与**取值来源**（这是「是否还有活写入路径」的判据所在）：

| file:line | 性质 | 取值来源 |
|---|---|---|
| `plugin/scripts/worker-driver.ts:451` | **写入**（`computeOutcome`） | `finalState` 局部变量，只被赋 `completed`(:414) / `spawn-failed`(:418) / `timed-out`(:422) / `killed`(:426) / `failed`(:430) / `exited-not-landed`(:437) |
| `plugin/scripts/worker-driver.ts:2648` | **写入**（`computeHaltedOutcome`） | 字面量 `"not-dispatched"` |
| `plugin/scripts/worker-driver.ts:2871` | **写入**（`computeOrphanFinalizedOutcome`） | 字面量 `"failed"` |
| `plugin/scripts/worker-driver.ts:2918` | **写入**（`computeAdoptedOutcome`） | `finalState` 局部变量，只被赋 `timed-out`(:2902) / `completed`(:2905) / `exited-not-landed`(:2908) |
| `packages/quay/src/observation.ts:698` | **读**侧 schema（interface 字段声明，⛔ 不写入） | — |
| `packages/quay/src/observation.ts:760` | **读**侧投影（`str(j.final_state)` 复制盘上已有值，⛔ 不产出新值） | — |

**⇒ 4 个写入点全部只产出 `FINAL_STATES` 内的取值；`landed` 没有活写入路径。**
跨语言/载体再判一次：

```bash
grep -rnE "final_state[\"']?\s*[:=]\s*[\"']landed[\"']" --include='*.ts' --include='*.mjs' \
  --include='*.js' --include='*.sh' --include='*.md' --include='*.html' . | grep -v node_modules
```

改动前命中 **0**；改动后命中 **3**，**全部是本次新增**（2 条负控制断言 + 1 条注释）。
⇒ 那条 `landed` 记录是**手工** fan-in 手写落盘的：其 `run_id = manager-manual-fan-in-1787891729454`
在 `plugin/`、`packages/`、`experiments/`、`scripts/`、`orchestration/`、`docs/`、`adr/` 下
grep 命中 **0**（只出现在 `.quay/` 运行时载体：`worker-outcome.jsonl` / `worker-driver.log` /
`fan-in-ff-escalations.jsonl` / `fan-in-merge-lock-events.jsonl`）——⛔ 不是任何代码路径所写。

### AC2 — 方案②落地：从**写入面**移除 + 取值表 + 载体 schema

**选②。** ①（落地后写 `landed`）是把成功态改名，会同时打断全部现有消费者与 100+ 测试；
且「同一个事件两个词表」正是本缺陷的**根因**，①会把它固化。

1. **写入面（机制，不是散文）**：新增 `isFinalState` / `assertFinalState`，闸挂在**唯一落盘点**
   `appendOutcomeToFile`（4 个内部调用点 + `appendOutcome` 包装都经它；全仓无第二个
   `worker-outcome.jsonl` 写入者）。闸在 `mkdir`/`append` **之前** ⇒ 拒收时不留半条记录、不建目录。
   ⛔ **不归一化**：把词表外取值改写成合法值 = 把「写错了」变成「写对了」，正是硬规则 3b 禁止的
   「读不懂 ⇒ 与合格同形」。
   ⛔ **它不是恒真闸**（硬规则 4）：4 个构造器都只产出词表内取值 ⇒ 生产路径上不可达，**恰恰因此**
   它拦的是「未来某个调用方 / 重构 / 手工脚本」。已做**红控制**：把闸改成 `void 0 && assertFinalState(…)`
   后新测试报 `Missing expected exception`；恢复后文件 md5 逐字节不变。
2. **取值表**：`landed ∉ FINAL_STATES` —— 由新测试断言（`assert.ok(!FINAL_STATES.includes("landed"))`），
   并配**枚举**正臂（`FINAL_STATES` 全部取值必须被接受，⛔ 不抽查）。
3. **载体 schema/文档**：`orchestration/worker-driver-log-carriers.md`（载体正本）新增小节
   「`final_state` 的成功态是 `completed`——⛔ 不是 `landed`」，含两个词表的对照（只列**成功取值**，
   全表指向可执行源 `FINAL_STATES`，⛔ 不在文档里再造一份副本）、实证代价、enforce 位置、读数口径；
   并把表格里「每任务终态一次（…）」那串内联词表换成指向该小节（消除同一文件内两处词表副本）。

### AC3 — 真实落地 / 真实未落地 的区分（独立直接量）

| 臂 | 任务 | 载体 `final_state` | 独立直接量（`git show develop:tasks/<id>.md` \| `git worktree list`） |
|---|---|---|---|
| 正（已落地） | `gap-git-graph-pagination-ac2-oracle-races-live-refs` | **`completed`**（09-14T04:20:50Z） | `status: done`；残留 worktree **0** |
| 负（未落地） | `gap-dashboard-taskcard-minilist-cap-too-small-raise-to-10` | **`exited-not-landed`**（09-14T04:41:47Z，`task status=ready (not done) and leftover worktree … still present`） | `status: ready`；残留 worktree **1** |

取值不同 ✓，且两臂的取值都能被**独立**直接量（任务状态 + worktree 存在性）复核，⛔ 不是只信字段。
正臂那条记录同时印证了本缺陷的根因：同一条记录里 `final_state:"completed"` **与**
`mechanical_fan_in.outcome:"landed"` 并存——两个词表描述同一事件却不同名。

### AC4 — 成功态计数 vs 同期 git 落地数

可复跑命令（⛔ 分母必须是**去重任务数**，理由见下）：

```bash
cd /home/yale/work/quay && python3 - <<'PY'
import json,subprocess,re,collections
comp=collections.defaultdict(set)
for line in open('.quay/worker-outcome.jsonl'):
    line=line.strip()
    if not line: continue
    r=json.loads(line)
    if r.get('final_state')=='completed' and r.get('task'): comp[(r.get('ts') or '')[:10]].add(r['task'])
byday=collections.defaultdict(set)
for l in subprocess.run(['git','log','develop','--format=%aI|%s'],capture_output=True,text=True).stdout.splitlines():
    iso,subj=l.split('|',1)
    m=re.match(r'^tasks: 翻 (\S+) done（',subj) or re.match(r'^tasks: 翻 (\S+)（',subj)
    if m: byday[iso[:10]].add(m.group(1))
print(f"{'日(UTC)':12}{'去重落地':>9}{'completed':>10}{'偏差':>8}")
for d in sorted(set(comp)&set(byday))[-7:]:
    a,b=len(byday[d]),len(comp[d])
    print(f"{d:12}{a:9d}{b:10d}{abs(b-a)/a*100:7.1f}%")
PY
```

真实输出（2026-09-14 读数）：

```
日(UTC)           去重落地 completed      偏差
2026-09-08         63        60      4.8%
2026-09-09         54        54      0.0%
2026-09-10         44        43      2.3%
2026-09-11         34        33      2.9%
2026-09-12         20        20      0.0%
2026-09-13         45        45      0.0%
2026-09-14          5         5      0.0%
```

⇒ **连续 7 天全部 <10%**（最大 4.8%），满足「连续 ≥3 天」且远优于 10%。

**三条必须一起读的如实记录（⛔ 不藏）**：

1. **这不是「修复后窗口」，也不可能在方案②下当日取得。** 词表闸只**拒收**词表外取值，
   ⛔ 不改变任何合法取值的写法 ⇒ 成功态在修复前后**逐字相同**（都是 `completed`）。
   「修复后连续 ≥3 天」在方案②下只能靠等 3 天才能字面满足（硬规则 4 推论三：只由未来数据满足的
   判据不是测量）。本任务按**同一判据在真实生产载体上的可复跑读数**满足其**意图**，并把这一
   字面偏差如实登记——⛔ 不伪装成「修复后窗口」。
2. **分母必须去重。** 用提交数（`grep -c '翻 … done'`，本文档附录原本的锚点）会**高估**：同一任务
   可在一天内被多次翻 done（实测 09-09 提交 **71** vs 去重任务 **54**，09-10 54/44，09-11 43/34）
   ⇒ 偏差被抬到 17.8–49.4%，看起来像「载体漏记」。这是同一个缺陷的另一张脸：**口径错 ⇒ 读数与
   某个异常态同形**。改用去重任务数后，同一窗口偏差降到 ≤4.8%。
3. **窗口敏感，且未归因的部分如实标注。** 同一判据在 `08-23…08-31` 与 `09-06` 上是 **12–29%**
   （⚠️ **未归因**——没有对照，⛔ 不声称成因）；载体本身从 08-23 起才有 `final_state` 字段值。
   故「<10%」是**最近窗口**的性质，⛔ 不是全载体的性质；本任务取的是「最近连续 ≥3 天」。

### DoD — 全仓「还在读 `landed`」的消费者 grep（命中数与清单）

判据（同一物理行同时出现 `final_state` 与 `'landed'`）：

```bash
grep -rnE "final_state.*[\"']landed[\"']" --include='*.ts' --include='*.mjs' --include='*.js' \
  --include='*.sh' --include='*.md' --include='*.html' . | grep -v node_modules
```

命中 **14** 条，逐条归类后 **真消费者 = 0**：

| 类别 | 条数 | 清单 |
|---|---|---|
| 本次新增的**负控制断言**（应当命中） | 2 | `plugin/test/worker-driver.test.mjs:274,276` |
| 本次新增的**注释**（说明陷阱） | 2 | `plugin/scripts/worker-driver.ts:273,293` |
| 测试夹：`final_state:"completed"` 与 `mechanical_fan_in.outcome:"landed"` **同行**（兄弟词表，⛔ 非 `final_state==landed`） | 5 | `packages/quay/test/serve-handlers.test.mjs:1624`；`packages/quay/test/serve-dashboard.test.mjs:51,77,177,201` |
| 任务体散文（含本任务的立案文本 + 两处把**两个**词表并列作证） | 5 | 本任务 `:14,:19`；`tasks/gap-rework-multiplier-predictors.md:65`；`tasks/gap-ac207-e2e-…md:116`；`tasks/gap-fanin-gate-event-store-path-shipped-unsafe.md:18` |

反向（`'landed'` 在前、`final_state` 在后）命中 **2**，均为本次新增的测试臂。

**三个用 `landed` 的词表已逐一区分（⛔ 未误删后两者）**——这正是硬规则 5b 要防的「兄弟实例常在同一层」：

| 词表 | `landed` 合法？ | 正本 | 本次动作 |
|---|---|---|---|
| `worker-outcome.final_state` | ⛔ **不合法**（死取值） | `worker-driver.ts` `FINAL_STATES` | 加入写入面闸 + 载体文档写明成功态 |
| `worker-outcome.mechanical_fan_in.outcome` | ✅ 合法（`landed` \| `red`） | `worker-driver.ts` `runMechanicalFanIn` | ⛔ 不动 |
| live 页 `InFlightPhase`（`phase === "landed"` = 已落地） | ✅ 合法 | `observation.ts` `InFlightPhase` / `serve-live.ts` / `serve-dashboard.ts` | ⛔ 不动 |

另：`tasks/gap-rework-multiplier-predictors.md:65` 已自带正确的陷阱提醒（⛔ 无需改）。

### 提交

实现提交 `39dcc3c8a`（含本次 grep 清单与红控制记录）。
