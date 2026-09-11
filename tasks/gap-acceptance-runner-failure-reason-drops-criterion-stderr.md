---
id: gap-acceptance-runner-failure-reason-drops-criterion-stderr
title: runAcceptance 的失败 reason 只由退出码构成、丢弃判据自己写的 stderr ⇒ goal gate
  每条红灯都不可归因（AC-214 连续 720 轮同值红而无法判因）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-237
---
## Proposal

**缺陷（位置判定，逐行）**——`packages/quay/src/gate/acceptance-runner.ts:164`：

```js
: `acceptance failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ""})`,
```

正常失败分支的 `reason` **只由退出码 + 信号构成**，判据自己写到 stderr 的成因文本**从不带上**。

**同文件已有相反先例**，说明这不是设计取舍而是遗漏：`:152` 的 spawn 失败分支带 `r.error.message`；超时分支还额外带排查提示（`raise gates.yml timeoutMs / --timeout`）。⇒ **只有「判据正常跑完但返回非 0」这一支把成因丢了**，而那恰恰是最常见的一支。

**复现（一条命令，能取假）**：

```
node --experimental-strip-types -e 'const m = await import("./packages/quay/src/gate/acceptance-runner.ts");
const r = m.runAcceptance({ command: "echo CAUSE-TOKEN >&2; exit 1", cwd: ".", timeoutMs: 10000 });
console.log(r.reason)'
⇒ acceptance failed (exit 1)        ← CAUSE-TOKEN 丢失
```

**代价（实测，非假想）**：
- AC-237 的 origin 记录：`criteria[AC-214].verdict=fail, reason="acceptance failed (exit 1)"`，而 AC-214 的 criterion 自身用 stderr 区分两种失败（`no evidence yet: %s` 与 `stale evidence: %s`，**两者都 exit 1**）；`timeSeries["goal:AC-214:verdict"].count=720 crossed=true` ⇒ **连续 720 轮同值红灯而结构上无法判因**。两种成因的处置截然不同：「缺证据」=刷新机制没跑，「证据过期」=需重跑跨机验证。
- 2026-09-11 本会话独立撞到同一形态：AC-214 红且只有 `exit 1`，只能把 criterion 抠出来手工重跑，才读到 `no evidence yet: GOAL-009-AC-203`；据此才查出「`--verify-coldstart` 无自动触发点」并手动发起一次跨机运行。**那一步手工重跑正是本缺陷强加的成本**，每条红灯都要付一次。

⇒ 这是硬规则③（枚举不布尔）与「诊断载体字段必须保留区分成因的维度」的同族：**把多个不同成因压成同一个取值**。

## Plan

1. 在 `:164` 的失败分支把判据自身的输出带进 `reason`：**保留现有前缀**，其后追加**截断过的** stderr（stderr 为空时退回 stdout 尾部；两者皆空则维持现状并明说「判据未写任何输出」）。
2. **保留前缀是硬约束**（已查消费者，⛔ 不是猜测）：`packages/quay/test/driver-cli-ac2-regression.test.mjs:24` 断言 `/FAIL — acceptance failed/`（只匹配前缀，追加安全）；`plugin/test/meta-driver.test.mjs:1570` 只是把该串当**夹具数据**，非对产出者的断言。⇒ 前缀不得改动。
3. **必须截断**：判据 stderr 可能很长（如 suite 输出），`reason` 会进 `goal-round.jsonl` 每轮落盘。取一个明确上限并在超限时标注被截断，⛔ 不得无界增长。
4. 超时与 spawn 两支**维持现状**（它们已带成因），⛔ 不要顺手重写。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：贴 `:164` 原文与上述复现命令的输出（`acceptance failed (exit 1)`，CAUSE-TOKEN 丢失）。
  - 改前 `:164` 原文：``: `acceptance failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ""})`,``
  - 改前复现输出：`reason="acceptance failed (exit 1)"`，`contains CAUSE-TOKEN: false`
- [x] AC2 成因被带上（能取假）：改后同一复现命令的 `reason` 含 `CAUSE-TOKEN`；把 fixture 改成不写 stderr ⇒ `reason` 不含它但仍含前缀。贴两次输出。
  - A（判据写 stderr）：`reason = "acceptance failed (exit 1) — CAUSE-TOKEN"`，`contains CAUSE-TOKEN: true`
  - B（判据什么都不写，仅 `exit 1`）：`reason = "acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"`，`contains CAUSE-TOKEN: false`，`starts with prefix: true`
- [x] AC3 前缀未破坏（防误伤）：`node --test packages/quay/test/driver-cli-ac2-regression.test.mjs` exit 0；并贴改后 `reason` 仍以 `acceptance failed (exit ` 开头的实测串。
  - `node --test packages/quay/test/driver-cli-ac2-regression.test.mjs` → `tests 1 / pass 1 / fail 0`，exit 0
  - 改后实测串：`acceptance failed (exit 1) — CAUSE-TOKEN`（以 `acceptance failed (exit ` 开头）
- [x] AC4 截断生效且可见：构造一个 stderr 远超上限的判据 ⇒ `reason` 长度 ≤ 上限且带被截断的标注；贴长度读数与标注。
  - 判据写 9012 字符 stderr（`head -c 9000 /dev/zero | tr '\0' A >&2`）⇒ `reason.length = 500`，`FAILURE_REASON_MAX_CHARS = 500`，`<= cap: true`
  - 标注（可见）：`… [truncated, 9012 chars of stderr omitted]`
  - 上限取值不是凭空定的：下游 `goal-driver.ts gateCriterion` 本就把 reason `slice(0, 500)`，取 500 让**runner 自己带标注的截断**生效，而非下游静默截断。
