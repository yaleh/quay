// @test-group engine
// guard-lineage-check.test.mjs — P4 守卫谱系检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P4).
// Covers the pure primitives on synthetic fixtures (never the live repo — deterministic):
//   - enumerateGuards: 三目录按后缀 -check|-guard|-audit 枚举, 非守卫后缀不数。
//   - classifyDeclaration: file:<path> = file 对象, 其余 = invariant。
//   - parseGuardObjects: 只读声明数据的 GUARD_OBJECT 表 — 同一份数据里其它表 (QUESTION/CADENCE/
//     MATCHING/CONSUMER …) 绝不能被读成守卫对象 (回归: bash 表时代首版 continue 而非 break, 同名覆盖
//     读成 310 条错值; gap-arch-catalog-declarations-leave-bash 把表搬成 JSON 后, 该风险由「按键取表」
//     结构性消除, 本用例仍钉住「只读这一张表」)。
//   - checkObjectPresent: file 存在/缺失, invariant 不可机械核验, 未声明。
//   - readVerdicts: fired 名 / 窗口 / verdict-less 行不计入窗口且不伪造 fired。
//   - isMutationVerified: 有 mutation case 文件才为真。
//   - analyze: AC1 declared-ratio + AC2 fired-ratio + AC3 对象存在 + AC4 preventive/suspicious disposition
//     (checker-mutation-check 是 mutation-verified 预防性守卫 → preventive, 不得报 suspicious)。
//
// Run:
//   node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  enumerateGuards,
  classifyDeclaration,
  parseGuardObjects,
  checkObjectPresent,
  readVerdicts,
  isMutationVerified,
  analyze,
} from "../scripts/guard-lineage-check.ts";

/** Temp dirs created this run — removed in the top-level `after` hook below (test-isolation R6). */
const _createdDirs = [];

/** 本检测器的 CLI 入口（AC3 的 exit-code 断言跑真进程，⛔ 不靠 in-process main 的返回值）。 */
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "guard-lineage-check.ts");

/** Build a temp dir from a {relPath: content} map. Registered for cleanup in the `after` hook. */
function mktmp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glc-test-"));
  _createdDirs.push(dir);
  for (const [rel, data] of Object.entries(contents)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return dir;
}

test("enumerateGuards — 三目录按后缀 -check|-guard|-audit 枚举, 非守卫后缀不数", () => {
  const dir = mktmp({
    "plugin/scripts/foo-check.ts": "",
    "plugin/scripts/bar-guard.sh": "",
    "plugin/scripts/baz-audit.mjs": "",
    "plugin/scripts/plain.ts": "",           // 无 -check/-guard/-audit 后缀
    "plugin/scripts/helper-checker.ts": "",  // -checker ≠ -check
    "experiments/quay-perpetual-stream/scripts/exp-check.sh": "",
    "plugin/gate-scripts/gate-guard.ts": "",
  });
  const guards = enumerateGuards(dir);
  const names = guards.map((g) => g.basename).sort();
  assert.deepEqual(names, ["bar-guard.sh", "baz-audit.mjs", "exp-check.sh", "foo-check.ts", "gate-guard.ts"]);
  const foo = guards.find((g) => g.basename === "foo-check.ts");
  assert.equal(foo.dir, "plugin/scripts");
  assert.equal(foo.relPath, "plugin/scripts/foo-check.ts");
  assert.equal(foo.stem, "foo-check");
});

test("classifyDeclaration — file: / runtime: 两种前缀, 其余 = invariant", () => {
  assert.equal(classifyDeclaration("file:orchestration/x.md").kind, "file");
  assert.equal(classifyDeclaration("file:orchestration/x.md").filePath, "orchestration/x.md");
  // runtime: gitignored 运行时载体 —— 独立 kind（gap-guard-lineage-runtime-carrier-not-evaluated）,
  // ⛔ 不得与 `file` 或 `invariant` 同形。
  assert.equal(classifyDeclaration("runtime:orchestration/tick-log.md").kind, "runtime");
  assert.equal(classifyDeclaration("runtime:orchestration/tick-log.md").filePath, "orchestration/tick-log.md");
  assert.equal(classifyDeclaration("invariant:some contract").kind, "invariant");
  assert.equal(classifyDeclaration("no prefix").kind, "invariant");
  // 前缀必须是**精确**的: `runtimeX:` / `files:` 不是新形态, 仍按 invariant。
  assert.equal(classifyDeclaration("runtimeX:y").kind, "invariant");
});

