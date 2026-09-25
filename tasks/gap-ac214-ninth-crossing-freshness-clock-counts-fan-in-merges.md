---
id: gap-ac214-ninth-crossing-freshness-clock-counts-fan-in-merges
title: AC-214 第九次转红（AC-201/203/205/207/232 = 203/200，AC-238/239 = 251/200，7/7
  主体越界；连续 810 fail / 0 pass）：判据的「交付面提交距离」把 fan-in 记账 merge 计入 —— 84/203 与
  102/251 是幻影，同一个 develop 变更被重复计数，时钟由 loop 自己的分支拓扑驱动
status: ready
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Finding

**判据此刻为假（本轮两次独立复跑，⛔ 非引述）**：

- **跑 ①（常驻 goal-driver）**：`.quay/gate-events.jsonl` 最后一条 `item_id=AC-214`、`gate=goal` 的事件 `2026-09-25T04:36:19.016Z`，`verdict: "fail"`，payload.reason 逐字：

```
acceptance failed (exit 1) — stale evidence: GOAL-009-AC-201:203/200 (margin -3), GOAL-009-AC-232:203/200 (margin -3), GOAL-009-AC-205:203/200 (margin -3), GOAL-009-AC-207:203/200 (margin -3), GOAL-009-AC-203:203/200 (margin -3), GOAL-009-AC-238:251/200 (margin -51), GOAL-009-AC-239:251/200 (margin -51)
```

- **跑 ②（本轮按判据正文原样复跑，cwd = 主检出 `/data/home/yale/work/quay`）**：`EXIT=1`，stdout 七行逐字：

```
freshness GOAL-009-AC-201: 203/200 (margin -3)
freshness GOAL-009-AC-232: 203/200 (margin -3)
freshness GOAL-009-AC-205: 203/200 (margin -3)
freshness GOAL-009-AC-207: 203/200 (margin -3)
freshness GOAL-009-AC-203: 203/200 (margin -3)
freshness GOAL-009-AC-238: 251/200 (margin -51)
freshness GOAL-009-AC-239: 251/200 (margin -51)
```

载体 `.quay/productization-verification.jsonl` 共 **291** 行，末条 `ts = 2026-09-20T13:50:36Z`，`ts >= 2026-09-23` 的记录数 = **0**。

**这是回归，不是恒红**（`.quay/gate-events.jsonl`，`item_id=AC-214`、`gate=goal`，共 **5638** 条）：

- 最后一次 **pass** = `2026-09-24T02:46:28.774Z`（payload 逐字 `{"reason":"acceptance passed (exit 0)"}`）。
- 其后第一条 **fail** = `2026-09-24T02:48:24.110Z`，reason 逐字 `acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)`。
- 自该 pass 起至 `2026-09-25T04:36:19.016Z`：**fail = 810 / pass = 0**。

### 成因：`d` 把 fan-in 记账 merge 计入 —— 同一个 develop 变更被重复计数

判据的 `d` 逐字取自：

```python
out = subprocess.run(["git", "rev-list", "--count", sha + "..develop", "--"] + paths, ...)
```

带 pathspec 的 `rev-list` **把 merge commit 一并计入**；而本仓的 fan-in 拓扑使「task 分支把 develop 合进自己」成为每次落地的常规动作。实测（交付面路径按判据同一规则机械推导：`packages/quay/package.json` 的 `files` ∩ `exists` + `plugin` + `packages/quay-native/src`，⛔ 不手写清单）：

| 主体 | 最新记录 ts | build_sha | `all`(=判据的 d) | `--merges` | `--no-merges` | `--first-parent` | 幻影 = all − no-merges |
|---|---|---|---|---|---|---|---|
| AC-201 / 203 / 205 / 207 / 232 | `2026-09-20T13:50:36Z`（205 为 `13:23:10Z`） | `c80040ad49b3` | **203** | 84 | **119** | 76 | **84** |
| AC-238 / 239 | `2026-09-19T11:06:09Z` | `fa1cae202e02` | **251** | 102 | **149** | 98 | **102** |

