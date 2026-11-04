# 派发环供给上限 vs 执行效率（2026-11-02）

> 只读分析报告。任务 `gap-dispatch-supply-ceiling-vs-execution-efficiency` 的落地产物。
> **结论（与读数一致）**：当前吞吐低的主因是**任务存量枯竭**（`todo=0`，`ready` 全部在飞），
> 不是执行慢。优化预算应落在**生成层（routine 轨道）**，不是执行层，也不是 promotion 层。
> **本条不改任何派发 / promotion / AC-DoD 门。**

## 读取元数据

| 项 | 值 |
|---|---|
| 读取时刻（UTC） | 2026-11-02T14:56:26Z |
| 工作区根（数据读取处） | `/data/home/yale/work/quay`（主检出 author） |
| 代码版本 | `git HEAD=788d70941`（author 与 develop 一致） |
| 数据源 | `tasks/*.md`（frontmatter）、`.quay/worker-round.jsonl`、`.quay/gate-events.jsonl` |

> ⛔ 复跑须知：`.quay/worker-round.jsonl` 与 `.quay/gate-events.jsonl` 是 gitignored 的生产载体，
> 只存在于主检出，**不在任何 worktree 里**。下面所有命令都在主检出根运行。

## 口径定义

- **tick** = `.quay/worker-round.jsonl` 的一行（一个 round）。
- **可派发 tick（dispatchable tick）** = `action=="dispatch"` 的行（该 tick 实际派发了至少一个新任务）。
  > ⚠️ **本条定义与生产实现不符（2026-11-04 实测，缺陷未修）**：`plugin/scripts/worker-driver.ts:6023`
  > 的 `reason != null ? "stop" : inFlight > 0 ? "dispatch" : "idle"` 在 **cap 已满、本轮未派发**时同样写
  > `action="dispatch"`——此时派发循环 `while (running.length < cap …)` 根本没进入，`waitReason` 保持
  > `null`，于是落到 `inFlight > 0` 分支。因此**照本定义直接读该字段会高估可派发 tick**（7 日窗口内
  > 89 标称中 72 条是 cap 满的空转轮）。可复跑的替代判据与更正后的读数见 §AC3「更正」小节；缺陷任务：
  > `gap-worker-round-action-field-conflates-dispatch-and-wait`。
- **落地任务（landed task）** = `.quay/gate-events.jsonl` 里 `gate=="complete"` 的事件（`payload.to=="done"`，done 翻转）。
- **三种"没有派发"**（互斥，按 `stop_reason` 前缀分类）：
  - **真空闲**：`pool-empty` —— 可派发池（ready 且非在飞）为空。
  - **被过滤**：`filtered-empty` —— 有候选但被依赖/Touches/在飞/资源门过滤。
  - **资源门拒绝**：`resource-gate-wait` —— 资源门（load/cpu/mem）拒绝，未到派发判定。
  - 另有 `mcp-halt`（控制面停泊）与 `backoff`（候选快速死亡退避），单列、不与上述三种混淆。
- **`action=="stop"` 不能区分终态与瞬时**：终态停机（`mcp-halt`）与全部瞬时等待（`pool-empty` /
  `filtered-empty` / `resource-gate-wait` / `backoff`）共用同一个 `action="stop"`——生产者其实算出了该判别位
  （`driver-runtime.ts:2170-2183` 的 `terminal: true|false`），却在写盘时（`worker-driver.ts:6773` 的
  `stopReason ?? waitReason`）丢弃。实测全量 70,882 行中，`action="stop"` 且 `in_flight>0` 的 7,986 行里
  只有 18 行是终态。⇒ 上文三种"没有派发"只能按 `stop_reason` 前缀分类；⛔ **不得用 `action` 判断循环是否停止**。

---

## AC1 — 任务库逐状态计数（按位置核对，frontmatter 与正文散文区分）

复跑命令（frontmatter 解析，只认文件头 `---` 块内的 `status:`）：

```bash
python3 - <<'PY'
import glob, collections
counts = collections.Counter()
for path in glob.glob('tasks/*.md'):
    lines = open(path).read().split('\n')
    if not lines or lines[0].strip() != '---': continue
    close = next((i for i in range(1, len(lines)) if lines[i].strip() == '---'), None)
    if close is None: continue
    for ln in lines[1:close]:
        s = ln.strip()
        if s.startswith('status:'):
            counts[s[len('status:'):].strip()] += 1
            break
print(dict(counts))
PY
```

