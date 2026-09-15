// @test-group engine
// probe-routine.test.mjs — the probe track bridge (SPEC-capability-planes-and-mechanism-lifecycle
// §5.2): `.quay/config.yml` `loop.routines:` declaration → live Layer-1b RoutineSpec → fresh-context
// probe spawn → STRUCTURED findings carrier.
//
// Task: gap-productize-deep-semantic-dedup-scan-routine.
//
// What is pinned here:
//   (a) the config reader's contract + a NO-DRIFT assertion against the canonical product reader
//       (`packages/quay/src/loop-params.ts` readLoopParams) — two readers, one acceptance;
//   (b) the declaration → routine selection (interval:<N>m only; legacy every(N)/on(<event>) are
//       skipped WITH a visible reason, never silently);
//   (c) the structured-output parser (files + symbols + rationale required; malformed counted, not
//       dropped) and its negative controls (garbage ⇒ null; a boolean ⇒ nothing usable);
//   (d) the routine's run(): carrier records + durable last-run, and the negative controls that make
//       those readings takeable-false — FILE-ONLY violation ⇒ nothing recorded, unparseable output
//       ⇒ nothing recorded, halted ⇒ no spawn, within-window ⇒ no second run, missing probe spec ⇒
//       not-evaluated (⛔ never "found nothing");
//   (e) the driver wiring end-to-end: `quality-gate-driver --once` on a temp workspace with a
//       declared probe routine runs it and appends to the carrier (fake probe runner — ⛔ no LLM).
//
// Run:
//   scripts/test.sh plugin/test/probe-routine.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ROUTINE_FINDINGS_REL,
  ROUTINE_LAST_RUN_REL,
  llmProbeRoutine,
  parseProbeFindings,
  probeRoutinesFromConfig,
  readRoutinesConfig,
  readLastRunMap,
  selectFilings,
  selectProbeRoutines,
} from "../scripts/probe-routine.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DRIVER = path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts");

/** 本文件建过的所有临时目录（tmp-leak-pairing 的 carrier-array 形态：数组在 after() 清理区里被
 *  引用 ⇒ 每条 push 进它的 mkdtemp 都算「有配对清理」，⛔ 不是每个用例各写一遍 rmSync）。 */