merge 的题面分解（`git log --merges --format='%s' <base>..develop -- <paths> | sed -E "s/ into task\/.*//" | sort | uniq -c`）：

```
     82 Merge branch 'develop'
      1 Merge origin/develop (v0.10.0 release line) into release/v0.11.0
      1 Merge commit 'c7ab1b586229b55725b9009f36899b6da33a541d'
```

⇒ **82/84 是纯记账**：`Merge branch 'develop' into task/<X>` 只把 develop 已有的内容重新导入某个 task 分支；那些内容本来就已经作为**它们自己的**非 merge 提交被数过一遍。

**它凭什么叫「幻影」—— 不是推断，是按位置核出来的**（硬规则 4 推论四：给不出对照就只算假说）。对 `c80040ad..develop` 里全部 84 个 merge，逐个把它自己的 tree 与**两亲的干净自动合并**结果比：

```
$ git merge-tree --write-tree <M^1> <M^2>     # git 2.43.0
71/84  merge 的 tree 与自动合并结果**逐字节相同** ⇒ 该 merge 在交付面上一个字节的独立内容都没有
13/84  与自动合并结果不同（两侧改过同一文件、需人解冲突）⇒ 至多这 13 个可能带入内容
 0/84  自动合并冲突
```

⇒ 把 13 个全部按「带入了独立内容」计，`d` 的真值也在 **[119, 132]** 之间（`--no-merges` 得 119，加上至多 13 个 conflicted merge），**两种取值都 ≤ K=200**。

**⇒ 判据此刻之所以红，唯一的原因是这些幻影 merge。** 同一时刻的双向对照：

```
AS-IS   rev-list --count <base>..develop -- <paths>            => 203 / 251  (>200 ⇒ exit 1)
CONTROL 同上 + --no-merges                                      => 119 / 149  (≤200 ⇒ 转绿)
```

**它不是一次性的、也不是最近才出现的**：merge 占比在 1d / 3d / 7d / 14d / 30d / 60d 六个窗口上实测为 **29% / 45% / 41% / 43% / 51% / 40%** ⇒ 判据的时钟长期以约 **1.7×** 于交付面真实变更数的速度前进。

### 为什么这是缺陷，而不是一个策略选择（三条，各自可核）

1. **与判据自己的文字不符**：`expect` 写的是「`build_sha` 到 develop-tip 的【**交付面**提交距离】」。一个把 develop 重新导入 task 分支的 merge **不改变交付面内容**（71/84 已证零内容），却让这个「距离」+1。
2. **被测对象能自己推快这只钟**（硬规则 4：一个能自己推快的量不是测量）：loop 只要在 task 分支上多合几次 develop，`d` 就变大，**而交付面一个字节都没动**。⇒ 这个量不能用来回答「证据有多旧」。
3. **时钟由 loop 的活动驱动，负反馈反转成正反馈**：落地越多（每个任务带 1–4 个 `merge develop`）⇒ 证据越早被判陈旧 ⇒ routine 立案越频繁 ⇒ 派发越多。这正是过去 5 次转红反复描述的「窗口比设计假设短」的机制半边 —— AC 正文与探针自述都拿 **83 交付面提交/天** 当基线，而那个 83/天 是用**同一条含 merge 的规则**采样出来的 ⇒ 设计窗口本身也被同一个偏差污染。

**同一规则的第二处载体（硬规则 5b，⛔ 不是只改判据就完）**：`plugin/probes/freshness-refresh.md` ③ 让探针用**同一条命令**测 `R`（`git rev-list --count --since="7 days ago" develop -- <paths>`），再代入 `THRESHOLD_fraction(p) = (W_p + I) × R / K` ⇒ 阈值算术继承同一个约 1.7× 的偏差（方向是提早立案，安全但噪声大，且让「算出的 R」与它声称的「交付面推进速率」不是同一个量）。⇒ 两处必须同源。

### 为什么前 8 次修复没兜住（⛔ 不是那几条被证否）