test("parseGuardObjects — 只读 GUARD_OBJECT 表, 不读进 QUESTION/CADENCE/CONSUMER 等表", () => {
  const declarations = JSON.stringify({
    QUESTION: { "foo-check.sh": "some question", "baz-check.sh": "another question" },
    GUARD_OBJECT: {
      "foo-check.sh": "file:plugin/scripts/foo-check.sh",
      "bar-check.sh": "invariant:bar stays consistent",
    },
    CADENCE: { "foo-check.sh": "每轮", "bar-check.sh": "按需" },
    MATCHING: { "foo-check.sh": "keyword" },
    CONSUMER: { "foo-check.sh": "consumer-facing" },
  });
  const m = parseGuardObjects(declarations);
  assert.equal(m.size, 2, `must read ONLY the GUARD_OBJECT table, got ${m.size}: ${JSON.stringify([...m.keys()])}`);
  assert.equal(m.get("foo-check.sh").kind, "file");
  assert.equal(m.get("foo-check.sh").filePath, "plugin/scripts/foo-check.sh");
  assert.equal(m.get("bar-check.sh").kind, "invariant");
  assert.equal(m.has("baz-check.sh"), false, "a name declared only in QUESTION is not a guard object");
});

test("parseGuardObjects — 读不懂的声明数据 ⇒ 空表 (不是伪造的合格)", () => {
  for (const bad of ["", "not json", "[1,2,3]", JSON.stringify({ QUESTION: {} })]) {
    const m = parseGuardObjects(bad);
    assert.equal(m.size, 0, `unparsable/missing-table input must yield an empty map, got ${m.size} for ${JSON.stringify(bad)}`);
  }
});

test("checkObjectPresent — file 存在/缺失, runtime NOT-EVALUATED, invariant 不可机械核验, 未声明", () => {
  const dir = mktmp({ "a/b.md": "x" });
  assert.equal(checkObjectPresent(dir, classifyDeclaration("file:a/b.md")).present, true);
  assert.equal(checkObjectPresent(dir, classifyDeclaration("file:a/missing.md")).present, false);
  assert.equal(checkObjectPresent(dir, classifyDeclaration("invariant:some rule")).present, null);

  // runtime: 即使该路径**物理上不存在**（快照/worktree 的常态），也必须报 NOT-EVALUATED ——
  // present 非 false、kind 可区分、note 说明原因（⛔ 不是 "object MISSING"）。
  const rtAbsent = checkObjectPresent(dir, classifyDeclaration("runtime:a/manager-tick-log.md"));
  assert.notEqual(rtAbsent.present, false, "runtime carrier absence must NOT read as present:false (would be a fabricated deletion)");
  assert.equal(rtAbsent.present, null);
  assert.equal(rtAbsent.kind, "runtime");
  assert.match(rtAbsent.note, /runtime carrier/);
  assert.doesNotMatch(rtAbsent.note, /MISSING/);
  assert.notEqual(rtAbsent.note, checkObjectPresent(dir, classifyDeclaration("invariant:x")).note,
    "runtime and invariant must not share a note (硬规则 3b: 两种「不可判」各有各的原因)");
  // 差分对照: 同一路径换回 `file:` 前缀 ⇒ present:false (证明分的是**声明种类**, 不是路径存不存在)。
  assert.equal(checkObjectPresent(dir, classifyDeclaration("file:a/manager-tick-log.md")).present, false);

  const und = checkObjectPresent(dir, undefined);
  assert.equal(und.declared, false);
  assert.equal(und.present, null);
});

test("readVerdicts — fired 名 / 窗口 / verdict-less 行不计入窗口且不伪造 fired", () => {
  const dir = mktmp({
    "cost.jsonl": [
      '{"name":"a-check","ms":1,"n":1,"load":1,"at":"2026-09-04T10:00:00Z","verdict":"pass"}',
      '{"name":"b-check","ms":1,"n":1,"load":1,"at":"2026-09-04T11:00:00Z","verdict":"fail"}',
      '{"name":"c-check","ms":1,"n":1,"load":1,"at":"2026-09-04T09:00:00Z"}',
      '{"name":"a-check","ms":1,"n":1,"load":1,"at":"2026-09-04T12:00:00Z","verdict":"fail"}',
      "not-json-line",
    ].join("\n") + "\n",
  });
  const v = readVerdicts(path.join(dir, "cost.jsonl"));
  assert.equal(v.totalRows, 4, "one malformed line is skipped, not counted");
  assert.equal(v.withVerdict, 3);
  assert.equal(v.withoutVerdict, 1);
  assert.deepEqual(v.firedNames, ["a-check", "b-check"]);
  assert.equal(v.window.minAt, "2026-09-04T10:00:00Z");
  assert.equal(v.window.maxAt, "2026-09-04T12:00:00Z");
  assert.equal(v.evaluable, true);
  assert.equal(v.byName.get("a-check").lastFired, "2026-09-04T12:00:00Z");
  assert.equal(v.byName.get("c-check"), undefined, "verdict-less rows never enter byName (not fired, not run)");
});

