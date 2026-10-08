---
id: gap-routine-rate-gate-board-pressure-and-quota-ownership
title: routine 限流闸：同一 routine 自身板排空仍被旧批次计数挡住（Option B 残留）+
  K/窗口是孤儿字面量未接统一配置面——先落测试切片，不动生产行为
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

本次由 Driver/Routine 架构核实（独立会话分析）发现两个**未被任何现有已完成任务覆盖**的缺口，均落在 `plugin/scripts/routine-file-gate.ts` 的限流闸（`gateFinding`/`countRecentFilings`）：

### 缺口①：同 routine 自身"板排空"仍被旧批次计数挡住（Option B 残留，非新发现，是已有任务显式留下的待办）

`gap-routine-filing-rate-global-window-starves-freshness-refresh`（**done**）修的是**跨 routine**预算共享（方案 A：`countRecentFilings` 加 `routine` 维度分账，`routine-file-gate.ts:900-927`）。该任务自己的 Finding 与 §4「落地方案与残余」逐字写明还有一个**未关闭**的轴（方案 B）：

> "窗口**仍**只数「立案次数」、不数「板上是否还压着工作」——即方案 (B) 的轴。当**同一** routine 自己在窗内立满 K 条而板又排空时，它仍被限流。"

读码确认现状（`routine-file-gate.ts:900-927`）：`countRecentFilings(carrierPath, nowMs, windowMs, routine)` 只读 `.quay/routine-findings.jsonl` 的 `filing-round` 记录，**不读任务板/任务状态**——函数签名里没有 `root`/board 参数。即便某 routine 过去立的 3 条任务此刻**全部 `done`**（板完全排空），该 routine 自己的 24h 窗口读数依然是 3，`gateFinding` 依然 `rate:` 拒绝。这不是对已修复功能的重新发现，是继承同一文件、同一 Finding 显式点名、尚未选择落地的另一个方案轴。

### 缺口②：`DEFAULT_RATE`/`FILING_WINDOW_MS` 是孤儿字面量，未接统一声明式配置面（独立发现，无先前任务覆盖）

- `plugin/scripts/routine-file-gate.ts:18` `export const DEFAULT_RATE = 3;`
- `plugin/scripts/routine-file-gate.ts:513` `export const FILING_WINDOW_MS = 24 * 60 * 60 * 1000;`
- `grep -n "drivers.yml\|loadDriverConfig\|process.env" plugin/scripts/routine-file-gate.ts` → **0 命中**。

对照：`plugin/scripts/driver-config.ts` 头注释明写"⛔ 全仓库唯一一个并发数值字面量——其余并发值都从 `drivers.yml` 经 `loadDriverConfig`/`driverCap` 派生"，六个 driver kind 的 `cap`/`interval_ms`/`reconcile_interval_secs` 已统一到 `drivers.yml` 这一个声明式配置面。`DEFAULT_RATE`/`FILING_WINDOW_MS` 是**同一性质**的"运行节律参数"，却完全在这个已建立的统一面之外——改它只能改源码字面量，不能像 `cap` 那样靠重启生效的声明式配置调整。

**去重核实**（⛔ 非重复立案）：
<!-- dedup-ref -->本任务的缺口①直接继承 `gap-routine-filing-rate-global-window-starves-freshness-refresh`（done）自己标注的未关闭残余（方案 B 轴），不是对它的重新发现；`gap-routine-semantic-dedup-scan-recurring-cluster-starvation`（done）修的是"同一 routine 内部谁先花预算"（复现序排序），轴也不同，其自身 Finding §边界③ 已写明"本任务修的是发现之后谁先花预算"。`grep -rli "FILING_WINDOW_MS.*drivers.yml\|quota.*ownership\|配额.*归属"` 于 `tasks/*.md` 0 命中，缺口②未被任何既有任务覆盖。

## Plan（本轮范围：仅落测试切片，⛔ 不改生产行为/不做配置面迁移）

按用户裁定"可先实施独立且兼容的测试切片，但暂不进行架构大迁移或未经验证的生产限流变更"，本任务**只新增特征化测试**（characterization tests，正反对照齐全），固化上述两个缺口的**当前真实行为**，不修改 `routine-file-gate.ts` 本身一行代码。两处落地方案（缺口①选 B/C/D 中哪个、缺口②是否迁入 `drivers.yml`）留给后续任务由人裁定。

在 `plugin/test/routine-file-gate.test.mjs` 末尾追加两个测试（**完整代码如下，落地基本是机械抄写**，与既有 ⑮ 三个用例同一手法/同一 fixture helper，不新造测试基础设施）：