执行当日实测（2026-11-02T14:56Z，**不是沿用 11-02 提案里的历史快照**）：

```
{'done': 3030, 'superseded': 76, 'ready': 5, 'needs-human': 1}
```

- 文件总数 3112，`todo` 缺键 ⇒ **真实 frontmatter `todo = 0`**。
- 真实 frontmatter 分布：`done=3030 / superseded=76 / ready=5 / todo=0 / needs-human=1`。
  （提案申报的 `ready=1` 已过期：执行当日 `ready` 已涨到 5，全部为在飞批次，见 AC4。）

**位置核对**——`grep -n '^status: <value>'` 前 3 条实际匹配，区分 frontmatter（行号在文件头 `---` 块内）与正文散文行：

```bash
grep -n '^status: todo'      tasks/*.md | head -3
grep -n '^status: ready'     tasks/*.md | head -3
grep -n '^status: needs-human' tasks/*.md | head -3
```

| 状态 | 原始 `grep -c`（含散文） | 真实 frontmatter | 前 3 条匹配贴出（行号 + 判定） |
|---|---|---|---|
| done | 3034 | **3030** | `ARCH-M93-002.md:5`、`ARCH-M93-001.md:5`、`ARCH-M103-001.md:5` —— 均为 frontmatter（行 5） |
| superseded | 76 | **76** | `DIR-101.md:4`、`DIR-121.md:5`、`DIR-119-D2.md:5` —— 均为 frontmatter |
| ready | 8 | **5** | 第 1 条 `gap-closure-sync-...md:101:status: ready——人裁定…` 是**正文散文**；第 2 条 `gap-effort-tiering-effect-unmeasured.md:5` 才是 frontmatter；第 3 条 `gap-manager-baked-...md:151` 又是散文 |
| todo | 49 | **0** | `gap-ac3b-...md:240`、`gap-adr-016-...md:92`、`gap-axis-generator-...md:201` —— **49 条全部是正文散文行**（`status: todo——…`），零 frontmatter |
| needs-human | 2 | **1** | `gap-meta-call-author-develop-take-develop-30.md:4`（frontmatter）；`gap-retire-needs-human-cause-enumeration.md:121`（散文） |

结论：裸 `grep -c '^status: todo'` 的 49 是**正文散文伪装成 frontmatter**，真实 `todo=0`。计数必须先打印前 3 条匹配内容（硬规则 2）。

---

## AC2 — 至少 3 个整日的 stop_reason 窗口读数（显式带窗口）

复跑命令（把 `WINDOW_DAY` 换成目标整日；分类按前缀）：

```bash
python3 - <<'PY'
import json, collections
WINDOW_DAY = '2026-11-01'   # 显式窗口：整日（UTC），按 ts 前缀过滤
def classify(d):
    a = d.get('action')
    if a == 'dispatch': return 'dispatched'
    if a == 'idle': return 'idle'
    sr = str(d.get('stop_reason'))
    for p in ('pool-empty','filtered-empty','resource-gate-wait','mcp-halt','backoff'):
        if sr.startswith(p): return p
    return 'other'
c = collections.Counter()
with open('.quay/worker-round.jsonl') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        d = json.loads(line)
        if d.get('ts','')[:10] == WINDOW_DAY:
            c[classify(d)] += 1
total = sum(c.values())
for k, v in c.most_common():
    print(f'{k:20s} {v:6d}  {v/total*100:5.1f}%')
print('total', total)
PY
```

读数（`pool-empty` / `filtered-empty` / `resource-gate-wait` 分列，各占该日 tick 百分比）：

