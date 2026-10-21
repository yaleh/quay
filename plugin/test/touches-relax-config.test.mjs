// @test-group engine
// touches-relax-config.test.mjs — the contract for plugin/scripts/touches-relax-config.ts, the
// READ-ONLY config face of GOAL-037's adaptive dispatch relaxation (AC-364).
//
// WHAT THIS PINS, AND WHY EACH HALF IS SEPARATELY NECESSARY:
//   (a) 缺省与「显式 off」必须**不同形**（硬规则 3b）：没写 `loop.touches_relax:` 与写了 `mode: off`
//       都读作 off，但 `state` 必须把两者分开——否则「没人要这个东西」与「有人把它关了」在读数上
//       无法区分。
//   (b) 非 off 时 `after_minutes` / `max_relaxed_inflight` **必填、缺则点名、且不回退任何内置数值**
//       （硬规则 4 推论二 / 硬规则 12：本机等价于无限制的字面值换机后就是真限制，且静默）。
//   (c) 两个列表字段缺省 `[]`（空集是合法的「无候选 / 无豁免」），给了就逐元素保留（含 glob）。
//   (d) 非法值 ⇒ 具名 issue + CLI 非零退出 + **原文件一个字节都没被写**（只读）。
//   (e) 判别力不在 (a)–(d) 的绿上——它们区分不了「真校验」与「恒真断言」。故本文件的候选注入点
//       明确：把缺省改成 live、或给 after_minutes 回填一个内置数值，都会让本文件变红（AC6 实证）。
//
// ⛔ 本文件断言的全部是**生产读取器/校验器对 fixture `.quay/config.yml` 字节**读出的读数，不是
// 测试内自造的判定逻辑。

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  TOUCHES_RELAX_SECTION,
  TOUCHES_RELAX_MODES,
  readTouchesRelaxConfig,
  parseTouchesRelaxSection,
  loadTouchesRelaxConfig,
} from "../scripts/touches-relax-config.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(SCRIPT_DIR, "..", "scripts", "touches-relax-config.ts");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
// 每个 mkdtemp 根登记在案、模块收尾统一删（`tmp-leak-pairing-check` 要求每个 mkdtemp 都有配对清理）。
const TMP_ROOTS = [];
after(() => {
  for (const root of TMP_ROOTS) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort：清理失败不该把一次绿的测试变红 */
    }
  }
});