const CREATED_DIRS = [];
after(() => {
  for (const d of CREATED_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

/** mkdtemp + 登记到 CREATED_DIRS（统一由文件级 after() 清理）——⛔ 调用点不再直接 mkdtempSync。 */
function makeTmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  CREATED_DIRS.push(d);
  return d;
}

/** 一个最小工作区：`.quay/config.yml`（可选）+ `plugin/probes/<name>.md` + git repo（FILE-ONLY 快照
 *  要求 git；⛔ 非 git 目录 ⇒ 守卫读不出 ⇒ 例程正确地拒记，见 readLastRunMap 的兄弟用例）。 */
function makeWorkspace({ config, probeName = "semantic-dedup-scan", probeBody = "INVENTORY the repo.\n" } = {}) {
  const root = makeTmpDir("probe-routine-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "probes"), { recursive: true });
  if (config !== undefined) fs.writeFileSync(path.join(root, ".quay", "config.yml"), config, "utf8");
  if (probeName) {
    fs.writeFileSync(path.join(root, "plugin", "probes", `${probeName}.md`),
      `---\ninstrument: archguard\nfallback: git-lens\noutput_routing:\n  duplication: milestone-candidate\n---\n${probeBody}`, "utf8");
  }
  spawnSync("git", ["-C", root, "init", "-q"], { encoding: "utf8" });
  return root;
}

const CONFIG_WITH_ROUTINE = [
  "loop:",
  "  routines:",
  "    - name: semantic-dedup-scan",
  "      trigger: interval:1440m",
  "      probe: semantic-dedup-scan",
  "",
].join("\n");

/** 假探针 = 打印契约要求的那一个 JSON 对象的 argv（⛔ 不 spawn 真 LLM）。 */
function fakeProbeArgv(payload) {
  const script = path.join(os.tmpdir(), `fake-probe-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(script, `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`, "utf8");
  return [process.execPath, script];
}

const FINDING = {
  id: "findRepoRoot",
  kind: "byte-identical-body",
  symbols: ["findRepoRoot"],
  files: ["plugin/scripts/a.ts:10", "packages/quay/src/b.ts:22"],
  verdict: "real-duplication",
  rationale: "identical normalized bodies",
  suggestedAction: "extract",
};

function readCarrier(root, stateDir) {
  const p = path.join(stateDir ?? path.join(root, ".quay"), path.basename(ROUTINE_FINDINGS_REL));
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ── (a) config reader + no-drift against the canonical reader ───────────────────────────────────

test("readRoutinesConfig — absent file/section ⇒ [] (optional section, same contract as suite-params)", () => {
  const bare = makeTmpDir("probe-cfg-bare-");
  assert.deepEqual(readRoutinesConfig(bare), []);
  const noSection = makeTmpDir("probe-cfg-nosection-");
  fs.mkdirSync(path.join(noSection, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(noSection, ".quay", "config.yml"), "providers: {}\n", "utf8");
  assert.deepEqual(readRoutinesConfig(noSection), []);
});

test("readRoutinesConfig — fail-closed on malformed YAML / wrong shape / bad trigger / no probe|dispatch", () => {
  const cases = [
    ["loop:\n  routines: [\n", /malformed YAML/],
    ["loop:\n  routines: not-an-array\n", /must be an array/],
    ["loop:\n  routines:\n    - trigger: interval:10m\n      probe: x\n", /needs a non-empty string 'name'/],
    ["loop:\n  routines:\n    - name: x\n      probe: y\n", /needs a string 'trigger'/],
    ["loop:\n  routines:\n    - name: x\n      trigger: sometimes\n      probe: y\n", /invalid trigger/],
    ["loop:\n  routines:\n    - name: x\n      trigger: interval:10m\n", /needs 'probe'/],
  ];
  for (const [cfg, re] of cases) {
    const root = makeTmpDir("probe-cfg-bad-");
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"), cfg, "utf8");
    assert.throws(() => readRoutinesConfig(root), re, `must reject: ${JSON.stringify(cfg)}`);
  }
});

test("NO-DRIFT — readRoutinesConfig agrees with the canonical reader readLoopParams on the same fixtures", async () => {
  // 第二个读者（kernel 侧，第三方工作区拿不到 packages/quay/src）必须与正本接受/拒绝同一批输入，
  // 否则两条 parser 会各自漂移（硬规则 5b）。正本经 pathToFileURL 动态 import（跨包，测试可读）。
  const { readLoopParams } = await import(pathToFileURL(path.join(REPO_ROOT, "packages", "quay", "src", "loop-params.ts")).href);
  const fixtures = [
    ["loop:\n  board: native\n  gates: [acceptance]\n  routines:\n    - name: semantic-dedup-scan\n      trigger: interval:1440m\n      probe: semantic-dedup-scan\n", true],
    ["loop:\n  board: native\n  gates: [acceptance]\n  routines: []\n", true],
    ["loop:\n  routines:\n    - name: x\n      trigger: sometimes\n      probe: y\n", false],
    ["loop:\n  routines:\n    - trigger: interval:10m\n      probe: y\n", false],
    ["loop:\n  routines:\n    - name: x\n      trigger: interval:10m\n", false],
    ["loop:\n  routines: nope\n", false],
  ];
  for (const [cfg, ok] of fixtures) {
    const root = makeTmpDir("probe-nodrift-");
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"), cfg, "utf8");
    let mine = null;
    try { mine = readRoutinesConfig(root); } catch { mine = null; }
    let canon = null;
    try { canon = readLoopParams(root).routines; } catch { canon = null; }
    assert.equal(mine !== null, ok, `readRoutinesConfig acceptance mismatch for ${JSON.stringify(cfg)}`);
    assert.equal(canon !== null, ok, `readLoopParams acceptance mismatch for ${JSON.stringify(cfg)}`);
    if (ok && Array.isArray(canon) && canon.length) {
      assert.deepEqual(mine.map((r) => [r.name, r.trigger]), canon.map((r) => [r.name, r.trigger]),
        "both readers must yield the same (name, trigger) pairs");
    }
  }
});

// ── (b) selection: only two-layer interval declarations are drivable here ───────────────────────

test("selectProbeRoutines — interval+probe drives; legacy every(N)/on(event)/dispatch-only are SKIPPED with a reason", () => {
  const { probes, skipped } = selectProbeRoutines([
    { name: "semantic-dedup-scan", trigger: "interval:1440m", probe: "semantic-dedup-scan", dispatch: null },
    { name: "self-validation", trigger: "every(5)", probe: "self-validation", dispatch: null },
    { name: "history-mining", trigger: "every(10)", probe: "history-mining", dispatch: null },
    { name: "event-y", trigger: "on(checkpoint)", probe: "event-y", dispatch: null },
    { name: "legacy", trigger: "interval:60m", probe: null, dispatch: "do-something" },
  ]);
  assert.deepEqual(probes.map((p) => p.name), ["semantic-dedup-scan"]);
  assert.deepEqual(skipped.map((s) => s.name), ["self-validation", "history-mining", "event-y", "legacy"]);
  for (const s of skipped) assert.ok(s.reason.length > 10, `skip reason for ${s.name} must be visible: ${s.reason}`);
  assert.match(skipped.find((s) => s.name === "self-validation").reason, /'every'|iteration/);
});

// ── (c) the structured-output parser ────────────────────────────────────────────────────────────

test("parseProbeFindings — one JSON object in, structured findings out (fenced / prose-wrapped ok)", () => {
  const payload = { findings: [FINDING], shards: 4, inventory: { plugin_scripts: 2100, package_src: 370, candidate_clusters: 15 }, notes: "bounded" };
  for (const stdout of [
    JSON.stringify(payload),
    "```json\n" + JSON.stringify(payload) + "\n```",
    "Here is the result:\n" + JSON.stringify(payload) + "\nDone.",
  ]) {
    const parsed = parseProbeFindings(stdout);
    assert.ok(parsed, `must parse: ${stdout.slice(0, 40)}`);
    assert.equal(parsed.findings.length, 1);
    assert.deepEqual(parsed.findings[0].files, FINDING.files);
    assert.deepEqual(parsed.findings[0].symbols, FINDING.symbols);
    assert.equal(parsed.shards, 4);
    assert.deepEqual(parsed.inventory, { plugin_scripts: 2100, package_src: 370, candidate_clusters: 15 });
    assert.equal(parsed.malformed, 0);
  }
});

test("parseProbeFindings — a boolean / prose / garbage is NOT usable; malformed findings are COUNTED, not dropped", () => {
  assert.equal(parseProbeFindings("yes, there is duplication"), null);
  assert.equal(parseProbeFindings(""), null);
  assert.equal(parseProbeFindings("duplication: true"), null);
  // 散文夹带多个对象/文本里有裸花括号 ⇒ 仍要取出契约那一个（真实探针的常见形态，2026-09-13 实测:
  // 第一次真跑就是「exit 0 但读不出」而当时没有诊断落盘）
  const wrapped = parseProbeFindings(`Scan complete.\n` + JSON.stringify({ findings: [FINDING], shards: 2 }) + `\n(see {the} report)`);
  assert.ok(wrapped, "prose + a trailing brace must still yield the contract object");
  assert.equal(wrapped.findings.length, 1);
  assert.equal(wrapped.shards, 2);
  const parsed = parseProbeFindings(JSON.stringify({
    findings: [
      FINDING,
      { symbols: ["x"], files: ["a.ts:1"] },                       // missing rationale
      { files: ["a.ts:1"], rationale: "r" },                        // missing symbols
      { symbols: ["x"], rationale: "r" },                           // missing files
      "not an object",
    ],
  }));
  assert.equal(parsed.findings.length, 1, "only the well-formed finding survives");
  assert.equal(parsed.malformed, 4, "⛔ malformed must be counted, never silently dropped");
});

// ── (d) the routine's run() ─────────────────────────────────────────────────────────────────────

test("llmProbeRoutine — real run appends a round record + one record per finding, and remembers last-run", async () => {
  const root = makeWorkspace({ config: CONFIG_WITH_ROUTINE });
  const sel = probeRoutinesFromConfig(root, { pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000 });
  assert.equal(sel.error, null);
  assert.equal(sel.routines.length, 1);
  const routine = sel.routines[0];
  assert.equal(routine.name, "semantic-dedup-scan");
  assert.deepEqual(routine.schedule, { kind: "interval", minutes: 1440 }, "触发形态 = 两层模式时间量");

  const r2 = llmProbeRoutine({ name: "semantic-dedup-scan", trigger: "interval:1440m", probe: "semantic-dedup-scan", dispatch: null }, {
    root, pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000,
    probeArgv: () => fakeProbeArgv({ findings: [FINDING, { ...FINDING, id: "second" }], shards: 3, inventory: { plugin_scripts: 2, package_src: 1, candidate_clusters: 1 } }),
  });
  const facts = await r2.run({ halted: false });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].name, "semantic-dedup-scan");
  assert.equal(facts[0].state, "verified", `expected verified, got ${facts[0].state}: ${facts[0].reason}`);
  assert.equal(facts[0].value.findings, 2);
  assert.equal(facts[0].value.shards, 3);

  const records = readCarrier(root);
  // 3 条扫描记录（1 scan-round + 2 finding）**外加** 1 条立案轮记录（gap-ac214-fifth-crossing-…：
  // append 之后的机械立案步）。按 kind 断言，⛔ 不数总数——总数会随立案步的落痕条数漂移。
  assert.equal(records.filter((r) => r.kind !== "filing-round").length, 3, "one scan-round record + one record per finding");
  assert.equal(records.filter((r) => r.kind === "filing-round").length, 1, "append 之后必须留下一条立案轮记录");
  assert.equal(records[0].kind, "scan-round");
  assert.equal(records[0].findings, 2);
  assert.deepEqual(records[0].inventory, { plugin_scripts: 2, package_src: 1, candidate_clusters: 1 });
  const findingRecords = records.filter((r) => r.kind === "finding");
  assert.equal(findingRecords.length, 2);
  assert.deepEqual(findingRecords[0].files, FINDING.files, "AC2 ③: 具体文件路径");
  assert.deepEqual(findingRecords[0].symbols, FINDING.symbols, "AC2 ③: 函数名");
  assert.ok(findingRecords[0].rationale.length > 0, "AC2 ③: 判定理由");

  const lastRun = readLastRunMap(path.join(root, ".quay", path.basename(ROUTINE_LAST_RUN_REL)));
  assert.ok(lastRun["semantic-dedup-scan"] > 0, "durable last-run written (driver restart must not re-fire)");
});

test("llmProbeRoutine NEGATIVE CONTROL — within the durable window it does NOT spawn and does NOT append", async () => {
  const root = makeWorkspace({ config: CONFIG_WITH_ROUTINE });
  let spawns = 0;
  const mk = () => llmProbeRoutine({ name: "semantic-dedup-scan", trigger: "interval:1440m", probe: "semantic-dedup-scan", dispatch: null }, {
    root, pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000,
    probeArgv: () => fakeProbeArgv({ findings: [FINDING], shards: 2 }),
    spawnFn: async (argv, opts) => { spawns += 1; const { runAsync } = await import("../scripts/driver-runtime.ts"); return runAsync(argv, opts); },
  });
  const first = await mk().run({ halted: false });
  assert.equal(first[0].state, "verified");
  const after1 = readCarrier(root).length;
  const second = await mk().run({ halted: false });
  assert.equal(second[0].state, "not-evaluated");
  assert.match(second[0].reason, /within durable last-run window/);
  assert.equal(spawns, 1, "⛔ the second run must not spawn");
  assert.equal(readCarrier(root).length, after1, "⛔ the second run must not append");
});

test("llmProbeRoutine NEGATIVE CONTROL — FILE-ONLY violation ⇒ failed and NOTHING recorded (guard takes false)", async () => {
  const root = makeWorkspace({ config: CONFIG_WITH_ROUTINE });
  fs.writeFileSync(path.join(root, "tracked.txt"), "before\n", "utf8");
  spawnSync("git", ["-C", root, "add", "-A"], { encoding: "utf8" });
  spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { encoding: "utf8" });
  const routine = llmProbeRoutine({ name: "semantic-dedup-scan", trigger: "interval:1440m", probe: "semantic-dedup-scan", dispatch: null }, {
    root, pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000,
    probeArgv: () => fakeProbeArgv({ findings: [FINDING], shards: 2 }),
    // 假探针「违约」：spawn 期间改一个 tracked 文件（真实探针若越权写就是这个形状）。
    spawnFn: async (argv, opts) => {
      fs.writeFileSync(path.join(root, "tracked.txt"), "changed by a rogue probe\n", "utf8");
      const { runAsync } = await import("../scripts/driver-runtime.ts");
      return runAsync(argv, opts);
    },
  });
  const facts = await routine.run({ halted: false });
  assert.equal(facts[0].state, "failed");
  assert.match(facts[0].reason, /violated FILE-ONLY/);
  assert.deepEqual(facts[0].value.writeViolations, ["tracked.txt"]);
  assert.equal(readCarrier(root).length, 0, "⛔ a rogue probe's output must not be recorded");
  assert.deepEqual(readLastRunMap(path.join(root, ".quay", path.basename(ROUTINE_LAST_RUN_REL))), {},
    "⛔ a rejected run must not consume the interval window");
});

test("llmProbeRoutine — halted / missing probe spec / unparseable output each land on their own state", async () => {
  const root = makeWorkspace({ config: CONFIG_WITH_ROUTINE });
  const base = { root, pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000 };
  const decl = { name: "semantic-dedup-scan", trigger: "interval:1440m", probe: "semantic-dedup-scan", dispatch: null };

  // halted ⇒ no spawn (halt gates the spawn, not the routine track)
  let spawns = 0;
  const halted = await llmProbeRoutine(decl, { ...base, probeArgv: () => fakeProbeArgv({ findings: [] }), spawnFn: async () => { spawns += 1; return { status: 0, stdout: "", stderr: "", error: null }; } }).run({ halted: true });
  assert.equal(halted[0].state, "not-evaluated");
  assert.match(halted[0].reason, /halted/);
  assert.equal(spawns, 0);
  assert.equal(readCarrier(root).length, 0, "⛔ halted observation must not record a fake result");

  // missing probe spec ⇒ not-evaluated (⛔ never "found nothing")
  const missing = await llmProbeRoutine({ ...decl, probe: "does-not-exist" }, { ...base }).run({ halted: false });
  assert.equal(missing[0].state, "not-evaluated");
  assert.match(missing[0].reason, /probe spec unreadable/);

  // unparseable output ⇒ failed, nothing recorded
  const junk = await llmProbeRoutine(decl, { ...base, probeArgv: () => fakeProbeArgv("nope"), spawnFn: async () => ({ status: 0, stdout: "duplication: true", stderr: "", error: null }) }).run({ halted: false });
  assert.equal(junk[0].state, "failed");
  assert.match(junk[0].reason, /unparseable/);
  assert.equal(readCarrier(root).length, 0, "⛔ a boolean answer is not a finding");

  // non-git workspace ⇒ the FILE-ONLY guard cannot read the tree ⇒ not-evaluated (⛔ not "clean")
  const nogit = makeTmpDir("probe-nogit-");
  fs.mkdirSync(path.join(nogit, "plugin", "probes"), { recursive: true });
  fs.writeFileSync(path.join(nogit, "plugin", "probes", "semantic-dedup-scan.md"), "---\ninstrument: none\n---\nbody\n", "utf8");
  const guarded = await llmProbeRoutine(decl, { ...base, root: nogit, pluginRoot: path.join(nogit, "plugin"), probeArgv: () => fakeProbeArgv({ findings: [FINDING] }) }).run({ halted: false });
  assert.equal(guarded[0].state, "not-evaluated");
  assert.match(guarded[0].reason, /FILE-ONLY guard could not read the tree/);
  assert.equal(readCarrier(nogit).length, 0);
});

// ── (e) driver wiring end-to-end (fake probe runner — ⛔ no LLM is spawned) ─────────────────────

test("quality-gate-driver --once runs the config-declared probe routine and appends to the carrier", (t) => {
  const root = makeWorkspace({ config: CONFIG_WITH_ROUTINE });
  const stateDir = makeTmpDir("probe-state-");
  const roundLog = path.join(root, ".quay", "quality-round.jsonl");
  const probeScript = path.join(stateDir, "fake-probe.mjs");
  fs.writeFileSync(probeScript, `process.stdout.write(${JSON.stringify(JSON.stringify({ findings: [{ id: "dup1", kind: "same-symbol-multi-file", symbols: ["findRepoRoot"], files: ["plugin/scripts/a.ts:1", "plugin/scripts/b.ts:2"], verdict: "real-duplication", rationale: "same body", suggestedAction: "extract" }], shards: 5, inventory: { plugin_scripts: 3, package_src: 2, candidate_clusters: 1 } }))});`, "utf8");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 其余四条例程喂假命令（与 quality-gate-driver.test.mjs 同法），使这条用例只测 probe 接线。
  const fake = (name, body) => { const p = path.join(stateDir, name); fs.writeFileSync(p, body, "utf8"); return p; };
  const planCmd = fake("plan.js", `process.stdout.write(JSON.stringify({triggers:{fired:false,reasons:[],poolCount:0,oldestUnreviewedAgeMs:0,roundsSinceLastJudge:0},pool:[],tasks:[],lastJudgeState:{status:"ok"}}));`);
  const judgmentCmd = fake("judgment.js", `process.stdout.write(JSON.stringify({mode:"judgment-consumer-audit",judgments_total:1,wired:1,unfinished:[],drift:false}));`);
  const packagingCmd = fake("packaging.js", `process.stdout.write(JSON.stringify({mode:"packaging-hygiene-audit",configKeys:{keysTotal:0,noConsumerToWire:[],state:"verified"},shippedEntries:{state:"verified",violations:[],reason:null},drift:[]}));`);
  const identityCmd = fake("identity.js", `process.stdout.write(JSON.stringify({mode:"identity-replication",rows:[],literalReplication:[],judgmentRewrites:[]}));`);
  const lineageCmd = fake("lineage.js", `process.stdout.write(JSON.stringify({mode:"guard-lineage",guards:[]}));`);
  const r = spawnSync(process.execPath, [
    "--experimental-strip-types", DRIVER, "--root", root, "--once", "--round-log", roundLog,
    "--probe-state-dir", stateDir,
    "--probe-runner-cmd", `${process.execPath} ${probeScript}`,
    "--plan-cmd", `node ${planCmd}`, "--judgment-cmd", `node ${judgmentCmd}`,
    "--packaging-check-cmd", `node ${packagingCmd}`,
    "--identity-cmd", `node ${identityCmd}`, "--lineage-cmd", `node ${lineageCmd}`,
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, `driver --once should exit 0 (stderr: ${r.stderr})`);
  const rec = JSON.parse(fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim())[0]);
  const probeFacts = rec.facts.filter((f) => f.name === "semantic-dedup-scan");
  assert.equal(probeFacts.length, 1, `the declared probe routine must be in the routine table (facts: ${rec.facts.map((f) => f.name).join(",")})`);
  assert.equal(probeFacts[0].state, "verified", probeFacts[0].reason);
  assert.equal(probeFacts[0].value.shards, 5);

  const records = readCarrier(root, stateDir);
  assert.equal(records.filter((x) => x.kind === "finding").length, 1,
    "the production call path appends structured findings to the carrier (⛔ not a boolean)");
  assert.deepEqual(records.filter((x) => x.kind === "finding")[0].files, ["plugin/scripts/a.ts:1", "plugin/scripts/b.ts:2"]);
  // 老四条照旧（本任务不改它们的形状）
  assert.deepEqual(rec.facts.filter((f) => !f.name.startsWith("semantic-dedup")).map((f) => f.name).sort(),
    ["architecture-review", "judgment-consumer-check", "packaging-hygiene", "pool-quality-judge"]);
});

// ── (f) the mechanical FILING step (tasks/gap-ac214-fifth-crossing-routine-detects-but-nothing-acts) ─
//
// THE DEFECT THIS PINS: the mechanical channel appended findings to `.quay/routine-findings.jsonl`
// and stopped. 61 finding records / 57 distinct findingIds landed there; `grep -rl <id> tasks/`
// matched ZERO of them ⇒ "the routine is running and has findings" was indistinguishable from "the
// gap is being handled" (硬规则 3b / 硬规则 9). These cases make the filing step takeable-false:
//   (i)   a finding naming an UNREGISTERED producer ⇒ the run is `failed` and NAMES IT (AC5 red side);
//   (ii)  register that producer ⇒ `verified` and the task file exists (AC5 green side);
//   (iii) filing switched off ⇒ NO task at all (AC6's "关掉产出面 ⇒ 不产出" reverse control);
//   (iv)  a `leave` verdict is a MEASUREMENT, not work ⇒ never filed (keeps the track non-noisy);
//   (v)   the selector is PURE — run over the repo's real carrier it writes nothing (AC5's
//         "对生产载体跑一次真实读数" is only a reading if it cannot change the thing it reads).

const FRESHNESS_FINDING = {
  id: "freshness-goal-009-ac-207",
  kind: "stale-subject",
  symbols: ["coldstart-face"],
  files: ["plugin/freshness-producers.json:32", ".quay/productization-verification.jsonl:166"],
  verdict: "act-now",
  rationale: "delivery-face evidence for AC-207 is d=192 commits behind the develop tip — the window closes mid-flight",
  suggestedAction: "re-run coldstart-face on hosts B C",
  producer: "coldstart-face",
};

/** 工作区：一条声明了产出者登记面的 probe 例程 + 空的 `tasks/` 板 + git 仓库。 */
function makeFilingWorkspace({ registeredProducers = [], finding = FRESHNESS_FINDING, declareRegistry = true } = {}) {
  const root = makeTmpDir("probe-filing-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "probes"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), [
    "loop:", "  routines:", "    - name: freshness-refresh", "      trigger: interval:120m",
    "      probe: freshness-refresh", "",
  ].join("\n"), "utf8");
  const routing = declareRegistry ? "output_routing:\n  stale-subject: milestone-candidate\n  producers_file: plugin/freshness-producers.json\n" : "output_routing:\n  stale-subject: milestone-candidate\n";
  fs.writeFileSync(path.join(root, "plugin", "probes", "freshness-refresh.md"),
    `---\ninstrument: none\nfallback: none\n${routing}---\nReport stale subjects.\n`, "utf8");
  fs.writeFileSync(path.join(root, "plugin", "freshness-producers.json"),
    JSON.stringify({ producers: registeredProducers.map((id) => ({ id, subjects: [] })) }), "utf8");
  spawnSync("git", ["-C", root, "init", "-q"], { encoding: "utf8" });
  return root;
}

/** 跑一次例程（假探针 = 直接打印 finding JSON，⛔ 不 spawn LLM），并捕获它请求立的任务。 */
async function runFilingRoutine(root, finding, extra = {}) {
  const written = [];
  const routine = llmProbeRoutine(
    { name: "freshness-refresh", trigger: "interval:120m", probe: "freshness-refresh", dispatch: null },
    {
      root, pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000,
      probeArgv: () => fakeProbeArgv({ findings: [finding], shards: 1 }),
      fileTaskFn: async (taskId, title, body) => { written.push({ taskId, title, body }); return { ok: true, reason: `filed as ${taskId}` }; },
      ...extra,
    },
  );
  const facts = await routine.run({ halted: false });
  return { facts, written };
}

test("FILING AC5 (red side) — a finding naming an UNREGISTERED producer fails the run and NAMES it", async () => {
  const root = makeFilingWorkspace({ registeredProducers: ["upgrade-face"] });
  const { facts, written } = await runFilingRoutine(root, FRESHNESS_FINDING);
  assert.equal(facts[0].state, "failed", "an unregistered producer is a probe-integrity failure, not a routine no-op");
  assert.match(facts[0].reason, /UNREGISTERED producer/);
  assert.match(facts[0].reason, /freshness-goal-009-ac-207/, "⛔ 逐条指名：the finding id must appear");
  assert.match(facts[0].reason, /coldstart-face/, "⛔ 逐条指名：the offending producer must appear");
  assert.equal(written.length, 0, "⛔ a phantom producer must never reach the board");
  // and the disposition is recorded on the carrier (⛔ not silently dropped — 硬规则 3)
  const round = readCarrier(root).find((r) => r.kind === "filing-round");
  assert.ok(round, "the filing round must leave a record");
  assert.equal(round.filed.length, 0);
  assert.equal(round.rejected[0].gate, "producer");
  assert.match(round.rejected[0].reason, /not registered/);
});

test("FILING AC5 (green side) — register the producer and the SAME finding files a task, verbatim", async () => {
  const root = makeFilingWorkspace({ registeredProducers: ["coldstart-face", "upgrade-face"] });
  const { facts, written } = await runFilingRoutine(root, FRESHNESS_FINDING);
  assert.equal(facts[0].state, "verified", facts[0].reason);
  assert.equal(written.length, 1, "the registered finding must be filed");
  assert.equal(facts[0].value.filed.length, 1);
  // AC6: the task's `## Finding` corresponds VERBATIM to the routine finding.
  assert.ok(written[0].body.includes(FRESHNESS_FINDING.rationale), "the task body must quote the finding's rationale verbatim");
  assert.ok(written[0].body.includes("coldstart-face"), "the named producer must survive into the task");
  assert.ok(written[0].body.includes("freshness-goal-009-ac-207"), "the finding id must survive into the task");
  assert.match(written[0].taskId, /^gap-routine-freshness-refresh-/);
  const round = readCarrier(root).find((r) => r.kind === "filing-round");
  assert.deepEqual(round.filed, [written[0].taskId]);
});

test("FILING AC6 reverse control — with filing switched off the SAME finding produces NO task", async () => {
  const on = makeFilingWorkspace({ registeredProducers: ["coldstart-face"] });
  const a = await runFilingRoutine(on, FRESHNESS_FINDING);
  assert.equal(a.written.length, 1, "control baseline: it DOES file when enabled");
  const off = makeFilingWorkspace({ registeredProducers: ["coldstart-face"] });
  const b = await runFilingRoutine(off, FRESHNESS_FINDING, { filingEnabled: false });
  assert.equal(b.written.length, 0, "⛔ 关掉产出面 ⇒ 不产出（区分「立案步在工作」与「恒有输出」）");
  const round = readCarrier(off).find((r) => r.kind === "filing-round");
  assert.equal(round.evaluated, false, "the round must record that it did not evaluate");
  assert.deepEqual(round.filed, []);
  assert.equal(readCarrier(on).filter((r) => r.kind === "finding").length, 1, "the scan itself still ran (only filing was off)");
});

test("FILING — a `leave` verdict is a measurement, not work ⇒ never filed (the track must not become noise)", async () => {
  const root = makeFilingWorkspace({ registeredProducers: ["coldstart-face"] });
  const { facts, written } = await runFilingRoutine(root, { ...FRESHNESS_FINDING, id: "dupe", suggestedAction: "leave", producer: null });
  assert.equal(facts[0].state, "verified", facts[0].reason);
  assert.equal(written.length, 0, "⛔ `leave` findings must not become tasks");
  const round = readCarrier(root).find((r) => r.kind === "filing-round");
  assert.equal(round.rejected[0].gate, "action");
});

test("FILING — a registry DECLARED but unreadable fails closed (⛔ 读不懂 ≠ 没有未登记的)", async () => {
  const root = makeFilingWorkspace({ registeredProducers: ["coldstart-face"] });
  fs.rmSync(path.join(root, "plugin", "freshness-producers.json")); // declared, but gone
  const { facts, written } = await runFilingRoutine(root, FRESHNESS_FINDING);
  assert.equal(facts[0].state, "failed");
  assert.match(facts[0].reason, /registry declared but unreadable/);
  assert.equal(written.length, 0);
  assert.equal(readCarrier(root).filter((r) => r.kind === "filing-round").length, 0,
    "⛔ fail-closed BEFORE the filing round: no half-disposition record");
});

test("FILING — with NO registry declared the producer gate does not apply (generic across routines)", async () => {
  const root = makeFilingWorkspace({ declareRegistry: false });
  const { facts, written } = await runFilingRoutine(root, { ...FRESHNESS_FINDING, producer: "who-knows" });
  assert.equal(facts[0].state, "verified", facts[0].reason);
  assert.equal(written.length, 1, "a routine that declares no producer registry is unaffected by the gate");
});

test("FILING — the selector is PURE: run over the repo's REAL carrier it writes nothing", async () => {
  // AC5's "对生产载体跑一次真实读数": it is only a READING if running it cannot change what it reads.
  const carrierPath = path.join(REPO_ROOT, ROUTINE_FINDINGS_REL);
  assert.ok(fs.existsSync(carrierPath), `the repo's own carrier must exist to be read: ${carrierPath}`);
  const before = fs.readFileSync(carrierPath);
  const findings = fs.readFileSync(carrierPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((r) => r.kind === "finding").map((r) => ({
    id: r.findingId ?? null, kind: r.dupKind ?? null, symbols: r.symbols ?? [], files: r.files ?? [],
    verdict: r.verdict ?? null, rationale: r.rationale ?? "", suggestedAction: r.suggestedAction ?? null,
    producer: r.producer ?? null,
  }));
  assert.ok(findings.length > 0, "the production carrier must actually carry findings");
  const dispositions = selectFilings(findings, {
    routine: "PRODUCTION-READING", probe: "PRODUCTION-READING", runId: "production-reading", ts: "1970-01-01T00:00:00Z",
    carrierPath, carrierRel: ROUTINE_FINDINGS_REL, tasksDir: path.join(REPO_ROOT, "tasks"),
    nowMs: Date.now(), k: 3, registeredProducers: undefined, // 本读数统一按「未声明登记面」跑：它测的是枚举完备性与纯度，不是产出者判定
  });
  assert.equal(dispositions.length, findings.length, "⛔ every finding gets a disposition (枚举不布尔)");
  for (const d of dispositions) assert.ok(d.reason.length > 10, `disposition must carry a reason: ${JSON.stringify(d)}`);
  assert.equal(fs.readFileSync(carrierPath).equals(before), true, "⛔ the selector must not touch the carrier it reads");
});

// ── (g) the carrier's landing: append and commit are ONE action (AC7) ────────────────────────────
//
// THE DEFECT: the carrier is git-TRACKED, but `appendRoutineFindings` never committed ⇒ the
// working-tree copy sat dirty until somebody happened to commit it, and any tree-hygiene
// `git checkout` on the shared checkout took the appends back. Measured 2026-09-15: 25 records
// appended 02:17Z–14:36Z were gone by 16:35Z, leaving only HEAD's 54 lines + the last two rounds' 10.
// The case below takes that reading BOTH ways: the old shape really does lose the append, and the
// new shape does not.
test("CARRIER AC7 — an uncommitted append IS lost by a checkout; a committed one is not", async () => {
  const root = makeTmpDir("probe-carrier-");
  const carrierRel = ROUTINE_FINDINGS_REL;
  const carrierAbs = path.join(root, carrierRel);
  const git = (args) => spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "probes"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), [
    "loop:", "  routines:", "    - name: freshness-refresh", "      trigger: interval:120m",
    "      probe: freshness-refresh", "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "plugin", "probes", "freshness-refresh.md"),
    "---\ninstrument: none\noutput_routing:\n  producers_file: plugin/freshness-producers.json\n---\nbody\n", "utf8");
  fs.writeFileSync(path.join(root, "plugin", "freshness-producers.json"),
    JSON.stringify({ producers: [{ id: "coldstart-face" }] }), "utf8");
  // The carrier is TRACKED (that is its declared landing — ⛔ NOT gitignored).
  fs.writeFileSync(carrierAbs, "");
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "baseline"]);
  assert.equal(git(["ls-files", "--error-unmatch", "--", carrierRel]).status, 0, "precondition: the carrier is tracked");

  // (1) NEGATIVE CONTROL — the OLD shape: an append nobody committed is silently lost.
  fs.appendFileSync(carrierAbs, JSON.stringify({ ts: "2026-09-15T02:17:52Z", kind: "finding", findingId: "LOST-1" }) + "\n", "utf8");
  assert.equal(git(["status", "--porcelain", "--", carrierRel]).stdout.trim().startsWith("M"), true, "an uncommitted append really does dirty the shared checkout");
  git(["checkout", "--", carrierRel]);
  assert.equal(fs.readFileSync(carrierAbs, "utf8").trim(), "", "⛔ and a plain checkout takes the append back — this is the measured 2026-09-15 loss");

  // (2) THE FIX — run the routine; the append and its commit are one action.
  const routine = llmProbeRoutine(
    { name: "freshness-refresh", trigger: "interval:120m", probe: "freshness-refresh", dispatch: null },
    {
      root, pluginRoot: path.join(root, "plugin"), probeTimeoutMs: 30_000,
      probeArgv: () => fakeProbeArgv({ findings: [FRESHNESS_FINDING], shards: 1 }),
      fileTaskFn: async (id) => ({ ok: true, reason: `filed as ${id}` }),
    },
  );
  const facts = await routine.run({ halted: false });
  assert.equal(facts[0].value.carrierCommit, "committed", `the round must commit its own append: ${facts[0].value.carrierCommit}`);
  assert.equal(git(["status", "--porcelain", "--", carrierRel]).stdout.trim(), "",
    "⛔ HEAD and the work tree must AGREE after the round — nothing left for a checkout to take back");
  const head = git(["show", `HEAD:${carrierRel}`]).stdout;
  assert.match(head, /freshness-goal-009-ac-207/, "the finding record must be in HEAD, not only on disk");
  assert.match(head, /"kind":"filing-round"/, "the filing round's record must be in HEAD too");
  // and the whole point: the same checkout that destroyed (1) is now a no-op
  git(["checkout", "--", carrierRel]);
  assert.ok(fs.readFileSync(carrierAbs, "utf8").includes("freshness-goal-009-ac-207"),
    "⛔ after the fix the same checkout can no longer destroy the records");
});
