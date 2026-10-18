---
id: gap-ac262-criterion-tz-blind-timestamp-comparison
title: AC-262 判据第三支把 UTC "Z" 载体 ts 与 git %cI 的 +08:00 落地时刻做字典序比较 ⇒ 落地后真实 10
  轮被静默排除、判据恒假：改为 fromisoformat→epoch 瞬时比较 + 时区盲比较防复发检查
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-262
---
**type:** execution

## Proposal

**本轮逐字实测（2026-10-18，直接量，不是账本尾读）**：AC-262 判据本体 exit 1，唯一翻假的是第三支——

```
AC-262: carrier .quay/goal-round.jsonl holds 0 rounds after the B2 landing commit (2026-10-18T22:01:56+08:00) and none with a non-failed goal-ring => the ring still breaks in production, which is the whole point of B2
CRITERION_EXIT=1
```

把两个时刻都解析成瞬时（epoch）后，**同一份载体**里有 10 轮落在落地之后，且 goal-ring 全部 `verified`：

```
land raw: 2026-10-18T22:01:56+08:00 => epoch 1792332116.0
physically-after-landing rounds: 10
2026-10-18T14:07:37.135Z round=121 ring=[('verified', '34 criteria gated, 0 flip(s): ...')]
2026-10-18T14:13:28.242Z round=122 ring=[('verified', ...)]
2026-10-18T14:20:18.955Z round=123 ring=[('verified', ...)]
2026-10-18T14:26:21.427Z round=124 ring=[('verified', ...)]
2026-10-18T14:32:39.263Z round=125 ring=[('verified', ...)]
2026-10-18T14:38:29.962Z round=126 ring=[('verified', ...)]
2026-10-18T14:44:51.201Z round=127 ring=[('verified', ...)]
2026-10-18T14:50:50.745Z round=128 ring=[('verified', ...)]
2026-10-18T14:57:08.569Z round=129 ring=[('verified', ...)]
2026-10-18T15:03:14.520Z round=130 ring=[('verified', ...)]
non-failed count: 10
```

**根因（按位置判定，硬规则 2）**：`goals/AC-262-*.md` 第 48 行是

```python
if not ts or ts <= land: continue
```

它对两个 ISO-8601 **字符串**做字典序比较。载体 `.quay/goal-round.jsonl` 的 `ts` 是 UTC（首条 `2026-09-06T19:12:38.978Z`，末条 `2026-10-18T15:03:14.520Z`），而 `git log -1 --format=%cI -- packages/quay/src/cli/goal.ts` 返回带本地偏移的 committer date（`2026-10-18T22:01:56+08:00`）。两者是同一时间轴上的不同方言：`2026-10-18T14:07:37Z` **晚于** `2026-10-18T14:01:56Z`（即 `22:01:56+08:00`），但字典序比较在小时位读到 `'1' < '2'` 就把它判成更早 ⇒ 落地后当天的所有轮次被静默排除。**保证没坏，是度量器读不懂输入**——硬规则 3b 的教科书形态：读不懂的输入被算成「0 轮」，与「生产上没实现」输出同形。

**另两支本轮实测是过的**（不是推断）：经 vendored bundle（两个覆盖变量 unset）跑 `goal gate` / `goal check --staleness` / `goal batch`，stderr 均无 `unknown goal subcommand`；`goal-driver.ts` 与 `meta-driver.ts` 剥掉 `//` 行注释后 `packages/quay/src` 命中 **0**。把第三支的比较改成瞬时比较后，同一判据在真实载体上 **exit 0**（`FIXED_EXIT=0`）。⇒ 本任务不是放宽判据，是让判据读到它本来就该读到的生产事实。

**同族普查（硬规则 5b，全量扫 `goals/*.md` 的 criterion，跳过 superseded/retired）**：谓词 = 含 `%cI` 或 `git log --format` ∧ 存在 `ts`↔`land|since` 的字典序比较 ∧ 无 `fromisoformat`/`Date.parse`/`getTime()`/`timestamp()` 归一化。**恰好命中 1 条：AC-262**。AC-266 / AC-267 / AC-268 含同形 `ts > land` 代码，但 status 均为 `superseded`（显式退出复验，不在本任务范围；⛔ 不是漏修）。AC-317 是本仓已存在的正确先例：`datetime.fromisoformat(str(r["ts"]).replace("Z","+00:00"))` 与 `since` 比较——修法有正本形状，不是发明新范式。

