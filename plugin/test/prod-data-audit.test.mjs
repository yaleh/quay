// @test-group governance
// prod-data-audit.test.mjs — tests for plugin/scripts/prod-data-audit.ts
// (tasks/gap-prod-data-accounting-audit, 人 2026-08-14 14:5xZ 令 outer 安排的「生产数据入账审计」)。
//
// Coverage map (task ACs):
//   AC1 — 按载体聚合三态判定落地（①/②/③ 计数与清单，无修复）——real-carrier 测试跑真实生产树，
//         断言三态计数结构 + 具体载体的三态/处置（重核结果由载体复现，不硬编码）。
//   AC2 — 三态不布尔化：③ NOT_EVALUATED 独立取值 ≠ ① HAS_DATA（断言字符串不等 + 结构字段独立）。
//   AC3 — 读生产载体（resolveProductionRoot 追到主检出），不读任务体自述；fixture 关闭注入 seam 仍可判。
//   AC4 — 疑点按位置重查：hasCarrierRef 边界化（events.jsonl 不命中 gate-events.jsonl 子串）；载体类型
//         前置分类先于三态（isRetiredCarrier 只认退役声明行，不误伤活载体 verification-round）。
//   AC5 — 载体类型前置分类（累积/状态/已退役）+ 零写入者检测（inner-agent-budget 真命中 shape）。
//   AC6 — 谓词自检：predicateHit 非空；每个 NOT-FOUND 都带已知存在载体的命中。
//
// Run:
//   scripts/test.sh plugin/test/prod-data-audit.test.mjs
//   node --test plugin/test/prod-data-audit.test.mjs
//
// NOTE: 真实载体路径（buildAudit against REPO_ROOT）读【主检出】的生产数据（gitignored），是本测试的
// 「real transcripts/artifacts」半边——fixture 只能证明「能产出」，真实载体证明「已产出」（硬规则 4 推论三）。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  THREE_STATES,
  DISPOSITIONS,
  CARRIER_KINDS,
  hasCarrierRef,
  extractAcSection,
  parseRecordEpoch,
  isRetiredCarrier,
  readCarrierKind,
  buildAudit,
  classifyCarrier,
  EXPLICIT_CARRIERS,
} from "../scripts/prod-data-audit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// buildAudit 对真实生产树做全量扫描（读 1100+ 任务 + 每载体 git log / grep），一次约 35s——
// 两个真实载体测试共享同一份扫描结果（memoize），不在每个测试里重跑。
let _auditCache = null;
function getAudit() {
  if (!_auditCache) _auditCache = buildAudit(REPO_ROOT);
  return _auditCache;
}

// ── 纯逻辑：边界化引用（硬规则② 按位置判定） ──────────────────────────────────────────────────────────
test("AC4 hasCarrierRef is boundary-aware — events.jsonl does not hit gate-events.jsonl", () => {
  assert.equal(hasCarrierRef("gate-events.jsonl 同形", "events.jsonl"), false);
  assert.equal(hasCarrierRef(".quay/gate-events.jsonl", "gate-events.jsonl"), true);
  assert.equal(hasCarrierRef("$QUAY_GLOBAL_DIR/session-liveness/events.jsonl", "events.jsonl"), true);
  assert.equal(hasCarrierRef("tail -1 .quay/verification-round.jsonl", "verification-round.jsonl"), true);
  assert.equal(hasCarrierRef("checker-cost.jsonl 与 suite-state-events.jsonl", "cost.jsonl"), false);
  assert.equal(hasCarrierRef("", "events.jsonl"), false);
  assert.equal(hasCarrierRef("no carrier here", "events.jsonl"), false);
});

test("AC3 extractAcSection tolerates heading suffix and stops at next ##", () => {
  const body = [
    "## Plan",
    "do stuff",
    "## Acceptance Criteria (runnable — the real gate)",
    "- [ ] AC1 something",
    "- [ ] AC2 verification-round.jsonl",
    "## Definition of Done",
    "- [ ] done",
  ].join("\n");
  const ac = extractAcSection(body);
  assert.match(ac, /AC1 something/);
  assert.match(ac, /verification-round\.jsonl/);
  assert.doesNotMatch(ac, /Definition of Done/);
  assert.doesNotMatch(ac, /do stuff/);
  assert.equal(extractAcSection("no AC here"), "");
});

