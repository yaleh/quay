---
id: gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable
title: AC-203 的记录写入点是裸 printf、不带 build_sha，而 AC-214 的新鲜度锚只认 build_sha ⇒
  该记录即便产出也被判为「无证据」⇒ AC-214 结构上永远 exit 1
status: done
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable
goal_ac: AC-214
---
## Proposal

**AC-214 的判据逐字**（`goals/AC-214-*.md` 的 criterion）：

```python
NEED = ["GOAL-009-AC-201", "GOAL-009-AC-203", "GOAL-009-AC-205", "GOAL-009-AC-207"]
...
        sha = r.get("build_sha") or r.get("commit")
        ts  = str(r.get("ts") or "")
        if sha and (a not in newest or ts > newest[a][1]): newest[a] = (sha, ts)
missing = [a for a in NEED if a not in newest]
if missing:
    sys.stderr.write("no evidence yet: %s\n" % ",".join(missing)); sys.exit(1)
```

⇒ **一条没有 `build_sha`（也没有 `commit`）的记录，对 AC-214 而言等同于「这条 ac 根本没有证据」**——`if sha and ...` 直接跳过它，该 ac 落进 `missing`，判据 exit 1。

**写入点逐个核对（按位置，只看真实写入语句——⛔ 不匹配注释；本条第一次核对时我正是匹配到了 helper 的注释块而得出错误映射，重取后如下）**：

| ac | 写入点 | 形态 | 带 `build_sha`? | 在 NEED 里? |
|---|---|---|---|---|
| AC-201 | `verify-deliver-coldstart.sh:468` | 裸 `printf` | **✓**（显式写了 `"build_sha":"%s"`） | 是 |
| **AC-203** | **`:912`** | **裸 `printf`** | **✗** | **是** |
| AC-206 | `:936` | 裸 `printf` | ✗ | 否 |
| AC-204 | `:1077` | 裸 `printf` | ✗ | 否 |
| AC-205 | `:1117` | `ac89_append_goal009` | ✓ | 是 |
| AC-232 | `:1387` | `ac89_append_goal009` | ✓ | 否 |
| AC-234 | `:1254` | 裸 `printf` | ✗ | 否 |
| AC-207 | worktree `gap-ac207-…:532` | `ac89_append_goal009` | ✓ | 是 |

`ac89_append_goal009()`（`:485-494`）是统一补锚的 helper：`BUILD_SHA` 非 40-hex ⇒ **fail-closed 拒写**，否则 `printf '{"build_sha":"%s","ts":"%s"%s}\n'`。

⇒ NEED 四条里，**AC-203 是唯一走裸 printf 且没写 build_sha 的**。**AC-214 因此结构上永远不可能 exit 0**，无论 AC-203 的记录将来产没产出、新不新鲜。

**现状佐证**：AC-214 当前干跑 exit 1，stderr 形如 `no evidence yet: GOAL-009-AC-203,GOAL-009-AC-205,GOAL-009-AC-207`——今天三条都还没产出，所以这个缺陷被「反正也还没有证据」掩盖着；等 `gap-cross-host-evidence-run-incomplete-…` 把 AC-203 的产出打通之后，**AC-203 会从「没产出」变成「产出了但仍被判为没证据」**——那时缺陷才显形，且形态更难查（记录明明在载体里）。⇒ 现在修，比等它显形便宜。

**为什么不是「顺手给所有记录都加 build_sha」**：AC-204/206/234 不在 AC-214 的 NEED 里，给它们加锚是范围外改动，且会改变既有已转绿记录的形态（AC-204/AC-206 刚于 2026-09-10T22:49Z 转 achieved）。本条**只**修 AC-203 这一条被 NEED 引用却缺锚的。若将来 NEED 扩容，扩容那条任务负责同步补锚。

## Plan