**为什么上两次修复没顶住（本任务要补的那一半）**：`gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache`（done）修的是①CLI 动词与②driver argv；`gap-goal032-verdict-parse-direct-import-regresses-ac262`（done）修的是②源文本字面量。两者都没有、也无法覆盖第三支的**时间比较方言**。三支里只有第三支读生产载体，而它的读取谓词本身带时区盲点 ⇒ 前两支越绿，第三支越稳定地假红。这也解释了 AC-262 在 2026-09-15 曾记 achieved、之后 ledger 尾一直 fail：生产侧从未停止产出合格轮次，是判据窗口读不到它们。

<!-- dedup-ref -->
去重结论：按机制（「判据把两个不同时区方言的 ISO 串做字典序比较」）检索任务库，无在飞重复；`gap-goal032-verdict-parse-direct-import-regresses-ac262` 与 `gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache` 均 done，且机制不同（源文本/argv，不是时间比较）。`task-granularity-advice` 对本 Touches 报 `peers: []`，独立立案。

## Evidence

（filing 轮读数，全部本轮实测，供 worker 复验起点）

**E1. 判据本体 exit 1 的唯一成因**：见 Proposal 第一段；第三支诊断原文逐字引用。

**E2. 物理时间对照**：`land` = `2026-10-18T22:01:56+08:00`（commit `542c990cb`，`git log -1 --format=%cI -- packages/quay/src/cli/goal.ts`）；10 轮 ts 从 `2026-10-18T14:07:37.135Z` 到 `2026-10-18T15:03:14.520Z`，全部 `goal-ring.state = verified`。字典序比较把这些全部排除，因为 `'14' < '22'`。

**E3. 修复后原型读数**：把比较替换为 `datetime.fromisoformat(ts.replace("Z","+00:00")).timestamp() <= datetime.fromisoformat(land).timestamp()` 后，同一判据 `FIXED_EXIT=0`（`seen=10, ok=10`）。

**E4. 另两支**：`goal gate` rc=2（缺 `<id>`，无 `unknown goal subcommand`）、`goal check --staleness` rc=1 / `goal batch` rc=1 且 stderr 均无 `unknown`；arm2 源文本命中 `0`。

**E5. 同族扫描**：live 判据中命中 1 条（AC-262）；AC-266/267/268 `status: superseded`。`.quay/ci-runs.jsonl` 的 `ts` 同样是 `Z` 方言（`2026-10-18T14:08:16Z`），说明这不是 goal-round 一个载体的偶发现象。

**E6. 载体与 bundle 的可达性**：`plugin/vendor/quay/dist/quay.js` 是 gitignored 构建产物（`.gitignore:4 dist/`），真实 task worktree 由 `dispatch-worktree-setup.sh` 的 worktree-include 步骤provision（脚本第 28 行注明「config.yml + vendor dist」）；`.quay/goal-round.jsonl` 由 `.gitignore:229` 忽略，worktree 内需只读软链宿主载体（见 AC2）。

### Worker 轮实测（2026-10-18，实现落地后）

**W1. AC2 —— 修后判据在真实生产载体上 exit 0**：任务 worktree 内
`ln -s /data/home/yale/work/quay/.quay/goal-round.jsonl .quay/goal-round.jsonl`（只读软链，未复制），
逐字跑 `goals/AC-262-*.md` frontmatter 的 criterion：

```
land = 2026-10-18T22:01:56+08:00   (git log -1 --format=%cI -- packages/quay/src/cli/goal.ts)
CRITERION_EXIT=0
stdout: (empty)
stderr: (empty)
seen = 11
ok   = 11
```

（`seen`/`ok` 由同一谓词的只读探针从同一载体读出：落地后 11 轮，全部 goal-ring 非 failed。）

**W2. AC3 —— 三态负对照（同一 criterion 文本，只替换 `.quay/goal-round.jsonl` 的指向）**：