| 窗口（UTC 整日） | 总 tick | dispatched | pool-empty | filtered-empty | resource-gate-wait | mcp-halt | backoff |
|---|---|---|---|---|---|---|---|
| 2026-10-29 | 621 | 3 (0.5%) | 435 (**70.0%**) | 103 (**16.6%**) | 1 (0.2%) | 79 (12.7%) | 0 |
| **2026-10-30** | 1024 | 10 (1.0%) | 959 (**93.7%**) | 55 (**5.4%**) | 0 | 0 | 0 |
| **2026-10-31** | 1054 | 1 (0.1%) | 985 (**93.5%**) | 68 (**6.5%**) | 0 | 0 | 0 |
| **2026-11-01** | 830 | 12 (1.4%) | 686 (**82.7%**) | 129 (**15.5%**) | 3 (0.4%) | 0 | 0 |
| 2026-11-02（partial，至 14:53Z） | 701 | 3 (0.4%) | 659 (**94.0%**) | 37 (**5.3%**) | 2 (0.3%) | 0 | 0 |

- 三个整日（10-30 / 10-31 / 11-01）的 `pool-empty` + `filtered-empty` 合计：**99.1% / 99.9% / 98.2%**，
  与提案申报的"约 99%"一致，但此处是按整日窗口分列后的独立读数。
- `resource-gate-wait` 在近三日占比 ≤0.4%（10-30 / 10-31 为零）——**资源门不是当前空闲主因**。
- `mcp-halt` 只在 10-29 出现 12.7%（当日控制面停泊窗口），近三日为零。
- ⚠️ **`dispatched` 列是标称值**（同一条 `action` 缺陷，见 §口径定义 第一条警示）：含 cap 已满的空转轮。
  按 `pool !== null` 更正后，上表四个整日为 **10-29:1、10-30:3、10-31:0、11-01:2**（原 `3/10/1/12`）；
  11-02 partial 中标称 3 条里 2 条为真实派发（窗口端点与上表切法略有差异）。其余各列按 `stop_reason`
  分类，不受该缺陷影响。更正的完整口径与复跑命令见 §AC3「更正」。

---

## AC3 — 产出率两套分母各算一次（并列，不只给后者）

复跑命令（显式 7 整日窗口）：

```bash
python3 - <<'PY'
import json
W_START, W_END = '2026-10-26T00:00:00.000Z', '2026-11-02T00:00:00.000Z'  # 7 整日
total = disp = 0
with open('.quay/worker-round.jsonl') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        d = json.loads(line)
        ts = d.get('ts','')
        if W_START <= ts < W_END:
            total += 1
            if d.get('action') == 'dispatch': disp += 1
landed = 0
with open('.quay/gate-events.jsonl') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        d = json.loads(line)
        if d.get('gate') == 'complete' and W_START <= d.get('timestamp','') < W_END:
            landed += 1
print('total ticks =', total, '| dispatchable ticks =', disp, '| landed tasks =', landed)
print('landed / total        =', landed / total)
print('landed / dispatchable =', landed / disp)
PY
```

窗口 `2026-10-26T00:00Z → 2026-11-02T00:00Z`（7 整日，含）：

| 量 | 值 |
|---|---|
| 落地任务数（`gate=complete`） | 93 |
| 总 tick | 6791 |
| 可派发 tick（`action=dispatch`，**标称值——见下方更正，口径有缺陷**） | 89（占总 tick 1.31%） |
| **旧算法：落地 / 总 tick** | 93 / 6791 = **0.0137（1.37%）** |
| **新算法：落地 / 可派发 tick**（原读数，⚠️ **已作废**） | 93 / 89 = **1.045（104.5%）** |