```js
test("⑯ KNOWN GAP (gap-routine-filing-rate-global-window-starves-freshness-refresh 的方案 B 轴，未关闭，⛔ 非重新发现) — 同一 routine 自身板排空仍被它自己已 done 批次的旧计数挡住", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-rate-boardpressure-"));
  try {
    const nowMs = Date.parse("2026-10-09T07:00:00Z");
    const ts = new Date(nowMs - 60 * 60 * 1000).toISOString();
    // 生产实测的病理（见本任务 Finding）：freshness-refresh 本窗口已花满 K=3，三条任务此刻全部 done
    // （板排空）。countRecentFilings 的输入只有 filing-round 记录，没有任何读板/读任务状态的参数，
    // 因此无法区分「这 3 条还开着」与「这 3 条已经 done、板是空的」。
    const carrier = writeCarrier(dir, [filingRound(ts, "freshness-refresh", ["a", "b", "c"])]);

    // 正面（缺口本身）：自己的窗口计数仍是 3，即便它产出的 3 个任务现在全是 done。
    const mine = countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, "freshness-refresh");
    assert.equal(mine, 3,
      "KNOWN GAP: 该 routine 过去的立案计数不随它产出的任务是否已 done 而改变");
    assert.equal(
      gateFinding(candidateA(), { existingKeys: new Set(), recentCount: mine, K: DEFAULT_RATE }).accept,
      false,
      "KNOWN GAP: 板已排空、自身预算却仍判饱和 ⇒ 仍被拒——这是 gap-routine-filing-rate-global-window-" +
        "starves-freshness-refresh 自己标注的方案 B 残留轴，不是本任务重新发现的问题",
    );

    // 负对照（证明上面不是空转）：同一 routine，本窗口真的没立过任何东西 ⇒ 预算真正空闲 ⇒ 应该通过。
    const emptyCarrier = writeCarrier(dir, []);
    const none = countRecentFilings(emptyCarrier, nowMs, FILING_WINDOW_MS, "freshness-refresh");
    assert.equal(none, 0);
    assert.equal(
      gateFinding(candidateA(), { existingKeys: new Set(), recentCount: none, K: DEFAULT_RATE }).accept,
      true,
      "负对照：本窗口确实没有旧立案时,同一 routine 可以正常通过——证明上面的红不是闸恒红，" +
        "而是精确命中「旧批次计数跟不上任务终态」这一条",
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("⑰ KNOWN GAP (quota-policy-ownership，独立发现) — DEFAULT_RATE/FILING_WINDOW_MS 是孤儿字面量，不经 drivers.yml/driver-config.ts 的统一声明式配置面派生", () => {
  // 固化当前取值（特征化，不是认可）——见 routine-file-gate.ts:18 / :513。
  assert.equal(DEFAULT_RATE, 3,
    "固化当前字面量；若未来接入 drivers.yml 式配置面，这条断言需要连带更新，⛔ 不要只删掉它");
  assert.equal(FILING_WINDOW_MS, 24 * 60 * 60 * 1000,
    "固化当前字面量；若未来接入 drivers.yml 式配置面，这条断言需要连带更新，⛔ 不要只删掉它");
});
```

（两个新测试 import 的符号 `DEFAULT_RATE`/`FILING_WINDOW_MS`/`countRecentFilings`/`gateFinding`/`candidateA`/`filingRound`/`writeCarrier` 均已在本文件现有 import 块与 ⑮ 用例区的 helper 中声明，无需新增 import。）

## Acceptance Criteria

- [ ] 上述两个测试逐字落地到 `plugin/test/routine-file-gate.test.mjs`，`node --no-warnings --experimental-strip-types --test plugin/test/routine-file-gate.test.mjs` 全绿（含既有 17 条 + 新增 2 条 = 19 条）
- [ ] `routine-file-gate.ts` 本身零改动：`git diff --stat` 对该文件应为空（本任务只加测试，不改生产代码/不做配置面迁移）
- [ ] 正反对照齐全：⑯ 用例必须同时含「板排空仍拒」（正面特征化）与「真正空闲则通过」（负对照）两个断言分支，且负对照分支若被误删（故意试验：把负对照那段注释掉重跑）用例集本身仍能跑通但失去负对照覆盖——评审时需核实两分支都在，⛔ 不接受只留正面断言
- [ ] 消费方不回归：`plugin/test/probe-routine.test.mjs`、`plugin/test/meta-driver.test.mjs`、`plugin/test/quality-gate-driver.test.mjs` 三个消费 `routine-file-gate.ts` 的测试文件全绿（证明零生产代码改动确实零回归）

## Definition of Done

两条特征化测试落地且全绿，`routine-file-gate.ts` 生产代码零改动，消费方测试不回归。两个缺口的**修复方案**（缺口①在方案 B/C/D 之间择一；缺口②是否迁入 `drivers.yml`、迁入哪个字段名）**不在本任务范围内**，留给人裁定后再开后续任务——本任务的 DoD 是"缺口被机械钉死、可复跑、不是叙述"，不是"缺口被修复"。

## Touches

- plugin/test/routine-file-gate.test.mjs
- tasks/gap-routine-rate-gate-board-pressure-and-quota-ownership.md