```
=== AC3-1 post-landing ring=FAILED [1-failed.jsonl] exit=1 ===
AC-262: carrier .quay/goal-round.jsonl holds 1 round(s) after the B2 landing commit (2026-10-18T22:01:56+08:00 = epoch 1792332116.000) and none carries a non-failed goal-ring (observed states, first 5: [['failed']]) => the ring is broken in production, which is the whole point of B2

=== AC3-2 pre-landing only [2-prelanding.jsonl] exit=1 ===
AC-262: carrier .quay/goal-round.jsonl holds 0 rounds after the B2 landing commit (2026-10-18T22:01:56+08:00 = epoch 1792332116.000) => the goal driver recorded nothing in that window; NOT-EVALUATED for the ring (nothing observed is not 'the ring is broken')

=== AC3-3a ts == land 同一瞬时，写成 Z [3a-boundary-exact.jsonl] exit=1 ===
AC-262: carrier .quay/goal-round.jsonl holds 0 rounds after the B2 landing commit (...) => the goal driver recorded nothing in that window; NOT-EVALUATED for the ring (nothing observed is not 'the ring is broken')

=== AC3-3b ts = land + 1ms [3b-boundary-after.jsonl] exit=0 ===
(stdout/stderr empty)

=== AC3-3c Z post-landing verified，修后 criterion [3c-z-post.jsonl] exit=0 ===
(stdout/stderr empty)

=== AC3-3c 同一个 fixture，旧 develop criterion（字典序）[3c-z-post.jsonl] exit=1 ===
AC-262: carrier .quay/goal-round.jsonl holds 0 rounds after the B2 landing commit (2026-10-18T22:01:56+08:00) and none with a non-failed goal-ring => the ring still breaks in production, which is the whole point of B2
```

末两段是**同一个 fixture、同一份载体、只差判据文本**：旧判据读成「0 轮 ⇒ ring 坏了」，新判据读成「有轮次且全绿」。⇒ 修的是读取谓词，不是放宽阈值（硬规则 4 / 4c）。

**W3. AC5 —— 防复发检查两次读数**：
- 当前 `goals/`：`node --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` ⇒ `tests 9 / pass 9 / fail 0`；其中
  `no live goal criterion compares a git %cI timestamp with a carrier ts lexicographically` ✔（0 命中）。
- `QUAY_GOALS_ROOT=/tmp/ac262-scratch/goals-prefix`（只放 develop 版本的 AC-262 修复前 criterion）⇒ **exit 1**，报：

```
  goal criterion(s) compare two ISO-8601 dialects as strings — ...
  AC-262.md:48 → if not ts or ts <= land: continue
```

  红且点名文件与行；负对照不是空转。

**W4. AC6 —— scoped 门**：`bash scripts/test.sh --for-task gap-ac262-criterion-tz-blind-timestamp-comparison --allow-thin` ⇒ `SCOPED_GATE_EXIT=0`，`ℹ tests 9 / pass 9 / fail 0`（本任务测试文件被收集并绿）。
`git diff --stat develop...HEAD -- packages/quay/src` 输出 0 行 ⇒ `packages/quay/src/**` 零改动；改动面 = 判据文件 + 该测试文件（2 files, +302/−4）。
anti-drift：`ANTI-DRIFT OK: task gap-ac262-criterion-tz-blind-timestamp-comparison — 2 actual file(s), all within declared Touches (3 glob(s))`。

**W5. AC7 —— 同族普查（新检查对全部 live goals）**：

```
live criteria scanned: 211 | git-timestamp candidates: 3 | blind hits: 0
out-of-scope records carrying a git-derived window (skipped):
   AC-266-goal.md status=superseded has-lex
   AC-267-goal.md status=superseded has-lex
   AC-268-goal.md status=superseded has-lex
```

3 个 candidate 中：AC-262 已改为瞬时比较、AC-317 本来就归一化、AC-326 无 `ts`↔`land|since` 字典序比较；命中 **0**。AC-266/267/268 同形但 `status: superseded` ⇒ 不是漏修，是已退役。

## Acceptance Criteria