> ### 更正（2026-11-04）：上面的 89 与 104.5% 建立在有缺陷的口径上，不得再引用
>
> `action=="dispatch"` 在 **cap 已满的空转轮**也会写出（机制见 §口径定义 第一条警示）。**结构判据**：派发
> 只可能发生在 ready-pool 步之后（`worker-driver.ts:6663`），而该步跑过时 `pool` 必为数字
> （`readyPoolCheck` 返回 `pool: number`，`driver-runtime.ts:2887`；循环体抛错轮走 `action="error"`）
> ⇒ **`pool === null` ⟺ 本轮物理上不可能派发**。
>
> 复跑（与 AC3 同一窗口、同一载体）：
>
> ```bash
> python3 - <<'PY'
> import json
> W_START, W_END = '2026-10-26T00:00:00.000Z', '2026-11-02T00:00:00.000Z'
> lab = real = 0
> for line in open('.quay/worker-round.jsonl'):
>     line = line.strip()
>     if not line: continue
>     d = json.loads(line)
>     if not (W_START <= d.get('ts','') < W_END): continue
>     if d.get('action') == 'dispatch':
>         lab += 1
>         if d.get('pool') is not None: real += 1
> print('labelled dispatch =', lab, '| pool != null (real) =', real)
> PY
> ```
>
> | 量 | 原读数 | 更正后 |
> |---|---|---|
> | 标称 `action=dispatch` | 89 | 89（不变） |
> | 其中 `pool === null`（cap 满空转，结构上不可能派发） | 未测 | **72** |
> | 再并入第二判据（与同 run 上一轮 `in_flight` + `in_flight_tasks` 全同） | — | **74** |
> | 真实派发轮（上界） | 89 | **17**（严格界 15） |
> | 落地 / 可派发 tick | 93 / 89 = 104.5% | **93 / 17 = 5.47**（严格界 93 / 15 = 6.20） |
>
> 逐日更正（原 `25/23/15/3/10/1/12` → 真实 `6/1/4/1/3/0/2`）：`10-26:6, 10-27:1, 10-28:4, 10-29:1,
> 10-30:3, 10-31:0, 11-01:2`。
>
> **结论方向不变、且更强**：7 日内真实派发轮只有 17 轮，而落地 93 个 ⇒「派发供给是瓶颈，不是执行/落地
> 效率」仍是本报告的结论。但**原 104.5% 这个比值、以及为它给的"落地滞后于派发，横截面比值可以 >1"的解释
> 作废**——它们是把 cap 满的空转轮当成派发轮之后的事后合理化。缺陷任务：
> `gap-worker-round-action-field-conflates-dispatch-and-wait`。

- 7 日逐日可派发 tick（**标称值，含空转轮**）：`10-26:25, 10-27:23, 10-28:15, 10-29:3, 10-30:10, 10-31:1, 11-01:12`，日均 ≈ 12.7
  （**真实值 17 / 7 ≈ 2.4**，逐日见上方更正表）。
- **解读**：新分母暴露了真正的约束——7 日内只有 **17** 个 tick 真的派发了任务（占 0.25%），而落地数 93
  远高于派发轮数 ⇒ 派发供给是唯一瓶颈，不是执行/落地效率。（注：比值按轮计而非按任务计，故 >1 本身
  不构成矛盾；原 104.5% 的"落地追平派发"表述已随更正作废。）

---

## AC4 — 结论层：可用工作 = 0 时"执行效率优化"不可测

- **可用工作 = `todo`(0) + `ready` 且非在飞(0) = 0。** 执行当日的 5 个 `ready` 全部在飞
  （`.quay/worker-round.jsonl` 尾部 `in_flight_tasks` 恰为这 5 个 id：`gap-routine-file-gate-god-package-dedup-by-package-identity`、
  `gap-e1-baseline-window-ignored-by-rounds-e5`、`gap-effort-tiering-effect-unmeasured`、
  `gap-dispatch-supply-ceiling-vs-execution-efficiency`、`gap-prompt-inline-data-scan`）。
  派发器视角的可派发池为空。
- ⇒ **执行效率优化 = not-evaluated**：没有可执行的工作时，"每次会话耗时 / 每轮 token / suite p50"这些指标
  **没有分母**，任何读数都不可测。⛔ **不得用空闲率（pool-empty 占比 90%+）反推"执行变慢了"**——空闲率高
  是供给枯竭的结果，不是执行劣化的证据（硬规则 4 推论四：能解释现象 ≠ 被检验的结论）。
- **"可用工作 > 0 却长时间 pool-empty"在本窗口不成立**：`pool-empty` 是真实供给枯竭（`todo=0`、`ready` 全在飞），
  **不是被过滤器藏住了可用工作**。被过滤是另一个独立现象，且在本窗口确有一个对照日：
  - **2026-10-26**：`total=1148`，`filtered-empty=1123 (97.8%)`、`pool-empty=0`、`dispatched=25`（**标称值**；
    按 `pool !== null` 更正为 **6**——见 §AC3「更正」）。
    该日池里有候选，但被 `depsSatisfied` 过滤器挡住（抽样 `filter_trace` 首条：任务
    `gap-instrument-decay-postlanding-two-rounds`，`filter=depsSatisfied`，`blocker=None`）——
    这是**依赖未满足 / 派发争用**，不是执行慢，也不是供给枯竭。该日与近三日（pool-empty 主导）是两个不同象限，
    不可混为一种"空闲"。