1. 把 `:912` 的 AC-203 写入点改走 `ac89_append_goal009`（与 AC-205/AC-232/AC-207 同形），由 helper 统一补 `build_sha`/`ts`——⛔ 不手写 `"build_sha"` 字面量（那会多出第二个补锚点，硬规则①：用机件不手搓；且下次改锚格式必漏一处）。
2. helper 的 fail-closed 语义要保留：`BUILD_SHA` 非 40-hex ⇒ 不写记录并返回非 0，⛔ 不得为了「至少写点什么」而降级成无锚记录（硬规则 3b）。
3. 同步镜像副本 `packages/quay/plugin/scripts/verify-deliver-coldstart.sh`。
4. 加一条把「NEED 与写入点带锚情况」对齐起来的机械检查或测试，防同族复发（硬规则 5b：修一处 ≠ 只有一处）——枚举 AC-214 criterion 里的 NEED 列表，逐条断言其写入点经 `ac89_append_goal009`（或显式含 `build_sha`）。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：贴改前 `:912` 的完整 `printf` 语句（可见无 `build_sha`），与 AC-214 criterion 里 `sha = r.get("build_sha") or r.get("commit")` 那一行。
- [x] AC2 已改走 helper（能取假）：改后 `grep -nE '^\s*(printf .*GOAL-009-AC-203|ac89_append_goal009 ".*AC-203)' plugin/scripts/verify-deliver-coldstart.sh` 命中的是 `ac89_append_goal009` 形态；贴命中行。
- [x] AC3 记录真带锚（⛔ 不靠读代码断言）：用 hermetic 方式（`--selfcheck` 或等价的受控调用）让 AC-203 写入点真写一条记录到临时 `--ac89` 路径，`python3 -c` 读回该行并打印 `build_sha` 字段值为 40-hex；贴该行 JSON。
- [x] AC4 fail-closed 保留（能取假）：令 `BUILD_SHA` 为空或非 40-hex ⇒ 该写入点**不写记录**且返回非 0，stderr 含 helper 的拒写提示；贴输出与「临时载体行数未变」的前后读数。
- [x] AC5 同族防复发检查：新增/扩展一条机械检查——解析 AC-214 criterion 中的 NEED 列表，逐条断言其写入点带锚；对当前状态它应**改前红、改后绿**；贴前后两次运行输出。
- [x] AC6 镜像无漂移：`node --no-warnings --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --root .` exit 0。
- [x] AC7 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

AC-214 的 NEED 列表里每一条 ac 的写入点都经 `ac89_append_goal009` 补锚（或显式带 40-hex `build_sha`），且该对应关系由**机械枚举**守着（⛔ 不是人工清点一次）；helper 的 fail-closed 语义未被降级。⛔ 本任务**不**主张 AC-214 因此转绿——它还需要 AC-203/205/207 三条记录真的产出（归 `gap-cross-host-evidence-run-incomplete-…` 与 `gap-ac207-e2e-producer-section-never-landed-on-develop`）；本条只保证「产出之后不会被判成没产出」。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable.md

## Evidence

**⚠️ 行号漂移（先记，防误读）**：下表与 Plan 写的 `:912` 是立案时的 develop 行号；develop 已前进
（sibling `gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207` 等落地），改前 AC-203 写入点现位于
**`:1072`**。以下一律**按位置重新取证**，⛔ 不照抄正文行号。

**AC1 缺陷存证（改前读数，`git show HEAD:plugin/scripts/verify-deliver-coldstart.sh`，HEAD = develop `cbea022e9`）**

`:1072` 的完整写入语句（逐字，两物理行）——无 `build_sha`：

```
  printf '{"ts":"%s","ac":"GOAL-009-AC-203","host":"%s","project_root":"%s","has_plugin_dir":false,"driver_alive":%s,"carrier_records":%s}\n' \
    "$ts" "$host" "$project_root" "$driver_alive" "$carrier_records" >> "$ac89"
```

AC-214 criterion（`goals/AC-214-*.md`）第 47 / 49 行：