- [x] AC5 三支互不同形（硬规则③）：正常失败 / 超时 / spawn 失败三种情形的 `reason` 各贴一条，三者可区分；⛔ 超时与 spawn 两支的文本不得被本次改动改变（贴改前改后逐字对照）。
  - 正常失败：`acceptance failed (exit 1) — cause-A`
  - 超时：`acceptance timed out after 200ms (killed) — raise gates.yml timeoutMs / --timeout`
  - spawn 失败：`acceptance failed to spawn: spawnSync /bin/sh ENOENT`
  - 逐字对照（改前 = `git show HEAD:packages/quay/src/gate/acceptance-runner.ts`）：超时支模板 `` `acceptance timed out after ${timeoutMs}ms (killed) — raise gates.yml timeoutMs / --timeout` ``、spawn 支模板 `` `acceptance failed to spawn: ${r.error.message}` ``，与改后**逐字相同**——本次只改「正常失败」一支。
- [x] AC6 生产载体验证（⛔ 夹具不算，硬规则 4 推论三）：改动落地后，从 `.quay/goal-round.jsonl` 取**落地时刻之后**的轮次，找一条 `verdict=fail` 的 criteria 记录，其 `reason` 含该判据自己写出的成因文本（而非只有 `exit N`）；贴该记录。
  - 载体：`.quay/goal-round.jsonl`（`facts[].value.criteria`），轮 `ts=2026-09-11T03:26:33.099Z`，`run_id=goal-1789097151088`
  - 记录（逐字）：`{"id": "AC-214", "goal": "GOAL-009", "status": "achieved", "verdict": "fail", "reason": "acceptance failed (exit 3) — NOT-EVALUATED: carrier absent"}`
  - 同轮共 9 条同形 fail 记录（AC-201/203/204/205/206/207/214/232/238），每条都携带**判据自己写出的成因文本**；改前这一批只会是 `acceptance failed (exit 3)`（正是 AC-214 连续 720 轮无法判因的形态）。
  - 取证方式与偏差（如实披露）：该轮由**真实 `goal-driver.ts`**（生产常驻例程，`--once`）在**任务 worktree** 内跑**真实 `goals/*.md`** 产出 —— 生产机制 + 生产输入，⛔ 不是夹具/注入。两处偏差：①工作目录是任务 worktree（因改动尚未 ff 到 develop，生产 goal-driver 仍跑旧代码）；②为不触发 LLM 派发用了驱动自带的 `--gap-worker-cmd "true"` 测试缝，它在 spawn pass 上、位于被测的 `runAcceptance` 路径**下游**。该轮因 `--root` 缺 productization 载体而让这批判据走 `NOT-EVALUATED: carrier absent` 分支 —— 恰好是**判据自身写 stderr** 的形态。
  - 范围外（如实标注）：AC-238 自己的静默 `exit 1` 分支（carrier 在、但无新鲜跨机证据时它不写任何输出）未改——那是 AC-238 判据自身的可归因性缺口，不属本任务。
- [x] AC7 AC-237 判据翻转：`goals/AC-237-*.md` 的 criterion 干跑从 exit 1 → exit 0（贴干跑输出）。
  - 改后：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-237 --root . --dry-run` → `"verdict": "pass"`，`"reason": "acceptance passed (exit 0)"`，EXIT=0
  - 改前（负控制：`git stash` 还原原 `acceptance-runner.ts` 后跑同一命令）→ `"verdict": "fail"`，`"reason": "acceptance failed (exit 1)"`，EXIT=1
  - 生产轮记录同证：`flips: [{"id": "AC-237", "to": "achieved", "ok": true, "reason": "written"}]`
  - ⚠️ 该 goal 层状态翻转由 goal 机制在 worktree 内**自行提交**（`goals/AC-237` 不在本任务 `## Touches`）⇒ 已 `git reset --hard` 撤回，留生产 goal-driver 在改动落地后自行翻转（避免「未落地即声称 achieved」+ 一次性不可逆锁定）。
- [x] AC8 全量绿：`scripts/test.sh` 全量绿。
  - worker 只跑 scoped 门（指令明确：全量 suite 由 driver 的 fan-in 跑）：`bash scripts/test.sh --for-task gap-acceptance-runner-failure-reason-drops-criterion-stderr --allow-thin` → `tests 83 / pass 83 / fail 0`，exit 0。
  - 全量绿由紧接的 fan-in 阶段判定（本任务未自行跑全量）。

## Definition of Done

goal gate 记录的失败 `reason` 携带判据自身写出的成因文本，三种失败形态互不同形，既有前缀与两个已有消费者不受影响，且 `reason` 长度有界。⛔ 把 stderr 无界拼进 `reason` ⇒ 不算达成（每轮落盘会撑爆载体）；⛔ 只改 `reason` 而不在生产载体上取到一次真实读数 ⇒ 不算达成（AC6）。

## Touches

- packages/quay/src/gate/acceptance-runner.ts
- packages/quay/test/driver-cli-ac2-regression.test.mjs
- tasks/gap-acceptance-runner-failure-reason-drops-criterion-stderr.md
