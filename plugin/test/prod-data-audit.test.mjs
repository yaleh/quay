// @test-group engine
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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  THREE_STATES,
  DISPOSITIONS,
  CARRIER_KINDS,
  JS_MAX_STRING_LENGTH,
  MAX_LINE_CHARS,
  hasCarrierRef,
  extractAcSection,
  parseRecordEpoch,
  isRetiredCarrier,
  readCarrierKind,
  buildAudit,
  classifyCarrier,
  scanJsonlCarrier,
  streamLines,
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
    // AC2 parity pin：流式读的**确切**计数（不是 >=）——旧实现（整文件 split(nonblank).length）给的就是 2，
    // 改写后必须逐字不变。⛔ 不写「≥」：那对本条要防的「多数/少数一条」不敏感。
    assert.equal(accum.recordCount, 2, "streaming record count must equal the old whole-file count");

    const empty = classifyCarrier({ name: "empty.jsonl", ...base });
    assert.equal(empty.threeState, THREE_STATES.ZERO_DATA);
    assert.equal(empty.disposition, DISPOSITIONS.SUSPECT);
    assert.equal(empty.recordCount, 0);

    const state = classifyCarrier({ name: "state.json", ...base });
    assert.equal(state.threeState, THREE_STATES.HAS_DATA);
    assert.equal(state.kind, CARRIER_KINDS.STATE);
    assert.equal(state.recordCount, 1);

    // loop-driver 形态：单 JSON 对象的 .jsonl 按状态文件语义 → 有内容 → HAS_DATA，不误判零数据
    const single = classifyCarrier({ name: "single-json.jsonl", ...base });
    assert.equal(single.threeState, THREE_STATES.HAS_DATA);
    assert.match(single.reason, /state-file-has-content/);
    assert.equal(single.recordCount, 1);

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

// ── AC1：载体大于 V8 最大字符串长度 ⇒ 流式读，⛔ 不整文件读 ────────────────────────────────────────
// 缺陷现场（2026-10-13）：`.quay/meta-driver-round.jsonl` 538,347,409 B > 0x1fffffe8 ⇒ `classifyCarrier`
// 的整文件 `readFileSync(located,"utf8")` 抛 ERR_STRING_TOO_LONG，**整份审计（连同其它载体）一起崩**，
// 每个 fan-in 都红在同一处。下面这组测试就是那一条红的两半：旧表达式在这个 fixture 上必须真的抛
// （负控制，否则 fixture 什么也没证明），而 classifyCarrier 必须不抛并给一个**独立取值**。

// 稀疏超大载体：`ftruncate` 造洞（磁盘上只占几 KB），⛔ 不在测试进程里造 512 MB 字符串。
// 布局：[记录行]\n[洞（无换行符）][记录行]\n —— 洞的部分成为一条超长行（正是「读不动」的形态）。
// ⛔ `fs.writeSync(fd, string, ...)` 的 5 参数重载不按 (offset,length,position) 解释——尾部必须传 Buffer，
// 否则那一段会被写到 position 0 覆盖头部（本 fixture 第一版就踩了这个坑）。
function makeSparseCarrier(dir, name, size = JS_MAX_STRING_LENGTH + 4096) {
  const p = path.join(dir, name);
  const head = Buffer.from('{"at":"2026-08-10T00:00:00.000Z","n":1}\n');
  const tail = Buffer.from('{"at":"2026-08-12T00:00:00.000Z","n":2}\n');
  const fd = fs.openSync(p, "w");
  fs.writeSync(fd, head);
  fs.ftruncateSync(fd, size);
  fs.writeSync(fd, tail, 0, tail.length, size - tail.length);
  fs.closeSync(fd);
  return p;
}