```
47:          sha = r.get("build_sha") or r.get("commit")
49:          if sha and (a not in newest or ts > newest[a][1]): newest[a] = (sha, ts)
```

⇒ 该 printf 产的记录对 AC-214 而言 `sha` 恒为空 ⇒ 跳过 ⇒ AC-203 进 `missing` ⇒ exit 1。

**AC2 改后写入点（`grep -nE '^\s*(printf .*GOAL-009-AC-203|ac89_append_goal009 ".*AC-203)'` 唯一命中）**

```
1079:  ac89_append_goal009 ",\"ac\":\"GOAL-009-AC-203\",\"host\":\"$host\",\"project_root\":\"$project_root\",\"has_plugin_dir\":false,\"driver_alive\":$driver_alive,\"carrier_records\":$carrier_records"
```

（`grep -c` = 1：原来那条裸 printf 已不存在，`printf .*GOAL-009-AC-203` 分支零命中。）
同形：`write_ac203_record` 现与 `write_ac205_record`/`write_ac232_record`/`write_ac207_record` 一样只留
「读数校验 + 一行 helper 调用」，`ts`/`BUILD_SHA`/`AC89` 全由 helper 取——⛔ 没有第二份 `"build_sha"` 字面量。

**AC3 记录真带锚（读回的是载体上真写下的那一行，⛔ 不是读代码）**

`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` 的 control 15 让 **AC-203 写入点本身**
写一条记录到临时载体，`python3` 读回：

```json
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-09T00:00:00Z","ac":"GOAL-009-AC-203","host":"hostB-fake","project_root":"/tmp/third-party-fake","has_plugin_dir":false,"driver_alive":1,"carrier_records":5}
```

`build_sha = 0123456789abcdef0123456789abcdef01234567` / `is_40_hex = True` / `ac field = GOAL-009-AC-203`。
自检断言行：`selfcheck: ac203-record(valid) wrote=1 fields_ok=1 build_sha_40hex=1 (expect 1/1/1 — top-level 40-hex build_sha)`
（五字段逐字仍在：`has_plugin_dir` 是 JSON 字面 `false`、`driver_alive`/`carrier_records` 是整数）。
⛔ 判 `build_sha` 是否 40-hex 用的是 bash `=~` 而非 `printf | grep -q`——pipefail 下 `grep -q` 命中即早退
⇒ printf 收 SIGPIPE ⇒ 管道 141 ⇒ **条件成立时反而判假**（且是否复现取决于宿主 grep）；结构上避开管道。

**AC4 fail-closed 保留（双向控制，⛔ 不降级成无锚记录）**

- 空 `BUILD_SHA`：`selfcheck: ac203-record(no-build-sha) rc=1 msg=1 lines=1→1`——读数全有效、唯独 `BUILD_SHA`
  空 ⇒ **拒写（rc≠0）∧ stderr 带拒写提示 ∧ 载体行数 1→1 不变**。
- 拒写提示逐字：`ac89_append_goal009: BUILD_SHA not 40-hex (got '') — GOAL-009 record NOT written (fail-closed)`。
- 非 40-hex（39 hex，等价受控调用直接调 helper）：`rc=1`，载体 0 行（文件根本没被创建）；
  **同一输入换成 40-hex ⇒ `rc=0`，载体 1 行带锚记录**（正控制——证明负控制不是恒拒）。
- 另：`write_ac203_record` 自身的读数校验（`driver_alive=0`）仍拒写：`ac203-record(dead-driver) refused=1`。
- 调用点不吞：`step4_driver_liveness` 里 rc≠0 时打印
  `NOTE: AC-203 record NOT written (fail-closed: BUILD_SHA missing/non-40-hex or AC89 path empty — 缺值≠合格)`
  ——**不写但也不静默**（硬规则 3b），且⛔ 不中止后续步骤（缺锚不得伪装成「脚本崩了」）。

**AC5 同族防复发（机械枚举，⛔ 非人工清点一次）**