test("AC3 parseRecordEpoch handles ISO / ms / s and rejects non-epochs", () => {
  assert.equal(parseRecordEpoch({ at: "2026-08-12T03:28:00.289Z" }), Date.parse("2026-08-12T03:28:00.289Z"));
  assert.equal(parseRecordEpoch({ startedAt: 1786693958000 }), 1786693958000); // ms
  assert.equal(parseRecordEpoch({ ts: 1786693958 }), 1786693958000); // s → ms
  assert.equal(parseRecordEpoch({ mechanism: "cron", interval: "*" }), null); // no ts → null
  assert.equal(parseRecordEpoch(null), null);
  assert.equal(parseRecordEpoch({ at: 123 }), null); // ambiguous small number
});

// ── 载体类型前置分类（判据5） ──────────────────────────────────────────────────────────────────────────
const RETIRED_TEXTS_FIXTURE = [
  '// retired-clause-check.ts line 62: "heavy-op-token.sh 已随 2026-08-06 人裁定整体退休"',
  "// loop-shipping-exclusion-data.mjs: scripts/heavy-op-token.sh was removed 2026-08-06 — the heavy-op token was RETIRED entirely",
  "// verification-round.jsonl is mentioned here as a LIVE carrier for an unrelated reason",
];

test("AC5 isRetiredCarrier only matches retirement-declaring lines with ≥2-token prefixes", () => {
  // heavy-op-token-events.jsonl → 前缀 heavy-op-token 出现在退役声明行 → retired
  assert.equal(isRetiredCarrier("heavy-op-token-events.jsonl", RETIRED_TEXTS_FIXTURE), true);
  // 活载体 verification-round.jsonl：即使 verification 一词出现在文件里，也不在退役声明行 → 不判退役
  assert.equal(isRetiredCarrier("verification-round.jsonl", RETIRED_TEXTS_FIXTURE), false);
  // 空退役文本 → 一律不判退役
  assert.equal(isRetiredCarrier("heavy-op-token-events.jsonl", []), false);
});

test("AC5 readCarrierKind pre-classifies before the three-state", () => {
  assert.equal(readCarrierKind("heavy-op-token-events.jsonl", RETIRED_TEXTS_FIXTURE), CARRIER_KINDS.RETIRED);
  assert.equal(readCarrierKind("inner-blocked.json", RETIRED_TEXTS_FIXTURE), CARRIER_KINDS.STATE);
  assert.equal(readCarrierKind("inner-agent-budget.json", RETIRED_TEXTS_FIXTURE), CARRIER_KINDS.STATE);
  assert.equal(readCarrierKind("verification-round.jsonl", RETIRED_TEXTS_FIXTURE), CARRIER_KINDS.ACCUMULATOR);
  assert.equal(readCarrierKind("checker-cost.jsonl", RETIRED_TEXTS_FIXTURE), CARRIER_KINDS.ACCUMULATOR);
  assert.equal(readCarrierKind("full-suite-state.json", RETIRED_TEXTS_FIXTURE), CARRIER_KINDS.STATE);
});

// ── fixture 工作区：三态 + 处置（注入 seam 关闭仍可判，判据3） ────────────────────────────────────────
function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prod-data-audit-"));
}

function fakeDoneTask(id, acText) {
  return {
    id,
    file: `tasks/${id}.md`,
    text: `---\nid: ${id}\nstatus: done\n---\n## Acceptance Criteria\n${acText}`,
  };
}

function fixtureAudit() {
  const ws = makeTmpWorkspace();
  const quay = path.join(ws, ".quay");
  fs.mkdirSync(quay, { recursive: true });
  // 累积载体：有记录（含落地时刻之后）
  fs.writeFileSync(path.join(quay, "accum.jsonl"), '{"at":"2026-08-10T00:00:00Z","n":1}\n{"at":"2026-08-12T00:00:00Z","n":2}\n');
  // 累积载体：空文件（0 记录）
  fs.writeFileSync(path.join(quay, "empty.jsonl"), "");
  // 状态文件：有内容
  fs.writeFileSync(path.join(quay, "state.json"), '{"state":"green","at":"2026-08-12T00:00:00Z"}');
  // 单 JSON 对象却叫 .jsonl（loop-driver 形态）——按状态文件语义评估
  fs.writeFileSync(path.join(quay, "single-json.jsonl"), '{"mechanism":"cron","interval":"*"}');
  const doneTasks = [
    fakeDoneTask("t-accum", "- [x] AC: 写 accum.jsonl"),
    fakeDoneTask("t-empty", "- [x] AC: 写 empty.jsonl"),
    fakeDoneTask("t-state", "- [x] AC: 写 state.json"),
    fakeDoneTask("t-single", "- [x] AC: 写 single-json.jsonl"),
    fakeDoneTask("t-missing", "- [x] AC: 写 missing.jsonl"),
  ];
  return { ws, quay, doneTasks };
}