test("AC1 streamLines reports an over-budget line as unreadable — never a silent drop", () => {
  const ws = makeTmpWorkspace();
  try {
    const p = path.join(ws, "big.jsonl");
    fs.writeFileSync(p, '{"a":1}\n' + "x".repeat(50) + "\n" + '{"b":2}\n');
    const seen = [];
    streamLines(p, (line) => { seen.push(line === null ? null : line.slice(0, 20)); }, { maxLineChars: 10 });
    // 中间那条超预算 ⇒ `null`（「这一行读不懂」），⛔ 不是空串、⛔ 不是被跳过。
    assert.deepEqual(seen, ['{"a":1}', null, '{"b":2}']);
    // 提前停止契约：回调返回 false ⇒ 不再读后面的行。
    const stopped = [];
    streamLines(p, (line) => { stopped.push(line); return false; }, { maxLineChars: 10 });
    assert.deepEqual(stopped, ['{"a":1}']);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1 streaming read is chunk-boundary safe (multi-byte included)", () => {
  const ws = makeTmpWorkspace();
  try {
    const p = path.join(ws, "mb.jsonl");
    // 多字节字符（含 4 字节 emoji）——StringDecoder 的存在理由就是它们可能跨 chunk 边界。
    fs.writeFileSync(p, '{"at":"2026-08-12T00:00:00Z","note":"日本語テキスト"}\n{"at":"2026-08-12T01:00:00Z","note":"émoji 🚀"}\n');
    const def = scanJsonlCarrier(p);
    assert.equal(def.count, 2);
    assert.equal(def.parseable, 2);
    // chunk 边界压到 1..13 字节 ⇒ 每个多字节字符都被切开过。读数必须逐字不变。
    for (const chunkSize of [1, 2, 3, 5, 7, 13]) {
      assert.deepEqual(scanJsonlCarrier(p, { chunkSize }), def, `chunkSize=${chunkSize} must not change the reading`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1 carrier over V8's max string length — negative control throws, classifyCarrier does not", () => {
  const ws = makeTmpWorkspace();
  try {
    const quay = path.join(ws, ".quay");
    fs.mkdirSync(quay, { recursive: true });
    const hugeJsonl = makeSparseCarrier(quay, "huge.jsonl");
    const hugeState = makeSparseCarrier(quay, "huge-state.json");
    const size = fs.statSync(hugeJsonl).size;
    assert.ok(size > JS_MAX_STRING_LENGTH, `fixture must exceed V8's max string length, got ${size}`);
    assert.ok(fs.statSync(hugeState).size > JS_MAX_STRING_LENGTH);

    // ── 负控制 = 被删掉的那一行本身 ────────────────────────────────────────────────────────────────
    // 它必须在这个 fixture 上抛 ERR_STRING_TOO_LONG；否则本 fixture 什么也没证明（「对真样本干跑」那一半）。
    for (const p of [hugeJsonl, hugeState]) {
      assert.throws(
        () => fs.readFileSync(p, "utf8"),
        (e) => e.code === "ERR_STRING_TOO_LONG",
        `negative control: the removed whole-file read must fail on ${path.basename(p)}`,
      );
    }

    const base = {
      doneTasks: [fakeDoneTask("t-huge", "- [x] AC: 写 huge.jsonl")],
      prodRoot: ws, gitRoot: ws, retiredTexts: [], predicateHit: "huge.jsonl@<present>",
      refsById: new Map([["huge.jsonl", { acRefs: 1, bodyRefs: 1, citing: ["t-huge"] }]]),
      landingById: new Map([["t-huge", Date.parse("2026-08-11T00:00:00Z")]]),
      writersById: new Map([["huge.jsonl", { nonTest: 1, test: 0 }], ["huge-state.json", { nonTest: 1, test: 0 }]]),
    };

    // 结构性判据（强于「碰巧没抛」）：这条路径上**一次都不许**整文件读载体。
    // 把旧的 readFileSync 包在 try/catch 里也不合格——那样它仍会读、仍会抛、只是被吞掉。
    const realReadFileSync = fs.readFileSync;
    const wholeFileReads = [];
    fs.readFileSync = function (p, ...rest) {
      if (String(p) === hugeJsonl || String(p) === hugeState) wholeFileReads.push(String(p));
      return realReadFileSync.apply(this, [p, ...rest]);
    };
    let repJsonl;
    let repState;
    try {
      repJsonl = classifyCarrier({ name: "huge.jsonl", ...base });
      repState = classifyCarrier({ name: "huge-state.json", ...base });
    } finally {
      fs.readFileSync = realReadFileSync;
    }
    assert.deepEqual(wholeFileReads, [], "the whole-file read must be GONE from this path, not merely try/caught");

    // .jsonl 累积载体：洞构成一条超预算行 ⇒ ③ 未评估（独立取值）。⛔ 不给一个偏小的记录数冒充「读全了」。
    assert.equal(repJsonl.threeState, THREE_STATES.NOT_EVALUATED);
    assert.match(repJsonl.reason, /^carrier-unreadable:line-too-long/);
    assert.equal(repJsonl.recordCount, null);
    assert.equal(repJsonl.recordsAfterLanding, null);
    assert.equal(repJsonl.disposition, DISPOSITIONS.SUSPECT);

    // 状态文件路径仍需要完整文本 ⇒ 先按 size 判上限，超限给独立取值（⛔ 不抛穿）。
    assert.equal(repState.threeState, THREE_STATES.NOT_EVALUATED);
    assert.match(repState.reason, /^carrier-unreadable:string-too-long/);
    assert.equal(repState.recordCount, null);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1 buildAudit does not abort — the oversized carrier is NOT_EVALUATED, the others still get a verdict", () => {
  const ws = makeTmpWorkspace();
  try {
    const quay = path.join(ws, ".quay");
    const tasks = path.join(ws, "tasks");
    fs.mkdirSync(quay, { recursive: true });
    fs.mkdirSync(tasks, { recursive: true });
    makeSparseCarrier(quay, "huge.jsonl");
    fs.writeFileSync(path.join(quay, "small.jsonl"), '{"at":"2026-08-12T00:00:00Z","n":1}\n');
    fs.writeFileSync(
      path.join(tasks, "t-both.md"),
      "---\nid: t-both\nstatus: done\n---\n## Acceptance Criteria\n- [x] AC1: 写 huge.jsonl\n- [x] AC2: 写 small.jsonl\n",
    );
    // `resolveProductionRoot` 只在 `.git` 是**文件**（linked worktree）时上溯主检出；这里给一个真 git 仓，
    // 保证审计读的是本 fixture 而不是生产树。
    execFileSync("git", ["init", "-q", ws], { stdio: "ignore" });

    const audit = buildAudit(ws, { root: ws });
    const huge = audit.carriers.find((r) => r.name === "huge.jsonl");
    assert.ok(huge, "the oversized carrier must still be reported, not dropped by a crash");
    assert.equal(huge.threeState, THREE_STATES.NOT_EVALUATED);
    assert.match(huge.reason, /^carrier-unreadable:/);
    // Plan 2：读不动的载体不阻断其它载体 —— 同一遍审计里 normal 载体照常出判定。
    const small = audit.carriers.find((r) => r.name === "small.jsonl");
    assert.ok(small, "the sibling carrier must still be audited");
    assert.equal(small.threeState, THREE_STATES.HAS_DATA);
    assert.equal(small.recordCount, 1);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1 a real carrier the audit cannot frame is NOT_EVALUATED, never a fabricated record count", () => {
  // 与上一条的区别：这里走**生产预算**（MAX_LINE_CHARS = 16 MiB），证明线上真正的超预算行也走同一条路，
  // ⛔ 不是只有把预算调小到 10 才成立。
  const ws = makeTmpWorkspace();
  try {
    const quay = path.join(ws, ".quay");
    fs.mkdirSync(quay, { recursive: true });
    const p = path.join(quay, "wide.jsonl");
    fs.writeFileSync(p, '{"at":"2026-08-12T00:00:00Z","n":1}\n' + "x".repeat(MAX_LINE_CHARS + 1) + "\n");
    const scan = scanJsonlCarrier(p);
    assert.equal(scan.ok, false);
    assert.equal(scan.code, "line-too-long");
    const rep = classifyCarrier({
      name: "wide.jsonl", doneTasks: [], prodRoot: ws, gitRoot: ws, retiredTexts: [], predicateHit: null,
      refsById: new Map(), landingById: new Map(), writersById: new Map(),
    });
    assert.equal(rep.threeState, THREE_STATES.NOT_EVALUATED);
    assert.match(rep.reason, /^carrier-unreadable:line-too-long/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── 真实生产载体路径（AC3「读生产载体」——fixture 只证明能产出，这个证明已产出） ──────────────────────
test("AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks", { timeout: 120_000 }, (t) => {
  const audit = getAudit();
  // 生产树断言（稳定量，不依赖具体计数）：
  assert.ok(audit.doneTaskCount > 1000, `done tasks = ${audit.doneTaskCount}`);
  assert.ok(audit.prodRoot, "production root resolved");
  // 判据6：谓词自检命中非空
  assert.ok(audit.predicateHit, `predicate hit must be present, got ${audit.predicateHit}`);
  // 自检的语义是「find 谓词本身有效 ⇒ 一个 NOT-FOUND 是真缺失而非定位器坏了」。可移植的判法是
  // 【交叉核对自检命中的载体确实被本次报告标为 found】——这与 checkout 上恰好存在哪些载体无关。
  // 原断言写死 `includes("verification-round.jsonl")`，那是**载体枚举顺序 + 该载体恰好存在**的
  // 派生物：全新 checkout 上首个被定位到的载体是别的（CI 实测
  // `checker-cost.jsonl@/home/runner/work/quay/quay/.quay/checker-cost.jsonl`），本机则是
  // verification-round（Class A 的失败根因之一）。
  const hitAt = audit.predicateHit.indexOf("@");
  const hitName = audit.predicateHit.slice(0, hitAt);
  const hitPath = audit.predicateHit.slice(hitAt + 1);
  const hitCarrier = audit.carriers.find((r) => r.name === hitName);
  assert.ok(hitCarrier, `predicateHit must name a carrier this audit reports: ${hitName}`);
  // 独立核对（非自证）：自检点名的那个路径必须真的在盘上——这条不依赖报告自己的 found 字段。
  assert.ok(fs.existsSync(hitPath), `predicateHit must name a path that exists on disk: ${hitPath}`);
  // 该载体在场时，自检必须仍命中它（长寿命检出上的原有强度不变）。
  if (fs.existsSync(path.join(audit.prodRoot, ".quay", "verification-round.jsonl"))) {
    assert.ok(audit.predicateHit.includes("verification-round.jsonl"), audit.predicateHit);
  }

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

  // 计数结构：三态计数之和 == 报告载体数（无遗漏）。
  const sum = audit.counts.HAS_DATA + audit.counts.ZERO_DATA + audit.counts.NOT_EVALUATED;
  assert.equal(sum, audit.carriers.length);

  // ── 以下断言需要【真实运行时载体】在场（`verification-round.jsonl` / `gate-events.jsonl` 是
  // gitignored 的运行产物）。全新 checkout（CI runner / 首次 clone）上它们根本不存在
  // ——这正是本测试在 GitHub Actions 上失败的根因（Class A）。
  // 硬规则 3b：此时抛 AssertionError 会把「没有输入」伪装成「检查失败」。
  // 故给「无法评估」独立取值（t.skip），且跳过键在【载体缺席】上、不在【断言失败】上
  // ——载体在场时下面的断言照跑，回归防护分毫未减（DoD：不得为了变绿而放宽断言）。
  const vr = byName("verification-round.jsonl");
  assert.ok(vr, "verification-round.jsonl in report");
  const ge = byName("gate-events.jsonl");
  assert.ok(ge, "gate-events.jsonl in report");
  if (!vr.found || !ge.found) {
    t.skip(
      `NOT-EVALUATED: 生产运行时载体缺席（verification-round.jsonl found=${vr.found}, gate-events.jsonl found=${ge.found}）` +
      ` at prodRoot=${audit.prodRoot} —— 全新 checkout 的正常形态；上面全部结构/分类判据已跑过，仅「载体有数据」这一组无输入可判`,
    );
    return;
  }

  // 活载体 sanity：verification-round.jsonl 存在且有数据（①），gate-events.jsonl 亦然。
  assert.equal(vr.threeState, THREE_STATES.HAS_DATA);
  assert.ok(vr.recordCount > 0);
  assert.equal(ge.threeState, THREE_STATES.HAS_DATA);
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

// AC3 的**可复现**半边。原 AC 写的前提是「运行时 `.quay/meta-driver-round.jsonl` > 512 MB」——
// 那是个**会自行消失**的前提：2026-10-13 02:35 实测 538,347,409 B，02:37:13 被一个与本任务无关的
// 轮转降到 95,017,936 B（本任务⛔不碰生产载体，DoD 明令）。⇒ 把「超限的真实生产载体」写成一条
// **条件守卫**：当下没有超限载体时它什么都不验（如实说「无输入」），一旦再现就自动对真实载体生效。
test("AC3 guard — any real production carrier over V8's limit is read, not crashed on", { timeout: 120_000 }, (t) => {
  const prodRoot = getAudit().prodRoot;
  const quay = path.join(prodRoot, ".quay");
  if (!fs.existsSync(quay)) {
    t.diagnostic(`NOT-EVALUATED: no production .quay at ${quay}（全新 checkout 的正常形态）`);
    return;
  }
  const oversized = fs.readdirSync(quay, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(jsonl|json)$/i.test(e.name))
    .map((e) => ({ name: e.name, size: fs.statSync(path.join(quay, e.name)).size }))
    .filter((x) => x.size > JS_MAX_STRING_LENGTH);
  if (oversized.length === 0) {
    const biggest = fs.readdirSync(quay, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(jsonl|json)$/i.test(e.name))
      .map((e) => ({ name: e.name, size: fs.statSync(path.join(quay, e.name)).size }))
      .sort((a, b) => b.size - a.size)[0];
    t.diagnostic(
      `NOT-EVALUATED: no production carrier exceeds 0x1fffffe8 right now` +
      `（最大 = ${biggest ? `${biggest.name} ${biggest.size} B` : "无"}）—— 该前提由外部轮转决定，不在本任务控制内`,
    );
    return;
  }
  for (const { name, size } of oversized) {
    const rep = classifyCarrier({
      name, doneTasks: [], prodRoot, gitRoot: prodRoot, retiredTexts: [], predicateHit: null,
      refsById: new Map(), landingById: new Map(), writersById: new Map(),
    });
    // 不抛（抛了这条测试就红）+ 出一个三态判定（⛔ 不是 null/未定义这种「没判」的形态）。
    assert.ok(
      [THREE_STATES.HAS_DATA, THREE_STATES.ZERO_DATA, THREE_STATES.NOT_EVALUATED].includes(rep.threeState),
      `${name} (${size} B) must yield a real three-state verdict, got ${rep.threeState}`,
    );
    assert.ok(rep.reason, `${name} must carry a reason`);
    t.diagnostic(`${name} (${size} B) → ${rep.threeState}: ${rep.reason}`);
  }
});