/** A fixture workspace whose `.quay/config.yml` holds EXACTLY `body` (or no file at all when null). */
function fixtureRoot(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "touches-relax-"));
  TMP_ROOTS.push(root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  if (body !== null) fs.writeFileSync(path.join(root, ".quay", "config.yml"), body, "utf8");
  return root;
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const configPath = (root) => path.join(root, ".quay", "config.yml");

/** Run the module's OWN CLI (a real child process) and return its exit code. */
function runCli(root) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", MODULE_PATH, "--validate", "--root", root], {
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── (a) 缺省 vs 显式 off：both read mode off, but state is NOT the same shape (硬规则 3b) ──────────
test("(a) 缺省（无 touches_relax 块）⇒ mode off / state absent；显式 mode: off ⇒ mode off / state off；两者不同形", () => {
  const absentRoot = fixtureRoot("loop:\n  board: native\n");
  const offRoot = fixtureRoot(`loop:\n  board: native\n  ${TOUCHES_RELAX_SECTION}:\n    mode: off\n`);

  // 先钉住读取层：两段 fixture 的 raw 读数本身不同形（present true/false）——这是 state 的原料。
  const absentRead = readTouchesRelaxConfig(absentRoot);
  const offRead = readTouchesRelaxConfig(offRoot);
  assert.equal(absentRead.present, false, "无块 ⇒ present:false");
  assert.equal(absentRead.error, null);
  assert.equal(offRead.present, true, "显式块 ⇒ present:true");
  assert.equal(offRead.error, null);
  assert.deepEqual(offRead.section, { mode: "off" }, "raw section 逐字就是文件里那一行");

  const absent = loadTouchesRelaxConfig(absentRoot);
  const off = loadTouchesRelaxConfig(offRoot);

  // 缺省语义：两者都读作 off。
  assert.equal(absent.mode, "off");
  assert.equal(off.mode, "off");
  assert.equal(absent.mode, off.mode);

  // 三态可分：state 必须把两者分开（双向断言，⛔ 不是单向 notEqual 就算数）。
  assert.strictEqual(absent.state, "absent");
  assert.strictEqual(off.state, "off");
  assert.notStrictEqual(absent.state, off.state);

  // 缺省合法：两者都不得因此产出 issues（也不得报 error）。
  assert.deepEqual(absent.issues, []);
  assert.deepEqual(off.issues, []);
  assert.equal(absent.error, null);
  assert.equal(off.error, null);
  assert.notEqual(absent.config, null);
  assert.notEqual(off.config, null);
});

test("(a2) 块存在但没写 mode 键 ⇒ 读作 off，且 state 也是 off（不是 absent）", () => {
  const root = fixtureRoot(`loop:\n  ${TOUCHES_RELAX_SECTION}:\n    shared_files: []\n`);
  const load = loadTouchesRelaxConfig(root);
  assert.equal(load.mode, "off");
  assert.strictEqual(load.state, "off");
  assert.deepEqual(load.issues, []);
});

test("(a3) 配置文件缺失 / 无 loop: ⇒ present:false（默认关），state absent", () => {
  const noFile = fixtureRoot(null);
  const noLoop = fixtureRoot("providers:\n  native:\n    path: .\n");
  for (const root of [noFile, noLoop]) {
    assert.equal(readTouchesRelaxConfig(root).present, false);
    const load = loadTouchesRelaxConfig(root);
    assert.equal(load.state, "absent");
    assert.equal(load.mode, "off");
    assert.deepEqual(load.issues, []);
    assert.equal(load.error, null);
  }
});

// ── (a4) 读不懂输入不得与「合格」同形（硬规则 3b） ─────────────────────────────────────────────────
test("(a4) YAML 畸形 / loop: 非 mapping ⇒ state invalid + error（⛔ 不得折成 absent/off）", () => {
  const malformed = fixtureRoot("loop:\n  board: native\n   bad-indent: [unclosed\n");
  const badLoop = fixtureRoot("loop: [1, 2, 3]\n");

  const m = loadTouchesRelaxConfig(malformed);
  assert.strictEqual(m.state, "invalid");
  assert.notEqual(m.error, null);
  assert.match(m.error, /FAIL-CLOSED/);
  assert.notStrictEqual(m.state, "absent");
  assert.notStrictEqual(m.state, "off");

  const b = loadTouchesRelaxConfig(badLoop);
  assert.strictEqual(b.state, "invalid");
  assert.match(b.error, /'loop:' must be a mapping/);
});

// ── (b) 非 off 的必填 + 点名 + 无内置回退 ──────────────────────────────────────────────────────────
test("(b) mode: shadow 缺 after_minutes ⇒ ok:false 且 issue 点名 after_minutes；⛔ 无内置回退", () => {
  const raw = { mode: "shadow", max_relaxed_inflight: 2 };
  const r = parseTouchesRelaxSection(raw);
  assert.equal(r.ok, false);
  assert.ok(
    r.issues.some((i) => i.field.includes("after_minutes")),
    `issues 里必须有点名 after_minutes 的条目，实得 ${JSON.stringify(r.issues)}`,
  );
  // 无回退：失败时没有任何 config 被造出来（`ok:false` 那一支根本没有 config 键），更没有任何
  // 内置数值被填进这两键 —— AC3 逐字要求这里读作 `undefined`，⛔ 不是 30/5/1 之类字面量。
  assert.equal(r.config, undefined);
  assert.equal(r.config?.after_minutes, undefined);
  assert.equal(r.config?.max_relaxed_inflight, undefined);
});

test("(b) mode: live 缺 max_relaxed_inflight ⇒ ok:false 且 issue 点名 max_relaxed_inflight；⛔ 无内置回退", () => {
  const r = parseTouchesRelaxSection({ mode: "live", after_minutes: 30 });
  assert.equal(r.ok, false);
  assert.ok(
    r.issues.some((i) => i.field.includes("max_relaxed_inflight")),
    `issues 里必须有点名 max_relaxed_inflight 的条目，实得 ${JSON.stringify(r.issues)}`,
  );
  assert.equal(r.config, undefined);
  assert.equal(r.config?.max_relaxed_inflight, undefined);
  assert.equal(r.config?.after_minutes, undefined);
});

test("(b) 两键都缺 ⇒ 两条 issue 同时在（收集全部，⛔ 不是 fail-fast 只报第一条）", () => {
  const r = parseTouchesRelaxSection({ mode: "live" });
  assert.equal(r.ok, false);
  const fields = r.issues.map((i) => i.field);
  assert.ok(fields.some((f) => f.endsWith(".after_minutes")), JSON.stringify(fields));
  assert.ok(fields.some((f) => f.endsWith(".max_relaxed_inflight")), JSON.stringify(fields));
});

test("(b) off（或缺省 mode）⇒ 两键不要求；config 里这两键【缺席】，只有真给出才出现", () => {
  const off = parseTouchesRelaxSection({ mode: "off" });
  assert.equal(off.ok, true);
  assert.equal(off.config.mode, "off");
  assert.equal("after_minutes" in off.config, false, "⛔ off 下不得凭空出现 after_minutes");
  assert.equal("max_relaxed_inflight" in off.config, false, "⛔ off 下不得凭空出现 max_relaxed_inflight");
  assert.equal(off.config.after_minutes, undefined);
  assert.equal(off.config.max_relaxed_inflight, undefined);

  const noMode = parseTouchesRelaxSection({});
  assert.equal(noMode.ok, true);
  assert.equal(noMode.config.mode, "off");
  assert.equal("after_minutes" in noMode.config, false);
  assert.equal("max_relaxed_inflight" in noMode.config, false);
});

test("(b) 非 off 且两键齐备 ⇒ 读出的就是【给出的值】，不是任何内置数值", () => {
  const r = parseTouchesRelaxSection({ mode: "shadow", after_minutes: 17, max_relaxed_inflight: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.config.after_minutes, 17);
  assert.equal(r.config.max_relaxed_inflight, 3);
});

test("(b) 端到端：mode: shadow 缺 after_minutes 的 fixture ⇒ state invalid + 具名 issue，无 config", () => {
  const root = fixtureRoot(`loop:\n  ${TOUCHES_RELAX_SECTION}:\n    mode: shadow\n    max_relaxed_inflight: 2\n`);
  const load = loadTouchesRelaxConfig(root);
  assert.strictEqual(load.state, "invalid");
  assert.equal(load.error, null);
  assert.ok(load.issues.some((i) => i.field === `loop.${TOUCHES_RELAX_SECTION}.after_minutes`), JSON.stringify(load.issues));
  assert.equal(load.config, null);
  assert.equal(load.mode, "off", "无效声明下 mode 不得读作 shadow（否则与合格同形）");
});

// ── (c) 列表缺省为空 / 逐元素保留 ──────────────────────────────────────────────────────────────────
test("(c) 缺 shared_files / never_relax ⇒ 读出的两者 deepEqual []；给了字符串数组 ⇒ 逐元素保留（含 glob）", () => {
  const absentRoot = fixtureRoot(`loop:\n  ${TOUCHES_RELAX_SECTION}:\n    mode: off\n`);
  const absent = loadTouchesRelaxConfig(absentRoot);
  assert.deepEqual(absent.config.shared_files, []);
  assert.deepEqual(absent.config.never_relax, []);

  const given = {
    mode: "live",
    after_minutes: 45,
    max_relaxed_inflight: 4,
    shared_files: ["packages/quay/src/serve/serve.ts", "**/*.test.mjs"],
    never_relax: ["tasks/**", ".quay/config.yml"],
  };
  const r = parseTouchesRelaxSection(given);
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.shared_files, ["packages/quay/src/serve/serve.ts", "**/*.test.mjs"]);
  assert.deepEqual(r.config.never_relax, ["tasks/**", ".quay/config.yml"]);
});

test("(c2) 列表给了非字符串数组 ⇒ 具名 issue（元素级）", () => {
  const r = parseTouchesRelaxSection({ mode: "off", shared_files: ["ok.ts", 7, ""] });
  assert.equal(r.ok, false);
  const fields = r.issues.map((i) => i.field);
  assert.ok(fields.some((f) => f === `loop.${TOUCHES_RELAX_SECTION}.shared_files[1]`), JSON.stringify(fields));
  assert.ok(fields.some((f) => f === `loop.${TOUCHES_RELAX_SECTION}.shared_files[2]`), JSON.stringify(fields));

  const notArray = parseTouchesRelaxSection({ mode: "off", never_relax: "tasks/**" });
  assert.equal(notArray.ok, false);
  assert.ok(notArray.issues.some((i) => i.field === `loop.${TOUCHES_RELAX_SECTION}.never_relax`), JSON.stringify(notArray.issues));
});

// ── (d) 非法值：具名 issue + CLI 非零退出 + 只读（字节哈希不变） ───────────────────────────────────
const ILLEGAL_CASES = [
  { label: "mode: aggressive（不在词表）", body: `mode: aggressive\n` },
  { label: "after_minutes: 0（非正数）", body: `mode: shadow\n    after_minutes: 0\n    max_relaxed_inflight: 2\n` },
  { label: "after_minutes: -1（非正数）", body: `mode: shadow\n    after_minutes: -1\n    max_relaxed_inflight: 2\n` },
  { label: "max_relaxed_inflight: 1.5（非整数）", body: `mode: live\n    after_minutes: 30\n    max_relaxed_inflight: 1.5\n` },
];

test("(d) 非法值 ⇒ parse ok:false + 具名 issue；CLI 非零退出；fixture 字节哈希前后相同（一个字节没写）", () => {
  for (const c of ILLEGAL_CASES) {
    const root = fixtureRoot(`loop:\n  ${TOUCHES_RELAX_SECTION}:\n    ${c.body}`);
    const file = configPath(root);
    const before = sha256(file);

    // ① 生产校验器对同一段字节的判定。
    const section = readTouchesRelaxConfig(root).section;
    const parsed = parseTouchesRelaxSection(section);
    assert.equal(parsed.ok, false, `${c.label} 必须被判不合格`);
    assert.ok(parsed.issues.length > 0, `${c.label} 必须有具名 issue`);
    for (const issue of parsed.issues) {
      assert.ok(issue.field.startsWith(`loop.${TOUCHES_RELAX_SECTION}`), `issue.field 必须可定位：${issue.field}`);
      assert.ok(issue.message.length > 0);
    }

    // ② 模块自己 CLI 的真实退出码（不是测试内推的）。
    const cli = runCli(root);
    assert.notEqual(cli.code, 0, `${c.label} ⇒ CLI 必须非零退出（实得 ${cli.code}）`);
    assert.match(cli.stdout, /NOT-QUALIFIED/);

    // ③ 只读：跑完一个字节都没动。
    const after = sha256(file);
    assert.equal(after, before, `${c.label} ⇒ CLI 不得写 .quay/config.yml（${before} → ${after}）`);
  }
});

test("(d2) CLI 退出码的三态：合格 0 / 不合格 1 / 用法错误 2；合格路径也不写文件", () => {
  const absentRoot = fixtureRoot("loop:\n  board: native\n");
  const validRoot = fixtureRoot(
    `loop:\n  ${TOUCHES_RELAX_SECTION}:\n    mode: shadow\n    after_minutes: 20\n    max_relaxed_inflight: 1\n`,
  );
  const invalidRoot = fixtureRoot(`loop:\n  ${TOUCHES_RELAX_SECTION}:\n    mode: aggressive\n`);

  assert.equal(runCli(absentRoot).code, 0, "缺省（未声明）是合格的");
  assert.equal(runCli(validRoot).code, 0, "合法声明是合格的");
  assert.equal(runCli(invalidRoot).code, 1, "非法声明不合格");

  const usage = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", MODULE_PATH, "--validate", "--root"], {
    encoding: "utf8",
  });
  assert.equal(usage.status, 2, "--root 缺值 ⇒ 用法错误 2");
  const noVerb = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", MODULE_PATH, "--root", validRoot], {
    encoding: "utf8",
  });
  assert.equal(noVerb.status, 2, "缺 --validate ⇒ 用法错误 2");

  // 合格路径同样只读。
  const file = configPath(validRoot);
  const before = sha256(file);
  runCli(validRoot);
  assert.equal(sha256(file), before);
});

test("(d3) CLI --json 的载荷可与文本读数对齐（state/mode/qualified 三处一致）", () => {
  const root = fixtureRoot(`loop:\n  ${TOUCHES_RELAX_SECTION}:\n    mode: off\n`);
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", MODULE_PATH, "--validate", "--root", root, "--json"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.qualified, true);
  assert.equal(payload.state, "off");
  assert.equal(payload.mode, "off");
  assert.deepEqual(payload.issues, []);
});

// ── 词表 / 常量面（防止别处再拼一份字面量） ─────────────────────────────────────────────────────────
test("词表单源：TOUCHES_RELAX_MODES 恰好是 off|shadow|live，缺省是 off", async () => {
  assert.deepEqual([...TOUCHES_RELAX_MODES], ["off", "shadow", "live"]);
  assert.equal(TOUCHES_RELAX_SECTION, "touches_relax");
  const mod = await import("../scripts/touches-relax-config.ts");
  assert.equal(mod.DEFAULT_TOUCHES_RELAX_MODE, "off");
});