test("AC1/AC2/AC3 fixture — three-state classification is non-booleanized and independent", () => {
  const { ws, quay, doneTasks } = fixtureAudit();
  try {
    const base = {
      doneTasks, prodRoot: ws, gitRoot: ws, retiredTexts: [], predicateHit: "accum.jsonl@<present>",
    };
    const accum = classifyCarrier({ name: "accum.jsonl", ...base });
    assert.equal(accum.threeState, THREE_STATES.HAS_DATA);
    assert.equal(accum.kind, CARRIER_KINDS.ACCUMULATOR);
    assert.equal(accum.found, true);
    assert.ok(accum.recordCount >= 2);

    const empty = classifyCarrier({ name: "empty.jsonl", ...base });
    assert.equal(empty.threeState, THREE_STATES.ZERO_DATA);
    assert.equal(empty.disposition, DISPOSITIONS.SUSPECT);

    const state = classifyCarrier({ name: "state.json", ...base });
    assert.equal(state.threeState, THREE_STATES.HAS_DATA);
    assert.equal(state.kind, CARRIER_KINDS.STATE);

    // loop-driver 形态：单 JSON 对象的 .jsonl 按状态文件语义 → 有内容 → HAS_DATA，不误判零数据
    const single = classifyCarrier({ name: "single-json.jsonl", ...base });
    assert.equal(single.threeState, THREE_STATES.HAS_DATA);
    assert.match(single.reason, /state-file-has-content/);

    // 缺失载体（零写入者，因为 temp 无代码目录）→ ③ NOT_EVALUATED + SUSPECT（判据5 a 零写入者真命中形态）
    const missing = classifyCarrier({ name: "missing.jsonl", ...base });
    assert.equal(missing.threeState, THREE_STATES.NOT_EVALUATED);
    assert.equal(missing.disposition, DISPOSITIONS.SUSPECT);

    // 判据2：③ 独立取值 ≠ ① / ②（非布尔化）
    assert.notEqual(THREE_STATES.NOT_EVALUATED, THREE_STATES.HAS_DATA);
    assert.notEqual(THREE_STATES.NOT_EVALUATED, THREE_STATES.ZERO_DATA);
    assert.notEqual(missing.threeState, accum.threeState);
    // 三个态是三个不同的字符串
    assert.equal(new Set([THREE_STATES.HAS_DATA, THREE_STATES.ZERO_DATA, THREE_STATES.NOT_EVALUATED]).size, 3);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC6 predicate self-check — NOT-FOUND reports carry a known-present hit", () => {
  const { ws, doneTasks } = fixtureAudit();
  try {
    const base = {
      doneTasks, prodRoot: ws, gitRoot: ws, retiredTexts: [],
      predicateHit: "accum.jsonl@<known-present>",
    };
    const missing = classifyCarrier({ name: "missing.jsonl", ...base });
    assert.equal(missing.predicateHit, "accum.jsonl@<known-present>");
    assert.ok(missing.predicateHit, "a NOT-FOUND must carry the predicate self-check hit");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5 zero-writer detection reproduces the inner-agent-budget shape (fixture)", () => {
  const { ws, doneTasks } = fixtureAudit();
  try {
    // temp 工作区没有 plugin/scripts 等代码目录 → countWriters 归零 → zero-writer 真命中形态
    const base = {
      doneTasks, prodRoot: ws, gitRoot: ws, retiredTexts: [],
      predicateHit: "accum.jsonl@<present>",
    };
    const missing = classifyCarrier({ name: "never-written.json", ...base });
    assert.equal(missing.kind, CARRIER_KINDS.STATE); // .json → state
    assert.equal(missing.disposition, DISPOSITIONS.SUSPECT);
    assert.equal(missing.writers.nonTest + missing.writers.test, 0);
    assert.match(missing.reason, /zero-writers/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── 真实生产载体路径（AC3「读生产载体」——fixture 只证明能产出，这个证明已产出） ──────────────────────
test("AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks", { timeout: 120_000 }, () => {
  const audit = getAudit();
  // 生产树断言（稳定量，不依赖具体计数）：
  assert.ok(audit.doneTaskCount > 1000, `done tasks = ${audit.doneTaskCount}`);
  assert.ok(audit.prodRoot, "production root resolved");
  // 判据6：谓词自检命中非空
  assert.ok(audit.predicateHit, `predicate hit must be present, got ${audit.predicateHit}`);
  assert.ok(audit.predicateHit.includes("verification-round.jsonl"), audit.predicateHit);

  const byName = (n) => audit.carriers.find((r) => r.name === n);
  // 判据2：三态独立取值
  assert.equal(new Set([THREE_STATES.HAS_DATA, THREE_STATES.ZERO_DATA, THREE_STATES.NOT_EVALUATED]).size, 3);
  for (const r of audit.carriers) {
    assert.ok([THREE_STATES.HAS_DATA, THREE_STATES.ZERO_DATA, THREE_STATES.NOT_EVALUATED].includes(r.threeState));
    assert.ok(r.predicateHit, `carrier ${r.name} must carry predicateHit (AC6)`);
  }

  // ① 重核：inner-blocked.json = 状态文件假命中（无=正常态）——有写入者，绝不判 SUSPECT。
  const blocked = byName("inner-blocked.json");
  assert.ok(blocked, "inner-blocked.json is an explicit carrier and must be in the report");
  assert.equal(blocked.kind, CARRIER_KINDS.STATE);
  assert.notEqual(blocked.disposition, DISPOSITIONS.SUSPECT, "state-file with a writer must not be a suspect");
  assert.equal(blocked.threeState, THREE_STATES.NOT_EVALUATED); // absent → ③ (or HAS_DATA if currently blocked)

  // ② 重核：heavy-op-token-events.jsonl = 已退役假命中（retired-clause-check.ts:62）——直接出局。
  const heavy = byName("heavy-op-token-events.jsonl");
  assert.ok(heavy, "heavy-op-token-events.jsonl is an explicit carrier and must be in the report");
  assert.equal(heavy.kind, CARRIER_KINDS.RETIRED);
  assert.equal(heavy.disposition, DISPOSITIONS.RETIRED);

  // ③ 重核：inner-agent-budget.json = 已退役载体（2026-08-10 人裁定 A16，retired-clause-check.ts R31）——
  //   「零写入者」是退休预期态，直接出局（gap-retire-registration-inner-agent-budget-not-registered 登记）。
  const budget = byName("inner-agent-budget.json");
  assert.ok(budget, "inner-agent-budget.json is an explicit carrier and must be in the report");
  assert.equal(budget.kind, CARRIER_KINDS.RETIRED);
  assert.equal(budget.disposition, DISPOSITIONS.RETIRED);
  assert.equal(budget.threeState, THREE_STATES.NOT_EVALUATED);

  // 活载体 sanity：verification-round.jsonl 存在且有数据（①），gate-events.jsonl 亦然。
  const vr = byName("verification-round.jsonl");
  assert.ok(vr, "verification-round.jsonl in report");
  assert.equal(vr.threeState, THREE_STATES.HAS_DATA);
  assert.ok(vr.found, "verification-round.jsonl is found on disk");
  assert.ok(vr.recordCount > 0);

  const ge = byName("gate-events.jsonl");
  assert.ok(ge, "gate-events.jsonl in report");
  assert.equal(ge.threeState, THREE_STATES.HAS_DATA);

  // 计数结构：三态计数之和 == 报告载体数（无遗漏）。
  const sum = audit.counts.HAS_DATA + audit.counts.ZERO_DATA + audit.counts.NOT_EVALUATED;
  assert.equal(sum, audit.carriers.length);
});

test("AC1 explicit carriers are always reported even at zero position-based refs", () => {
  // 宽松正则曾把 events.jsonl 计为 11 条引用，但边界化后可能只有个别真引用；显式载体无论如何都要入报告。
  const audit = getAudit();
  for (const name of EXPLICIT_CARRIERS) {
    assert.ok(
      audit.carriers.some((r) => r.name === name),
      `explicit carrier ${name} must be present in the report`,
    );
  }
});
