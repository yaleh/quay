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
  assert.equal(records.length, 3, "one scan-round record + one record per finding");
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