---

## AC5 — 下一批工作从哪里来：生成层（routine 轨道），并明确不改门

**决策：优化预算落生成层，不是执行层、也不是 promotion 层。下一批工作来源 = 生成层（routine 轨道）。**

依据（执行当日直接读数，非推断）：
- 2026-11-02 当天 `gate=complete` 落地的任务里，routine 轨道在持续产出并落地：
  `gap-routine-semantic-dedup-scan-*`（13:00 / 13:12 / 14:08）与 `gap-routine-architecture-analysis-*`（13:23 / 14:11 / 14:16），
  actor 均为 `quay-driver`。
- 在飞的 `gap-routine-file-gate-god-package-dedup-by-package-identity` 本身就是 routine-file-gate 探针（产出新的 god-package 任务）。
- 生成层的机械载体是 `.quay/config.yml` 的 `loop.routines` 轨道（`self-validation` / `architecture-analysis` /
  `history-mining` / `browser-explorer` / `semantic-dedup-scan` / `freshness-refresh`），探针 filed 后经 promotion 门进入 ready 池。

**可执行判据（下一批工作从哪里来）**：
1. **主路径 = 生成层（routine 轨道）**：继续让 routine 探针按 interval 评估并 file 新 `status: todo` 任务，
   新任务经既有 promotion 门晋升 ready、进入可派发池。供给恢复的判据 = 滚窗内新 filed 的 todo/ready 任务数 > 0。
2. **升级触发（可测，不是"永远差最后一步"）**：若连续 24h 内 `.quay/routine-findings.jsonl` 无新 file
   **且** `tasks/*.md` 无新 routine 生成的 todo/ready 任务（两者都查，缺一不可），则判定生成层枯竭，
   **升级到人工注入**（human 手注下一批任务）——此时干预的是**供给**，不是执行机制。
3. **明确不变**：本条只产出本报告，**不改变任何派发、promotion、AC/DoD 门**；不新增常驻脚本；
   不把空闲当异常去修执行层。

---

## AC6 — `git diff --check` 与 Touches

- 改动范围：本报告（`docs/analysis/dispatch-supply-ceiling-2026-11-02.md`，new）+ 任务体（经 `task_write`，AC 勾选）。
- `git diff --check` 需 exit 0（提交前验证，见落地流程）。

---

## 附：全文件 stop_reason 分布（与 E1 基线对照）

> 全文件（`2026-08-23T07:18Z → 2026-11-02T14:53Z`，68859 tick）分类：

| 类 | 计数 | 占比 |
|---|---|---|
| pool-empty | 49411 | 71.76% |
| filtered-empty | 11180 | 16.24% |
| mcp-halt | 3810 | 5.53% |
| dispatched（标称，含 cap 满空转轮——见下） | 2685 | 3.90% |
| backoff | 939 | 1.36% |
| resource-gate-wait | 693 | 1.01% |
| idle | 141 | 0.20% |

> ⚠️ 同一条 `action` 缺陷影响本表：`dispatched` 的标称 2,685 中，按 `pool !== null` 只有 **1,521** 条
> 可能真的派发（56.6%）；按 `pool === null` 判为 cap 满空转的共 1,163 条。其余各类按 `stop_reason`
> 分类，不受影响。更正口径见 §AC3「更正」，缺陷任务
> `gap-worker-round-action-field-conflates-dispatch-and-wait`。

与 `docs/analysis/task-efficiency-baseline.md` E5 段（窗口至 2026-11-01）对得上：该报告
`pool-empty=48408` / `resource-gate-wait=691` / `mcp-halt=3810` / `filtered-empty=11136`；
本报告全文件窗口延伸到 11-02，`pool-empty=49411`、`filtered-empty=11180`、`resource-gate-wait=693`，
增量来自 11-01 后新增的 tick。两报告同源、互不矛盾。