七条 `done` 且顶层 `goal_ac: AC-214` 的任务修的是**可达性与通道**：产出侧写顶层 `build_sha`；主体集合改为机械推导并接线 AC-232/238/239；「本机可执行的产出者」升成规格声明并给出消费者；dedup 空间加 status 维度让 `done` 键不再永久封印主体；升级通道落 `needs-human`。**它们每一条的绿都是真的。** 但**没有一条看过「`d` 这个数是怎么算出来的」** —— 判据的计数规则从第一次落地起就没被当作被测对象。⇒ 硬规则 5b 的形态：缺陷是成簇的，前 8 次修的都是**同一句 expect 里的其它词**（「怎么产出」「谁能产出」「产不出怎么办」），剩下「**距离**」这一个词至今零检查。

### 并行阻塞（⛔ 不是本任务的 DoD，但必须如实摆在前面）

刷新 AC-201/203/205/207/232/238/239 的载体证据需要一台被 B（`orangevps.wan.hwang.men`）与 C（`ad-arm1.wan.hwang.men`）授权的主机；**本机不是**，且这是**回归**（本机 `~/.ssh/id_ed25519` mtime `2026-09-16`，而 `2026-09-19` 的运行还成功跑完了全部跨机传输）：

```
$ ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men true
yale@orangevps.wan.hwang.men: Permission denied (publickey,password).   # rc=255
$ ssh -o BatchMode=yes -o ConnectTimeout=8 yale@ad-arm1.wan.hwang.men true
yale@ad-arm1.wan.hwang.men: Permission denied (publickey).              # rc=255
```

<!-- dedup-ref -->
该阻塞**已有机制在管、且已到人面前**：7 个主体各自落了 `needs-human` 升级任务（例：`tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-8c2414da.md`），最近一轮 `freshness-refresh` 的 filing-round（`.quay/routine-findings.jsonl`，runId `freshness-refresh-1790310119306`，`2026-09-25T04:21:59.306Z`）逐条 `blocked-repeat` 拒绝重复立案。⇒ 本任务 ⛔ 不重复立案、⛔ 不把「AC 本体仍红」当作不修的理由（同第八次的写法）。这一条与本任务是**同一现象的两个不同机制**，⛔ 不构成依赖关系。

### ⛔ 本任务不做的事

⛔ 改 K（`QUAY_GOAL009_FRESHNESS_K` 是判据自己声明的旋钮，用它换绿就是**调表**）；⛔ 删主体 / 放宽 `expect` / 削弱判据；⛔ 手写、搬运或伪造任何证据记录；⛔ 只改判据不改探针；⛔ 只把读数写进 notes 散文；⛔ 把任何 AC 降格成夹具读数。

## Requested action