test("readVerdicts — cost file 缺失 = 不可评估 (不伪造)", () => {
  const dir = mktmp({});
  const v = readVerdicts(path.join(dir, "no-such.jsonl"));
  assert.equal(v.evaluable, false);
  assert.deepEqual(v.firedNames, []);
});

test("isMutationVerified — 有 mutation case 文件才为真", () => {
  const dir = mktmp({
    "plugin/scripts/checker-mutation-cases/foo-check.sh": "",
  });
  assert.equal(isMutationVerified(dir, "foo-check"), true);
  assert.equal(isMutationVerified(dir, "bar-check"), false);
});

test("analyze — AC1/AC2 比例 + AC3 对象存在 + AC4 preventive/suspicious disposition", () => {
  const dir = mktmp({
    "plugin/scripts/checker-mutation-check.sh": "#!/usr/bin/env bash\n",
    "plugin/scripts/manager-tick-log-check.sh": "#!/usr/bin/env bash\n",
    "plugin/scripts/plain-check.ts": "export const x=1;\n",
    "plugin/scripts/checker-mutation-cases/checker-mutation-check.sh": "", // mutation-verified
    "orchestration/manager-tick-log.md": "tick",                          // file object present
    "catalog.json": JSON.stringify({
      QUESTION: { "checker-mutation-check.sh": "q", "manager-tick-log-check.sh": "q", "plain-check.ts": "q" },
      GUARD_OBJECT: {
        "checker-mutation-check.sh": "invariant:checkers can be mutation-reddened (preventive)",
        "manager-tick-log-check.sh": "file:orchestration/manager-tick-log.md",
        "plain-check.ts": "file:orchestration/nonexistent.md",
      },
      CADENCE: { "checker-mutation-check.sh": "每轮" },
    }),
    "cost.jsonl": [
      '{"name":"checker-mutation-check","ms":1,"n":1,"load":1,"at":"2026-09-04T10:00:00Z","verdict":"pass"}',
    ].join("\n") + "\n",
  });
  const report = analyze(dir, { catalogFile: path.join(dir, "catalog.json"), costFile: path.join(dir, "cost.jsonl") });

  // AC1: 3 guards, 3 declared (三个 basename 都在 GUARD_OBJECT)
  assert.equal(report.totalGuards, 3);
  assert.equal(report.declaredCount, 3);
  assert.equal(report.declaredRatio, 1);

  // AC2: 无 fail verdict → 0 fired, 但可评估 (有 verdict 行)
  assert.equal(report.verdict.evaluable, true);
  assert.equal(report.verdict.firedCount, 0);
  assert.equal(report.verdict.firedRatio, 0);

  // AC3: 对象存在性
  const mgr = report.declared.find((d) => d.basename === "manager-tick-log-check.sh");
  assert.equal(mgr.present, true, "file object present");
  const plain = report.declared.find((d) => d.basename === "plain-check.ts");
  assert.equal(plain.present, false, "file object MISSING");
  const cmc = report.declared.find((d) => d.basename === "checker-mutation-check.sh");
  assert.equal(cmc.present, null, "invariant — not mechanically checkable");

  // AC4: checker-mutation-check 是 mutation-verified 预防性守卫 → preventive, 不得报 suspicious
  assert.ok(
    report.preventive.some((p) => p.basename === "checker-mutation-check.sh"),
    "checker-mutation-check must be preventive (mutation-verified)",
  );
  assert.ok(
    !report.suspicious.some((s) => s.basename === "checker-mutation-check.sh"),
    "checker-mutation-check must NOT be flagged suspicious",
  );
  // manager-tick-log-check 无 mutation case → suspicious (诚实的判别力: 不把两者混为一谈)
  assert.ok(report.suspicious.some((s) => s.basename === "manager-tick-log-check.sh"));
});

