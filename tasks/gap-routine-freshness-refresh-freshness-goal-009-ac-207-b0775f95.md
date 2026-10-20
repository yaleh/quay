---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-207-b0775f95
title: "freshness-refresh: Same run, same window: AC-207 shares the coldstart
  face's 173-commit distance and 179.52h-old evidence; it crosses at the same
  threshold as its siblings."
status: done
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
Same run, same window: AC-207 shares the coldstart face's 173-commit distance and 179.52h-old evidence; it crosses at the same threshold as its siblings.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792489168017` · ts `2026-10-20T09:39:28.017Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`GOAL-009-AC-207`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- `plugin/freshness-producers.json:148`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on this host against hosts B and C (both ssh-authorized, reachability rc=0) supplying a target-recognized --driving-profiles

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-207`（routine `freshness-refresh`，runId `freshness-refresh-1792489168017`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【修掉】：finding 指向的「AC-207 证据陈旧（d=173 / margin 27）」已被同一轮 `coldstart-face` 产出者运行刷新 ——
`GOAL-009-AC-207` 在 B、C 两台验证机上都落了 `build_sha=ce13d764f90b` 的新记录，ts 分别晚于 finding 立案 **8.9 / 24.0 分钟**；
本轮判据实跑读数 **`0/200 (margin 200)`**。**
⛔ 不是「已注意到」。下面每一格都是本轮当场从载体/日志取出的读数（⛔ 不是转述兄弟任务的散文）。

### ① 复核：finding 的三条断言逐条复现（案由成立）

载体 `.quay/routine-findings.jsonl` **第 2825 行**（routine `freshness-refresh`，runId `freshness-refresh-1792489168017`，ts `2026-10-20T09:39:28.017Z`）中 findingId `freshness-goal-009-ac-207` 的逐字记录：

> "findingId":"freshness-goal-009-ac-207","dupKind":"stale-subject","subject":"GOAL-009-AC-207","symbols":["coldstart-face","GOAL-009-AC-207"],"files":[".quay/goal-freshness-margin.json:1",".quay/productization-verification.jsonl","plugin/freshness-producers.json:148"],"verdict":"act-now","rationale":"Same run, same window: AC-207 shares the coldstart face's 173-commit distance and 179.52h-old evidence; it crosses at the same threshold as its siblings.","margin":27

| finding 的断言 | 本轮读数 | 复现方式（同一谓词、同一载体） |
|---|---|---|
| `d=173` | **`distance=173`**（`contentCommits=171` + `contentMerges=2`；92 条记账 merge 被剔除） | `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from 61a1ebb0600f --tip 9ed53e81e`（`9ed53e81e` = 立案时刻的 develop tip，即三条 promotion 翻转之前那个提交；对 `792659a48^` 同样得 173） |
| 最新证据 `ts=2026-10-12T22:06:56Z`（`179.52h old`） | 立案前最新 AC-207 记录 = `ts=2026-10-12T22:06:56Z`、`build_sha=61a1ebb0600f49269849d18757232fd8dfb28a13`、host `instance-20221019-1509`(C)、`project_root=/home/yale/quay-verify-coldstart-61a1ebb0-root`；按两个 ts 复算 **179.54h**（与 finding 的 179.52h 差 0.02h ≈ 80s，即探针在 168.5s 扫描内的取样点，非口径差异） | enumerate `.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-207"` 的全部 **22** 条，按 `ts` 排序取立案前最新 |
| `margin 27` | `K=200 − d=173 = 27`；阈值 `(W+I)×R/K` 逐字代入 `coldstart-face.wallclock_hours=0.34`、`I=2.0`、`R=13 c/h`：`(0.34+2.0)×13/200 = 30.42/200 = 0.1521 > 27/200 = 0.135` | `K` 读 `.quay/goal-freshness-margin.json` 的 `"k":200`；`W` 读 `plugin/freshness-producers.json:143` |

⇒ 案由成立（⛔ 不是引述，三个方向都从载体本体重取）。

### ② 处置：Requested action 的那次 `coldstart-face` 运行已经发生，且 AC-207 在其覆盖范围内

`plugin/freshness-producers.json`：`coldstart-face.command`（`:142`）就是 finding 要求的
`bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout> --driving-profiles <profile-the-target-host-gateway-serves>`；
其 `subjects`（`:148` —— 正是 finding 引用的行）逐字含 `"GOAL-009-AC-207"`（`:151`）
⇒ 该运行**必然**刷新本主体，无需为 AC-207 单独再跑一遍。

本轮从远端日志载体核对到的那次运行（`build_sha=ce13d764f90b…`）：

- `.quay/verify-coldstart-remote-B-ce13d764.log`：`:2` `ts=2026-10-20T09:48:21Z`；
  `:14` `target-profiles: configured (launcher=claude-fjdac model=deepseek-v4-pro-anthropic auth=token → /home/yale/quay-verify-coldstart-ce13d764-root/.quay/profiles.yml)`
  —— 这正是 `preconditions[0]` 要求的「目标主机网关认得」的 profile（⛔ 不是驱动方那个 `v4.1flash-anthropic`）；
  `:57` `ac207 record written → /home/yale/quay-verify-coldstart-evidence-ce13d764.jsonl`；`:144` `VERIFY-RC 0`。
- `.quay/verify-coldstart-remote-C-ce13d764.log`：`:2` `ts=2026-10-20T10:03:31Z`；`:14` 同一 profile 行；
  `:62` `ac207 record written → …`；`:149` `VERIFY-RC 0`。