1. **把「交付面提交距离」的计数规则改成一个真正计内容的规则，并单源化。** 首选落点（⛔ 不新增 `plugin/scripts/*.ts`，避免连带三处登记：outline + `capability-catalog-declarations.json` + laydown）：在**已存在**的 `plugin/scripts/freshness-producer-coverage-check.ts` 里落一个可复用纯函数 + 一个 CLI 子命令（如 `--delivery-face-distance <from_sha>`），输出该距离与该规则的取值态。**判据（Python heredoc）以 `subprocess` 调它；探针 ③ 改为调同一条命令** ⇒ 两处逐字同源。若实现者判定必须新增脚本，则那三处登记必须一并进 `## Touches`。⚠️ 若最终选择「判据侧自带 Python 实现」，则替代物**不是**同一件事：必须同时落一个**机械一致性检查**（探针用的命令行与判据内的规则由同一声明派生，且该检查能把不一致判红）。
2. **规则本身**：`d` 数「自 `from_sha` 起、develop 上**实际改变了交付面内容**的提交」。实现必须 (a) 消除记账 merge 的重复计数；(b) 对**真正带入独立内容**的 merge（conflicted merge / 手工解的冲突）给出显式处置，并把取舍写进注释（⛔ 不靠「merge 一律不算」这句断言，要用 `git merge-tree --write-tree` 一类的按位置判据把该计的数计回来）；(c) 三态可区分（硬规则 3b）：**算得出** / **算不出**（`NOT-EVALUATED`，⛔ 不与 `0` 或与「合格」同形）。
3. **K ⛔ 一字不动**：`K=200` 保持，`QUAY_GOAL009_FRESHNESS_K` 仍是它唯一的旋钮；AC 正文声明的 30 天复核点（`2026-10-09`）才是重估 K 的地方，本任务 ⛔ 不提前动它。⇒ 规则修正后 `K=200` 对应的时间窗会比原来长（按实测 merge 占比约 1.7×）；**这个后果必须逐字写进 AC 正文**，⛔ 不得静默。
4. **绿灯不得被读成「刚复验过」**（本条的诚实半边）：`.quay/goal-freshness-margin.json` 的快照在既有 `k` / `at` / `subjects` 之外，追加**每个主体的证据墙钟年龄**与**最近一次产出者运行的时刻**（都由载体里的 `ts` 直接算出，⛔ 不引入第二个真相源）。⚠️ 纯显示：写入失败 ⛔ 不得把 pass 变成 fail（沿用既有 best-effort 写法）。
5. **判据正文里三个互相矛盾的数字一并对齐**（硬规则 5b 的兄弟实例，同一条原则的另一处载体）：`title` 说「四条」、`expect` 说「六条」（且只列到 AC-238）、代码 `NEED` 是 **7** 条（含 AC-239）。⇒ 三处必须指向**同一个来源**，⛔ 不手抄第二份。

## AC

- [x] AC1 改前读数（能取假，⛔ 引述不算、须复跑）：`node packages/quay/bin/quay.js goal gate AC-214 --dry-run --json` ⇒ `verdict: "fail"`，reason 逐字含 `GOAL-009-AC-201:203/200 (margin -3)` 与 `GOAL-009-AC-238:251/200 (margin -51)`；贴 stdout 七行 + `.quay/goal-freshness-margin.json` 全文 + 载体行数（291）与 `ts >= 2026-09-23` 计数（0）。