- [x] AC1：判据第三支改为**瞬时比较**——`ts` 与 `land` 都经 `datetime.fromisoformat(...replace("Z","+00:00"))` 解析后比较 `.timestamp()`（或语义等价的实现）；`land` 解析失败必须 fail-closed（点名原值并 exit 1），⛔ 不得当作「无窗口」静默跳过。判据语义不变：仍要求「存在 ts 晚于落地时刻的轮次 ∧ 该轮 goal-ring fact 无 failed」，且 `git log` 当场派生 `land` 的写法保留（⛔ 不写死 sha）。
- [x] AC2：判据在**真实生产载体**上 exit 0——在任务 worktree 内 `ln -s /data/home/yale/work/quay/.quay/goal-round.jsonl .quay/goal-round.jsonl`（只读、不复制），逐字复跑 `goals/AC-262-*.md` frontmatter 的 criterion ⇒ exit 0；贴 `land`、`seen`、`ok` 三个读数与完整 stdout/stderr。
- [x] AC3：**可证伪负对照**（不是只跑绿）——用临时 fixture 载体喂同一判据逻辑，三种输入各取一次读数：①post-landing 轮的 `goal-ring.state = "failed"` ⇒ exit 1 且诊断点名 failed；②只有 pre-landing 轮 ⇒ exit 1 且诊断说明「0 轮（driver 未跑）而不是 ring 坏了」；③UTC `Z` 的 post-landing 轮与 `+08:00` 的 land 表示同一瞬时边界 ⇒ 归一化后正确包含/排除。三份输出原文进 Evidence。
- [x] AC4：诊断信息区分两种成因——`seen == 0` 与 `seen > 0 但 ok == 0` 输出不同句式（当前实现无论哪种都写 "none with a non-failed goal-ring"，把「driver 没跑」误报成「ring 坏了」，硬规则 3b）。
- [x] AC5：**防复发检查**——在 `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 增加第二类检查：扫描全部非 superseded/retired 判据，若含 `%cI`/`git log --format` 且存在 `ts`↔`land|since` 的字典序比较、却没有时区归一化（`fromisoformat`/`Date.parse`/`getTime()`/`timestamp()`），则红并点名文件与行。用 `QUAY_GOALS_ROOT` 指向含 AC-262 修复前 criterion 的 fixture ⇒ 必红且点名；当前 `goals/` ⇒ 绿（0 命中）。两次读数贴 Evidence。⚠️ 必须跳过 superseded/retired（AC-266/267/268 是同一代码形态但已退役）。
- [x] AC6：`bash scripts/test.sh --for-task gap-ac262-criterion-tz-blind-timestamp-comparison --allow-thin` 绿（贴 `SCOPED_GATE_EXIT` 与测试计数）；`packages/quay/src/**` 零改动（本任务只改判据文本 + 该测试文件 + 任务体）。
- [x] AC7：同族普查读数进 Evidence：对全部 live `goals/*.md` 跑新检查，命中 = 0；并列出 AC-266/AC-267/AC-268 的 `status: superseded` 作为「不是漏修，是已退役」的证据。

## Definition of Done

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本被改过」，而是：

1. **对象**：`git show develop:goals/AC-262-*.md` 的 criterion 含瞬时归一化、且**不含** `ts <= land` 字面量；在共享检出（非 worktree）逐字跑该 criterion 得 exit 0，贴 stdout/stderr、`land`、`seen`、`ok` 原文。
2. **第二来源**：落地后 goal 环下一轮把 AC-262 的 verdict 记为 pass——贴 `.quay/goal-round.jsonl` 中该轮的 `goal-ring`/gate 读数，⛔ 不以本任务自报的 exit 0 代替生产台账。
3. **可证伪**：AC3 的三态 fixture 读数（failed ring ⇒ 红；pre-landing only ⇒ 红并区分成因；跨时区同瞬时 ⇒ 正确）如实留痕，证明修后的判据既不恒真也不空转（硬规则 4 / 4c）。
4. **防复发**：AC5 的检查在 `scripts/test.sh` 的 product 泳道被收集并绿，且 `QUAY_GOALS_ROOT` 负对照 fixture 红并点名——证明下一次同类字典序比较会在同一落地里被拦住。
5. **不越界**：`packages/quay/src/**` 零改动；未重启任何 driver / `serve`；未改动 `.quay/goal-round.jsonl`（只读软链/读取）。
6. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- goals/AC-262-缺口b2-quay-goal-gate-check-batch-落在-plugin-形态-cli-上-driver-不再.md
- packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs
- tasks/gap-ac262-criterion-tz-blind-timestamp-comparison.md