⇒ finding 的 Requested action（对 B/C 实跑并给目标认得的 `--driving-profiles`）已由该次运行达成。
⛔ 本任务不把「运行已经发生」写成「本轮我跑了」——本轮做的是复核 + 载体取证。

### ③ 载体侧读数：AC-207 的两条新记录都晚于 finding 立案时刻

`.quay/productization-verification.jsonl`（当前 **394** 行，`md5 e673ea51dfd1478277ced59e46a7157c`）中
`ac == "GOAL-009-AC-207"` 共 **22** 条，最后三条：

| ts | build_sha | host | 与 finding ts 的关系 |
|---|---|---|---|
| `2026-10-12T22:06:56Z` | `61a1ebb0600f…` | `instance-20221019-1509` (C) | 立案前最新（179.54h 旧） |
| `2026-10-20T09:48:21Z` | `ce13d764f90b…` | `orangevps` (B) | **+8.9 min** |
| `2026-10-20T10:03:31Z` | `ce13d764f90b…` | `instance-20221019-1509` (C) | **+24.0 min** |

两条新记录均 `task_status=done gates_events=1 produced_by_driver=true`，
`project_root=/home/yale/quay-verify-coldstart-ce13d764-root`（与 ② 的 B/C 日志同一运行）。

### ④ 处置后读数（同一谓词、同一载体）

判据本体（`goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md` 的 `criterion:` 折叠块，
用 pyyaml 逐字取出后实跑，cwd = 主检出）：

```
before（finding 的读数，① 已用同一 distance 实现复现）:  freshness GOAL-009-AC-207: 173/200 (margin 27)
after （本轮实跑 2026-10-20T10:25Z，EXIT=0）:            freshness GOAL-009-AC-207:   0/200 (margin 200)
```

同一轮七行逐字（after）：`AC-201 0/200`、`AC-232 0/200`、`AC-205 173/200 (margin 27)`、
`AC-207 0/200 (margin 200)`、`AC-203 0/200`、`AC-238 135/200 (margin 65)`、`AC-239 135/200 (margin 65)`。

`.quay/goal-freshness-margin.json`（本轮判据自己写，`at=2026-10-20T10:25:48Z`）逐字摘录：

```
"GOAL-009-AC-207": {"K":200,"d":0,"evidence_age_hours":0.37,"evidence_ts":"2026-10-20T10:03:31Z","margin":200}
"producer_latest_ts": "2026-10-20T10:03:31Z"
```

**距离复核（同一实现）**：`--delivery-face-distance --from ce13d764f90b --tip develop` ⇒ **`distance=0`**
（新证据就是运行起点的 develop tip；其后的 task 记账提交不触碰交付面）；
对照 `--from 61a1ebb0600f --tip develop` ⇒ 仍是 **173**
⇒ 读数前进来自**新证据**，⛔ 不是快照被重置。

**反方向对照（⛔ 用于排除「整个快照被刷新」这一解释）**：同一快照里 `GOAL-009-AC-205` 仍为
`d=173 / margin 27`（其产出者 `session-delivery` 有自身前置）、`GOAL-009-AC-238/239` 仍为
`d=135 / margin 65`（另一条产出者 `upgrade-face`）。

### ⑤ 为什么本轮没有为 AC-207 再跑一次产出者（⛔ 不是省略，给出判据）

1. 判据本体已取到 `d=0 / margin=200`（④）；再跑只会给载体追加同 `build_sha` 的**重复**记录，
   不改变任何读数（硬规则 4 推论三：判据读的是生产载体，不是运行次数）。
2. finding 的 Requested action 目标是【刷新该主体的证据】；该目标已由 ② 的同一次运行达成，
   而 AC-207 是该运行 `subjects` 里的声明覆盖主体。
3. 重复跑要再动两台远端主机约 30 分钟，并稀释 `.quay/productization-verification.jsonl` 的可读性。
   ⇒ 本轮**不重复执行**；若后续再变陈旧，下一轮例行立案会照常触发（freshness-refresh 例程仍在）。

### ⑥ ⛔ 本任务未改 `plugin/freshness-producers.json`（该文件虽在 Touches 内），逐条说明

本轮复核没有发现它对 AC-207 有任何失真：

- **`command`（`:142`）**：与 ② 那次运行实际使用的命令一致（含 `--driving-profiles` 位）⇒ ⛔ 无需改。
- **`subjects`（`:148`，finding 引用的行）**：逐字含 `"GOAL-009-AC-207"`（`:151`）⇒ 无归属缺口。
- **`preconditions[0]`**：说的正是「必须给目标主机网关认得的 profile」；这次运行给了
  `deepseek-v4-pro-anthropic` 并成功 ⇒ 现状正确，⛔ 无新前置可登记。
- **`wallclock_hours: 0.34`（`:143`）**：该量是**全局阈值输入**（`THRESHOLD=(W+I)×R/K`），
  改动会同时移动七个主体的立案点；本轮没有取到「它现在为假」的判据 ⇒ ⛔ 不做单源改动（硬规则 12）。

### ⑦ 附：同一轮 finding 把同一条命令立成了三条任务

`freshness-refresh-1792489168017` 一轮 `filed=[ac-203, ac-207, ac-232]`，三者同属一条 `coldstart-face`
命令 ⇒ 一次运行即可全部覆盖，AC-207 的处置天然是「随那次运行一起完成」。
去重/限流逻辑在 `plugin/scripts/probe-routine.ts` / `routine-file-gate.ts`，⛔ 不在 Touches 内，记录不处置。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-207-b0775f95.md`