- [x] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl` 中 `item_id=AC-214 && gate=goal` 的最后一条 `pass`（`2026-09-24T02:46:28.774Z`）与其后第一条 `fail`（`2026-09-24T02:48:24.110Z`）两个时刻，以及自该 pass 起 **fail=810 / pass=0**（总事件 5638）。

- [x] AC3 成因具名到机件 + 判别式（双向对照）：用**真命令**算出并贴出七个主体的 `all` / `--merges` / `--no-merges` / `--first-parent` 四个数（须与上表逐字一致：`c80040ad` ⇒ 203/84/119/76，`fa1cae20` ⇒ 251/102/149/98）；贴 merge 题面分解（`82 Merge branch 'develop'` 那一行）；贴 `git merge-tree --write-tree` 的 **71 / 13 / 0** 三个计数与其命令逐字；贴双向对照 AS-IS（203 ⇒ exit 1）与 CONTROL（119 ⇒ 绿）两次实跑。

- [x] AC4 落地机制 + 单源 + 三态可区分 + 探针侧同源：给出新规则的 `file:line`；判据与探针**逐字同一条命令**（贴两处调用行）；三态各自可区分（正常 / `NOT-EVALUATED` 各有独立取值，且都不是 0 或空）；探针侧 `R` 的改前 / 改后两个读数（同一窗口）一并贴出。

- [x] AC5 双向负控制 + 变异检验（每臂各自能取假）：① 一个**真正带入独立内容**的 merge（两侧改同一文件后解冲突，夹具自建）⇒ **必须仍被计入**；② 一个纯记账 `merge develop` into task 分支 ⇒ **不得被计入**；③ 把规则改坏（退回含 merge 的旧计数）⇒ 对应用例**红**（贴变异检验输出）。

- [x] AC6 不变量已核：`K=200` 未被改动（贴 `grep -n "FRESHNESS_K\|K = " goals/AC-214-*.md` 的前后对照）；后果（时间窗按实测约 1.7× 变长）已逐字写进 AC 正文；快照新增的两个直接量**在载体里可见**（贴新快照全文），且注入一次写失败时判据仍 exit 0（⛔ 不把 pass 变 fail）；`title` / `expect` / `NEED` 三个数字已对齐到同一来源。

## DoD

- [x] 判据用**新规则**在**当前主检出**上真跑一次（⛔ 不是夹具、⛔ 不是 `--selfcheck`）：exit 0，stdout 七行里每个主体的 `d` 与 AC3 贴出的正确规则读数一致；`.quay/goal-freshness-margin.json` 里两个新增直接量字段可见。
- [x] 变异检验已做且能取假：把规则换回含 merge 的旧计数 ⇒ 同一条命令 exit 1（证明判据仍能转红，⛔ 不是恒绿、⛔ 不是靠削弱判据换来的绿）。
- [ ] 探针侧同源已在生产载体上生效：贴一次真实探针运行实际用的命令，与判据内逐字相同（⛔ 不是「文档改好了」）。⛔ 本 worker 证不了这一条：一次由例程轨道驱动的真实探针运行由**落地后的常驻轨道**在下一个 interval 产出（⛔ 不在本 worker 的取证面内）；本 worker 已证的是「探针实际用的那一条命令行 == 判据内那一条」（机械钉住 + 该行在真仓真载体上实跑出声明形态的 JSON）（待外部）
- [x] ⛔ 不变量：K 未改；7 条主体一条未删；`expect` 未削弱；证据记录未手写或搬运；`## Touches` 之外零写入。
- [x] 如实声明：本任务 ⛔ 不刷新任何主体。AC-214 转绿只说明「**按判据自己的规则算**，证据仍在窗口内」，⛔ 不说明「最近跑过产出者」—— 后者由新增的墙钟年龄字段如实呈现（当前：最近一次产出者运行 `2026-09-19T11:06:09Z`），且该跨机阻塞仍由 `needs-human` 升级通道在管。

## Touches

- `goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md`
- `plugin/scripts/freshness-producer-coverage-check.ts`
- `plugin/probes/freshness-refresh.md`
- `plugin/freshness-producers.json`
- `plugin/test/freshness-distance-counting.test.mjs`
- `tasks/gap-ac214-ninth-crossing-freshness-clock-counts-fan-in-merges.md`

## Evidence（本 worker 的取证；⛔ 未刷新任何主体、⛔ 未改 K）

**取证面（诚实标注，⛔ 不把「落地后自动发生的事」写成已发生）**：改后那次判据实跑在**任务工作树内**完成
（cwd = 工作树），其**三个输入逐项核过与主检出相同**：① `develop` 是同一个 ref（两处 `git rev-parse develop`
逐字 `8f8aa167407b880d82568d0f08448225a187ee50`）；② 载体是同一个文件（工作树内
`.quay/productization-verification.jsonl` 是指向主检出权威文件的 **symlink**，md5 两侧同为
`3617e696d0d374bc140d0938c106b9a1`，291 行）；③ 代码 = develop + 本任务 delta。
⛔ **未做、也不由本 worker 做**：**主检出 cwd 上的**改后实跑 —— 主检出此刻没有新代码（它的
`plugin/` 是旧版），**fan-in 落地后由常驻 goal-driver 每轮自动产生**。AC1 的**改前**读数则是在主检出 cwd
（逐字按 AC 正文那条命令）跑的。