新增测试 `plugin/test/verify-deliver-coldstart.test.mjs` ：
`AC5 — every AC-214 NEED ac's write point carries a freshness anchor (mechanical enumeration)`。

- NEED 从 `goals/AC-214-*.md` 的 criterion **解析**（`NEED = [...]`），⛔ 不在此处复制一份（硬规则 4c）。
- 逐条取该 ac 的**产出型写入语句**：先按反斜杠续行合成逻辑语句，**按位置**排除纯注释行（硬规则 2），
  再用「产出谓词」（调 `ac89_append_goal009`，或 `printf` 重定向进 `$AC89`）排除 selfcheck 里的
  `grep -q '"ac":"…"'` **断言**——它匹配 ac 字段但不是产出点。
- 断言每条产出语句都带锚：经 `ac89_append_goal009`，或显式含顶层 `"build_sha":`（AC-201 的形态）。
- **某条 ac 一条产出语句都找不到 ⇒ 判失败并点名**（无法断言其锚 ⇒ NOT-EVALUATED 不得与合格同形，硬规则 3b），
  NEED 解析不出来同理——⛔ 不是静默跳过。

两次运行（判据取假，硬规则 4c/5b）：

```
改前（git show HEAD:…verify-deliver-coldstart.sh 放回原位）:
  ✖ AC5 — every AC-214 NEED ac's write point carries a freshness anchor (mechanical enumeration)
  ℹ pass 0 / fail 1
  GOAL-009-AC-203: write point lacks a top-level build_sha anchor ⇒ AC-214 reads it as NO evidence (exit 1):
    printf '{"ts":"%s","ac":"GOAL-009-AC-203","host":"%s",…}\n'

改后:
  ✔ AC5 — every AC-214 NEED ac's write point carries a freshness anchor (mechanical enumeration)
  ℹ tests 1 / pass 1 / fail 0
```

改前红**只点名 AC-203**（AC-201/205/207 两侧都过）⇒ 该检查不是「按构造恒红」，而是真的定位到了这一条。

**AC6 镜像无漂移**

`node --no-warnings --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --root .` ⇒ `EXIT=0` /
`mirror-pair-drift-check: PASS — every mirror pair matches or is allow-listed with an unchanged signature.`。
本任务范围门内该检查同样 PASS。

⚠️ **Touches 里 `packages/quay/plugin/scripts/verify-deliver-coldstart.sh` 不存在**——`ls packages/quay/` 无 `plugin/`
目录、`git log -- packages/quay/plugin/…` 无任何历史；`find` 全仓只有 **1 份脚本 + 1 个测试**。本仓唯一的镜像对是
`plugin/scripts/` ↔ `experiments/quay-perpetual-stream/scripts/`，本脚本在该对里**无成员**（`grep -c` = 0）
⇒ **没有可同步的副本，Plan 第 3 步与那条 Touches 基于一个过期前提**。⛔ 未新造一个镜像去满足它
（新造一份无人拥有的副本才是制造漂移）。Touches 保留原样（改 Touches 是派发后范围变更，不该由 worker 单方做）。

**AC7 全量绿**

本任务侧的直接读数：**本任务范围门 exit 0** 且目标测试文件 12/12 绿——

```
bash scripts/test.sh --for-task gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable --allow-thin
  ✔ AC5 — every AC-214 NEED ac's write point carries a freshness anchor (mechanical enumeration)
  ℹ tests 12 / pass 12 / fail 0 / cancelled 0
  EXIT=0
```

⚠️ **全量 `scripts/test.sh` 不由本 worker 跑**：dispatch prompt 明令「You do NOT run the suite」，全量 suite 是
worker-driver 的 **fan-in suite 阶段**（在 ac-precheck 之后、ff 之前）机械执行的那一步；suite 红则 fan-in 拒 ff、
本任务不落地。⇒ 本 AC 勾选时其全量读数的**机械核验责任在 fan-in**，本任务侧的证据是上面那次范围门。