// ── gap-guard-lineage-runtime-carrier-not-evaluated: runtime: 声明在快照根上报 NOT-EVALUATED ──────
// 缺陷: `file:` 声明一条 gitignored 运行时载体 ⇒ fs.existsSync 的 false 同时代表「对象真被删了」与
// 「该对象是运行时载体、本根构造上就没有它」⇒ 一次从未发生的删除被报成已发生的删除 (硬规则 3b)。
// 本用例在**同一份 fixture 里**同时放 runtime（载体缺失）与 file（真删除缺失）两条，钉住两者取值不同形。
test("analyze — runtime: 声明报 NOT-EVALUATED, 同 fixture 的真缺 file: 对象仍报 MISSING", () => {
  const dir = mktmp({
    "plugin/scripts/manager-tick-log-check.sh": "#!/usr/bin/env bash\n",
    "plugin/scripts/gone-check.ts": "export const x=1;\n",
    // ⛔ 故意【不】创建 orchestration/manager-tick-log.md —— 这正是快照/worktree 的形态。
    "catalog.json": JSON.stringify({
      GUARD_OBJECT: {
        "manager-tick-log-check.sh": "runtime:orchestration/manager-tick-log.md",
        "gone-check.ts": "file:orchestration/absent.md",
      },
    }),
    "cost.jsonl": '{"name":"manager-tick-log-check","ms":1,"n":1,"load":1,"at":"2026-10-01T00:00:00Z","verdict":"pass"}\n',
  });
  const report = analyze(dir, { catalogFile: path.join(dir, "catalog.json"), costFile: path.join(dir, "cost.jsonl") });

  const rt = report.declared.find((d) => d.basename === "manager-tick-log-check.sh");
  assert.equal(rt.kind, "runtime", "kind 必须可区分 (⛔ 不是 file/invariant)");
  assert.notEqual(rt.present, false, "runtime 载体在快照上的缺席不是 present:false");
  assert.equal(rt.present, null);
  assert.match(rt.note, /runtime carrier|NOT-EVALUATED/);
  assert.doesNotMatch(rt.note, /object MISSING/);

  // 负控制 (硬规则 2 的另一半): 真 file: 对象缺失必须**仍然**报 present:false / MISSING ——
  // 修法不得一刀切。
  const gone = report.declared.find((d) => d.basename === "gone-check.ts");
  assert.equal(gone.kind, "file");
  assert.equal(gone.present, false);
  assert.equal(gone.note, "object MISSING");
});

// ── gap-architecture-review-detectors-not-runnable-off-quay-repo: --root 不必是 quay 检出 ────────────
// 旧 CLI 在 `<root>/plugin/scripts` 缺席时 exit 2 ⇒ architecture-review 的 P4 半边在任何第三方宿主上
// 一次都跑不出来。闸已撤；「守卫目录不在 ⇒ 枚举面结构上为空」与「面在、扫过、零守卫」必须同形可区分
// (硬规则 3b) ⇒ rootSurface。
test("AC3 — a root with no guard dir yields a REAL report (exit 0), not `plugin/scripts not found` (exit 2)", () => {
  const dir = mktmp({ "README.md": "# third-party\n" });
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CLI, "--root", dir, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const report = JSON.parse(r.stdout);
  assert.equal(report.totalGuards, 0);
  assert.equal(report.rootSurface.kind, "absent");
  assert.deepEqual(report.rootSurface.absentGuardDirs, ["plugin/scripts", "experiments/quay-perpetual-stream/scripts", "plugin/gate-scripts"]);
  assert.ok(report.rootSurface.note, "降级事实必须随报告一起给出");
  // 声明表来自 **kernel 自己的安装位置**（出厂形态），⛔ 不是这个目标仓的 repo-local 路径。
  assert.equal(report.rootSurface.catalogSource, "kernel-install");
  // ⛔ 与「面在、扫过、零守卫」不同形：补出守卫目录后 kind 变 full。
  fs.mkdirSync(path.join(dir, "plugin", "gate-scripts"), { recursive: true });
  const r2 = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CLI, "--root", dir, "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(r2.stdout).rootSurface.kind, "full");
});

test("AC3 负控制 — 拼错的 --root 仍是 exit 2（环境错误 ≠ 合法目标）", () => {
  const dir = mktmp({ "README.md": "x\n" });
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CLI, "--root", path.join(dir, "nope"), "--json"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not exist/);
});

// 显式 --catalog ⇒ 声明表来源回到 TARGET（脱离 kernel 独立跑的场合），且报告如实标注。
test("AC3 — explicit --catalog keeps the target-side source (catalogSource=target)", () => {
  const dir = mktmp({ "README.md": "x\n", "plugin/scripts/a-check.ts": "" });
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CLI, "--root", dir, "--catalog", path.join(dir, "missing.json"), "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).rootSurface.catalogSource, "target");
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