### AC1 改前读数（主检出 cwd，`/data/home/yale/work/quay`，改动前）
`node packages/quay/bin/quay.js goal gate AC-214 --dry-run --json` ⇒ **EXIT=1**，`verdict: "fail"`，
`reason` 逐字含 `GOAL-009-AC-201:203/200 (margin -3)` 与 `GOAL-009-AC-238:251/200 (margin -51)`。
判据 stdout 七行逐字：
```
freshness GOAL-009-AC-201: 203/200 (margin -3)
freshness GOAL-009-AC-232: 203/200 (margin -3)
freshness GOAL-009-AC-205: 203/200 (margin -3)
freshness GOAL-009-AC-207: 203/200 (margin -3)
freshness GOAL-009-AC-203: 203/200 (margin -3)
freshness GOAL-009-AC-238: 251/200 (margin -51)
freshness GOAL-009-AC-239: 251/200 (margin -51)
```
`.quay/goal-freshness-margin.json` 全文（改前，无新增字段）：
```json
{"at": "2026-09-25T04:48:13Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 203, "margin": -3}, "GOAL-009-AC-203": {"K": 200, "d": 203, "margin": -3}, "GOAL-009-AC-205": {"K": 200, "d": 203, "margin": -3}, "GOAL-009-AC-207": {"K": 200, "d": 203, "margin": -3}, "GOAL-009-AC-232": {"K": 200, "d": 203, "margin": -3}, "GOAL-009-AC-238": {"K": 200, "d": 251, "margin": -51}, "GOAL-009-AC-239": {"K": 200, "d": 251, "margin": -51}}}
```
载体 `.quay/productization-verification.jsonl` **291 行**；`ts >= 2026-09-23` 的记录数 = **0**
（末条 `ts = 2026-09-20T13:50:36Z`）。原始输出：`.quay/ac214-9th/ac1-before*`。

### AC2 回归而非恒红
`.quay/gate-events.jsonl` 中 `item_id=AC-214 && gate=goal`：最后一条 **pass** =
`2026-09-24T02:46:28.774Z`（payload 逐字 `{"reason":"acceptance passed (exit 0)"}`）；其后第一条 **fail** =
`2026-09-24T02:48:24.110Z`（reason 逐字 `acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)`）。
自该 pass 起：**fail = 813 / pass = 0**（总事件 **5641**）。⚠️ 任务题面写的是 `810 / 5638` —— 那是同一
单调 streak 的**更早一刻**的读数（两锚点时刻逐字相同）；本会话取证期间常驻 loop 又推进了 3 轮。

### AC3 成因具名到机件 + 双向对照（真命令，`git 2.43.0`）
四个数逐字（与题面表格一致）：

| 主体 | build_sha | `all` | `--merges` | `--no-merges` | `--first-parent` |
|---|---|---|---|---|---|
| AC-201/203/205/207/232 | `c80040ad49b3…` | **203** | **84** | **119** | **76** |
| AC-238/239 | `fa1cae202e02…` | **251** | **102** | **149** | **98** |

merge 题面分解（`git log --merges --format='%s' <base>..develop -- <paths> | sed -E "s/ into task\/.*//" | sort | uniq -c`）：
```
     82 Merge branch 'develop'
      1 Merge commit 'c7ab1b586229b55725b9009f36899b6da33a541d'
      1 Merge origin/develop (v0.10.0 release line) into release/v0.11.0
```
`git merge-tree --write-tree <M^1> <M^2>` 与 `<M>^{tree}` 逐字节比对（84 个 merge）：

- **71** — tree 与两亲的**干净自动合并逐字节相同** ⇒ 该 merge 在交付面上零独立内容；
- **0** — 干净自动合并存在但与记录 tree 不同（evil merge）；
- **13** — **不存在**干净自动合并（两侧改同一文件、由人解冲突）。

⚠️ **对题面表格标签的按位置更正**：题面把三项写成「71 identical / 13 differ / 0 conflict」，实测的
13 正是**无干净自动合并（conflict）**的那批、而「干净但不同」是 **0** —— 三个数一样，归属不同。两臂
（conflict 与 evil merge）在规则里**都被计入**，所以结论不变。

双向对照（同一交付面路径集）：

```
AS-IS   git rev-list --count c80040ad..develop -- <paths>        => 203  > 200  ⇒ exit 1（第九次转红）
CONTROL 同上 + --no-merges                                        => 119  <= 200 ⇒ 绿
NEW RULE <delivery_face.command> --from c80040ad --json           => 132  <= 200 ⇒ exit 0
```

### AC4 落地机制 + 单源 + 三态 + 探针侧同源
规则唯一实现在 `plugin/scripts/freshness-producer-coverage-check.ts`：`deriveDeliveryFacePaths`:369、
`classifyMergeContribution`:395、`deliveryFaceDistance`:404、`measureDeliveryFaceDistance`:438。
两处调用行**同源**（判据**读**声明，探针渲染声明；`plugin/test/freshness-distance-counting.test.mjs` ⑥ 钉住）：

- 判据（`goals/AC-214-*.md` 内）：`DCMD = json.load(open("plugin/freshness-producers.json", …))["delivery_face"]["command"]`
  → `subprocess.run(DCMD + ["--from", sha, "--json"], …)`
- 探针（`plugin/probes/freshness-refresh.md:114`）：
  `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --since "7 days ago" --json`
  （== `delivery_face.command` 的渲染 + 窗口参数）

三态（同一次实跑，退出码各自可区分）：`--from <develop-tip>` → `state:"computed"`, `distance:0`, exit 0；
`--from 000…0` → `state:"not-evaluated"`, `distance:null`, exit 3；无 `packages/quay/package.json` 的仓 →
`state:"empty-path-set"`, `distance:null`, exit 3。⇒ **0 是合法读数、「读不出」不是 0**。

探针 `R` 改前 / 改后（**同一窗口** `--since "7 days ago"`，同一时刻）：改前
`git rev-list --count --since="7 days ago" develop -- <paths>` = **361**；改后同一条声明命令 = **234**
（`content-commits=211, content-merges=23, bookkeeping-merges=127`）⇒ 窗口内 127 个记账 merge 是幻影。

### AC5 双向负控制 + 变异检验（每臂各自能取假，夹具自建 git 仓）
① **真正带入独立内容的 merge**（两侧改同一文件 → 解冲突）：被计入 —— 夹具读数 `distance=4`（3 非 merge
+ 1 content merge）；若误改成「merge 一律不算」会读 3 ⇒ 本断言会红。
② **纯记账 `merge develop` into task 分支**：不被计入 —— 夹具读数 `distance=2`（naive 同仓 = 3，
差的正是那一个记账 merge）⇒ 旧规则下的幻影在夹具里可见。
③ **变异检验**：把 `classifyMergeContribution` 打回「每个 merge 都算 content」（旧计数）⇒ 同一夹具读
**3**，即 ② 的断言转红（变异脚本自带 anchor 校验，⛔ mutation 不会静默失效）。
判据层面的同一变异（把声明指向变异体）：K=2 时真声明 **exit 0**、变异声明 **exit 1** 且 stderr
`stale evidence: …:3/2 (margin -1)` ⇒ **改声明就改判据**，单源是活的。

### AC6 不变量
- **K 一字未动**：`K = int(os.environ.get("QUAY_GOAL009_FRESHNESS_K", "200"))` 改前/改后逐字相同
  （`git show 3be82c39f^:<goal>` vs `git show HEAD:<goal>`），仍是唯一旋钮。
- **1.7× 后果已逐字写进 AC 正文**（goal 记录的 body）：同一 7 天窗口实测旧 361 / 新 234（1.54×）、
  30 天窗口 merge 占比 51% ⇒ 同一个 K=200 现在对应约 1.7 倍长的墙钟窗口。
- **快照新增两个直接量可见**（改后实跑）：`producer_latest_ts: "2026-09-20T13:50:36Z"` 与每个主体的
  `evidence_ts` / `evidence_age_hours`（111.03 / 111.49 / 137.77 h）—— 都由载体 `ts` 直接算出。
  ⚠️ 题面 DoD 括注的 `2026-09-19T11:06:09Z` 是 **upgrade-face 产出者自己那一次**（AC-238/239，七条里
  最旧的一条），⛔ 不是「最近一次产出者运行」；按同一规则算出的最近一次是 `2026-09-20T13:50:36Z`
  （载体末条）。两者都在快照里可区分。
- **写失败注入**：把 `.quay/goal-freshness-margin.json` 换成目录 ⇒ 判据 **exit 0**、stderr 只有
  `WARN: freshness margin snapshot not written: [Errno 21] Is a directory: …` ⇒ ⛔ pass 不变 fail。
- **三个数字对齐到同一来源**：`expect` ⛔ 不再复述条数、判据注释 ⛔ 不再写「6 条/四条」，
  **唯一来源 = 判据内那一行 `NEED`**（7 条）；goal body 里「四条」保留但标注为**当时**的四条并指向 NEED。

### DoD
新规则在真仓（develop ref + 真载体，见顶部取证面）实跑：**exit 0**，七行 `d` = 132/132/132/132/132/164/164，
与 AC3 贴出的正确规则读数一致；快照两个新字段可见（上）。
变异（= 旧计数）：判据层面 exit 1（`…:3/2 (margin -1)`）；真仓层面 K=132 时 exit 1
（`stale evidence: …:164/132`）⇒ **仍能转红**，⛔ 不是恒绿、⛔ 不是削弱判据换来的绿。
⛔ 不变量：K 未改、7 条主体一条未删、`expect` 未削弱、证据记录⛔未手写或搬运、**tracked 面零 Touches 之外写入**
（原始取证文件落在**未跟踪**的 `.quay/ac214-9th/`，与仓内既有 `.quay/ac214-*` 同族）。
**如实声明**：本任务 ⛔ 不刷新任何主体。AC-214 转绿只说明「按判据自己的规则算，证据仍在窗口内」，
⛔ 不说明「最近跑过产出者」—— 快照的墙钟年龄字段如实显示最新证据已 **111–138 小时**旧，跨机阻塞仍由
既有 `needs-human` 升级通道在管（⛔ 本任务不重复立案）。

### 顺手按位置发现的两个机件缺陷（⛔ 本任务 Touches 之外，故只报不改）
1. **`goal-store` 的提交在 `/home/yale` 软链路径下静默失败**：`resolveGitRoot(goalDir)` 返回
   canonical 路径（`/data/home/...`）而 `goalDir` 是调用方给的 `/home/...` 路径 ⇒ `path.relative`
   产出 `../../../…` ⇒ `git add` 失败 ⇒ **文件已落盘但不在任何分支历史上**（本次实测：
   `goal-store: commit of "AC-214" failed …`；用 canonical `--root` 重跑即正常提交）。工作树路径按
   prompt 惯例走 `/home/yale/...`，因此任何从该路径发起的 goal/meta store 写入都会命中。
2. **AC 勾选的落地位置**：`plugins` MCP 服务进程的 cwd 是**主检出**（实测
   `/proc/<quay mcp pid>/cwd` = `/data/home/yale/work/quay`），而 AC 勾选被 store 判为 `self-only`
   ⇒ 在主检出根上勾选**不会** ff 到 develop，fan-in 的 `acShortCircuitVerdict`（读 工作树 ∪ develop）
   看不到它；且会让 author 领先 develop 一个提交、使 `syncDevelopToDoc` 的 `--ff-only` 失败。
   本次因此在**工作树根**用 Provider ABI（`quay-native task edit <id> --body-file…` 的同一 store 写路径）
   落勾选 ⇒ 提交落在 `task/<id>` 分支，正是该分类注释所声明的路径。

**原始取证文件**（未跟踪，`.quay/ac214-9th/`）：`ac1-before.json`、`ac1-stdout.txt`、`ac1-before.stderr`、
`new-criterion.sh`、`after-stdout.txt`、`after-snapshot.json`、`inject-stderr.txt`、`ac3-evidence.txt`、
`ac3-control-ac4-sites.txt`、`probe-R-before-after.txt`、`probe-line-run.txt`、`k-before.txt`、`k-after.txt`、
`scoped-gate.log`、`build-body.mjs`。