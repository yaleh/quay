// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e (quay-init --loop install); install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop install subprocess tree. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init.test.mjs — gap-ac37-exec-core-ships-with-package (执行核随包走).
//
// The three ≤80-line execution cores (plugin/loop/{manager,orchestrator,fast-mode}-tick-core.md)
// previously lived ONLY in orchestration/ — they did NOT ship with the loop (quay-init.sh had zero
// `tick-core` hits) and an installed project got the 1000+-line rationale archives with NO execution
// path. This file pins the fix:
//   AC2 — the three cores are in the DERIVED loop laydown set (derive_loop_scripts): a --loop
//       install lays orchestrator-tick-core.md + fast-mode-tick-core.md into orchestration/ and the
//       `quay-init.sh --loop | grep -c tick-core` measure is ≥ 3.
//   AC3 — manager-tick-core.md is OPT-IN (--manager): a default --loop does NOT lay it; --loop
//       --manager DOES.
//   AC4 — the existing referenced ⊆ landed gate (:1081) covers the three cores (no new check): a
//       --loop install passes verify-referenced-landed with them landed (their reference-doc
//       declarations were REMOVED so the gate now validates the landing, not a declaration).
//   AC5 — cold-start readable: the laid-down cores are readable in the target's orchestration/.
//
// Run:
//   scripts/test.sh plugin/test/quay-init.test.mjs
//   node --test plugin/test/quay-init.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { makeTmp, cleanup, runInit, pluginDir, laydownWorkspace, diskWorktreeRoot } from "./quay-init-loop-helpers.mjs";

const INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];

const CORE_BASENAMES = [
  "orchestrator-tick-core.md",
  "fast-mode-tick-core.md",
  "manager-tick-core.md",
];

// ── AC2: the three exec cores ship in the derived set + are laid down ────────────────────────────────
test("AC2 — the three exec-core docs are in the derived laydown set; a --loop install lays them to orchestration/", () => {
  // AC3 (gap-serial-install-family-shared-prebuilt-fixture): the initial install is pure setup — copy
  // it from the shared prebuilt fixture; the `measure` re-run below stays a REAL install.
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/, "referenced ⊆ landed must pass with the cores landed");
    // The two default-loop cores land in the target's orchestration/ (the path the tick templates reference).
    for (const core of ["orchestrator-tick-core.md", "fast-mode-tick-core.md"]) {
      const landed = path.join(ws, "orchestration", core);
      assert.ok(fs.existsSync(landed), `the exec core must be laid down: orchestration/${core}`);
    }
    // fast-mode-tick-core.md ships as REAL content (normalized-byte semantic landing) — cold-start
    // readable (AC5): byte-identical to the shipped plugin/loop/ canonical copy.
    {
      const core = "fast-mode-tick-core.md";
      const landed = path.join(ws, "orchestration", core);
      const shipped = path.join(pluginDir, "loop", core);
      assert.ok(fs.existsSync(shipped), `the shipped canonical copy must exist: plugin/loop/${core}`);
      assert.equal(fs.readFileSync(landed, "utf8"), fs.readFileSync(shipped, "utf8"),
        `laid-down ${core} must be byte-identical to the shipped copy`);
    }
    // orchestrator-tick-core.md's shipped plugin/loop/ copy is a one-line POINTER
    // (gap-inner-content-cleanup, 2026-09-02, mirroring gap-plugin-loop-manager-drifted-copies-
    // pointerize) — resolve_tick_core_src follows it to the orchestration/ 正本, so the laid-down
    // file must be the REAL core, byte-identical to that 正本, not the pointer line.
    {
      const core = "orchestrator-tick-core.md";
      const landed = path.join(ws, "orchestration", core);
      const shipped = path.join(pluginDir, "loop", core);
      assert.match(fs.readFileSync(shipped, "utf8"), /^> 正本: orchestration\/orchestrator-tick-core\.md/,
        "plugin/loop/orchestrator-tick-core.md must be a pointer to its orchestration/ 正本");
      const canonical = path.join(path.resolve(pluginDir, ".."), "orchestration", core);
      assert.ok(fs.existsSync(canonical), `the orchestration/ 正本 must exist: ${canonical}`);
      assert.equal(fs.readFileSync(landed, "utf8"), fs.readFileSync(canonical, "utf8"),
        `laid-down ${core} must be the REAL core, byte-identical to the orchestration/ 正本 (not the plugin/loop pointer)`);
    }
    // The measure: `quay-init.sh --loop | grep -c tick-core` ≥ 3 (the three cores are in the derived set).
    const measure = runInit(ws, INIT_ARGS(ws));
    const hits = (measure.stdout.match(/tick-core/g) || []).length;
    assert.ok(hits >= 3, `the --loop output must mention tick-core at least 3 times (three cores in the derived set); got ${hits}`);
  } finally { cleanup(ws); }
});

// ── AC2 (gap-quay-init-coldstart-usability-launch-not-used-... F4): the laid-down launch is usable ────
// quay-launch.sh reads <target>/.claude/launch.settings.json + <target>/.quay/profiles.yml (AC154) — a
// --loop install must lay BOTH so a cold-started consumer's quay-launch.sh does NOT fail closed
// ("launch settings file not found"), and the materialized command carries --settings + the role name.
test("AC2-launch — --loop lays down .claude/launch.settings.json + .quay/profiles.yml; the laid-down quay-launch.sh materializes --settings + role names", () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /launch-config: laid down .claude\/launch\.settings\.json/,
      "the install must report the launch-config laydown");
    const settings = path.join(ws, ".claude", "launch.settings.json");
    assert.ok(fs.existsSync(settings), "a --loop install must lay .claude/launch.settings.json (the launcher's input)");
    const s = JSON.parse(fs.readFileSync(settings, "utf8"));
    assert.ok(!("_launchSpec" in s), "the laid template must NOT carry _launchSpec (AC154 profile 抽层)");
    // AC154: roles now live in the SIBLING .quay/profiles.yml laid beside the settings file.
    const profiles = path.join(ws, ".quay", "profiles.yml");
    assert.ok(fs.existsSync(profiles), "a --loop install must lay .quay/profiles.yml (the profile carrier)");
    const py = spawnSync("python3", ["-c", "import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", profiles], { encoding: "utf8" });
    assert.equal(py.status, 0, `laid profiles.yml must parse as YAML:\n${py.stderr}`);
    const p = JSON.parse(py.stdout);
    const names = new Set(Object.values(p.roles).map((r) => r.name));
    assert.equal(names.has("quay-outer"), true, "outer role must carry the role-convention name quay-outer");
    assert.equal(names.has("quay-inner"), false, "inner role retired (inner 层已由 *-driver 取代) — must NOT carry the role-convention name quay-inner");
    // The launcher in the laid-down target materializes --settings + the role name (F4's missing half).
    const launcher = path.join(ws, "plugin", "scripts", "quay-launch.sh");
    const dry = spawnSync("bash", [launcher, "outer", "--dry-run"], { encoding: "utf8", env: { ...process.env, QUAY_LAUNCH_SETTINGS: settings } });
    assert.equal(dry.status, 0, `laid-down quay-launch.sh outer --dry-run must exit 0:\n${dry.stderr}`);
    assert.ok(dry.stdout.includes("--settings"), "the materialized command must carry --settings");
    assert.ok(dry.stdout.includes("-n quay-outer"), "the materialized command must carry the role-convention name quay-outer");
  } finally { cleanup(ws); }
});

// ── AC3: manager-tick-core is opt-in (--manager), not in the default --loop set ───────────────────────
test("AC3 — manager-tick-core.md is OPT-IN: absent in a default --loop, present with --manager", () => {
  // Default --loop: the manager core must NOT land. AC3: the default install is pure setup — copy it
  // from the shared prebuilt fixture (a default --loop install, so it has no --manager core and its
  // output carries the opt-in skip report).
  const { ws: wsDefault, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `default init must exit 0:\n${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(wsDefault, "orchestration", "manager-tick-core.md")),
      "default --loop must NOT lay manager-tick-core.md (opt-in via --manager)");
    assert.match(r.stdout, /skip \(opt-in\): orchestration\/manager-tick-core\.md/,
      "the default install must report the manager core as opt-in");
  } finally { cleanup(wsDefault); }

  // --loop --manager: the manager core DOES land.
  const wsMgr = makeTmp();
  try {
    const r = runInit(wsMgr, [...INIT_ARGS(wsMgr), "--manager"]);
    assert.equal(r.status, 0, `--manager init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(wsMgr, "orchestration", "manager-tick-core.md")),
      "--loop --manager must lay manager-tick-core.md");
    const landed = path.join(wsMgr, "orchestration", "manager-tick-core.md");
    // The shipped plugin/loop/manager-tick-core.md is a one-line POINTER to the 正本
    // (gap-plugin-loop-manager-drifted-copies-pointerize) — the laid-down file must be the REAL
    // core, byte-identical to the orchestration/ 正本, not the pointer line (cold-start readable).
    const canonical = path.join(path.resolve(pluginDir, ".."), "orchestration", "manager-tick-core.md");
    assert.ok(fs.existsSync(canonical), `the orchestration/ 正本 must exist: ${canonical}`);
    assert.equal(fs.readFileSync(landed, "utf8"), fs.readFileSync(canonical, "utf8"),
      "laid-down manager-tick-core.md must be the REAL core, byte-identical to the orchestration/ 正本 (not the plugin/loop pointer)");
  } finally { cleanup(wsMgr); }
});

// ── AC4: referenced ⊆ landed covers the three cores (no new check) ───────────────────────────────────
test("AC4 — the referenced⊆landed gate validates the three cores: removing one shipped core FAILS the install (declaration removed, landing required)", () => {
  // The two default-loop cores are NO LONGER declared reference-doc in init/SKILL.md — so if the
  // laydown cannot land one, the install must FAIL (the gate now validates the LANDING, not a
  // declaration). This is the "自动生效" the task's prescription names (:1081, no new check).
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    // A freshly cloned plugin has NO built vendor runtime; the test only needs the LAYDOWN + gate,
    // but ensure_vendor_runtime would fail-closed before the gate runs. Build-less is fine: we
    // delete the core from the PLUGIN source so the laydown cannot ship it, and assert the gate
    // names it. (The vendor-runtime fail-closed would mask this — so pre-copy the runtime if present.)
    const rtDir = path.join(pluginDir, "vendor", "quay", "dist");
    if (fs.existsSync(rtDir)) {
      fs.cpSync(rtDir, path.join(src, "vendor", "quay", "dist"), { recursive: true });
      fs.cpSync(path.join(pluginDir, "vendor", "quay-native", "dist"),
        path.join(src, "vendor", "quay-native", "dist"), { recursive: true });
    }
    fs.rmSync(path.join(src, "loop", "orchestrator-tick-core.md"), { force: true });
    fs.rmSync(path.join(src, "loop", "fast-mode-tick-core.md"), { force: true });
    const ws = makeTmp();
    try {
      const r = runInit(ws, INIT_ARGS(ws), src);
      assert.notEqual(r.status, 0, "--loop must FAIL when a referenced exec core cannot land");
      assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
      assert.match(r.stderr, /orchestrator-tick-core\.md/, "must name the missing exec core");
      assert.match(r.stderr, /fast-mode-tick-core\.md/, "must name the missing exec core");
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ── AC5: --loop lays all three cores when opted in; manager core's own deps are gate-validated ───────
test("AC5 — --loop --manager lays all three cores (cold-start readable); quay-session.ts (the manager core's dep) ships", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, [...INIT_ARGS(ws), "--manager"]);
    assert.equal(r.status, 0, `--manager init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/, "referenced ⊆ landed must pass with all three cores");
    for (const core of CORE_BASENAMES) {
      const landed = path.join(ws, "orchestration", core);
      assert.ok(fs.existsSync(landed), `all three cores must be readable in the target: orchestration/${core}`);
    }
    // quay-session.ts is referenced by manager-tick-core.md — it must ship (gate-validated dep).
    assert.ok(fs.existsSync(path.join(ws, "plugin", "scripts", "quay-session.ts")),
      "the manager core's referenced dep plugin/scripts/quay-session.ts must be laid down");
  } finally { cleanup(ws); }
});

// ── torn-read simulation seam (gap-quay-init-torn-read-derive-loop-scripts) ────────────────────────
// derive_loop_scripts() derives the --loop laydown set by grep over the shipped corpus
// (skills/*/SKILL.md + loop/*.md + workflows/*.js). Under heavy concurrent load a grep/sort in a
// command substitution can be killed mid-stream (the pipeline's `|| true` masks the death), returning
// a PARTIAL (torn) set — the laydown then lays FEWER scripts than the docs reference, and
// verify_referenced_landed (which re-derives the reference set independently) false-positives every
// missing script as referenced-not-landed (observed at cc8: 104 scripts ≈ the ENTIRE reference set).
// The fix (derive_loop_scripts stability check) runs TWO independent passes and requires them to be
// IDENTICAL, so a torn pass (which truncates at a nondeterministic point) retries; only two agreeing
// non-empty passes are accepted. A stable corpus derives deterministically, so real drift is never
// masked (a genuinely-absent script is absent from EVERY pass and the downstream gate fail-closes).
//
// These tests SOURCE the REAL quay-init.sh and call derive_loop_scripts directly (免完整安装 —
// gap-quay-init-reduce-real-install-count), with a fake `grep` injected first on PATH. The fake
// passes through every invocation to the real grep EXCEPT the (a) corpus scan — the
// grep whose pattern starts with `plugin/scripts/` (the ONLY such grep in the derivation;
// verify_referenced_landed's reference-scan pattern starts with `(` and is unaffected). On a torn
// policy it truncates that one grep's output to the first KEEP lines, simulating a grep killed
// mid-stream. The drop schedule tears only the FIRST corpus read (tornUntil=1) and lets reads 2+
// return the full set — the first derive_loop_scripts pass is torn, the second is full, so the
// stability check's two passes disagree and it retries to two agreeing full passes. A pre-fix
// (unwrapped) derive_loop_scripts would lay down the torn set and fail referenced-not-landed.
const FAKE_GREP_SOURCE = String.raw`#!/usr/bin/env bash
# Torn-read simulation grep (quay-init derive_loop_scripts torn-read regression test only).
# Passes through to the real grep EXCEPT the (a) corpus scan (pattern starting with plugin/scripts/).
set -u
real_grep="$REAL_GREP"
policy="$FAKE_GREP_POLICY"

corpus_scan=no
for a in "$@"; do
  case "$a" in
    plugin/scripts/*) corpus_scan=yes ;;
  esac
done

if [ "$corpus_scan" = "yes" ] && [ "$policy" = "torn" ]; then
  full="$("$real_grep" "$@" 2>/dev/null || true)"
  rseq=0
  if [ -f "$FAKE_GREP_COUNTER" ]; then
    rseq="$(cat "$FAKE_GREP_COUNTER" 2>/dev/null || echo 0)"
  fi
  rseq=$((rseq + 1))
  printf '%s' "$rseq" > "$FAKE_GREP_COUNTER"

  torn=no
  if [ "$rseq" -le "$FAKE_GREP_TORN_UNTIL" ]; then
    torn=yes
  fi

  if [ "$torn" = "yes" ]; then
    keep="$FAKE_GREP_KEEP"
    n=0
    printed=0
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      n=$((n + 1))
      if [ "$n" -le "$keep" ]; then
        printf '%s\n' "$line"
        printed=$((printed + 1))
      fi
    done <<< "$full"
    printf 'corpus %s %s %s\n' "$rseq" "yes" "$printed" >> "$FAKE_GREP_LOG"
  else
    printf '%s\n' "$full"
    printf 'corpus %s %s %s\n' "$rseq" "no" "full" >> "$FAKE_GREP_LOG"
  fi
  exit 0
fi

exec "$real_grep" "$@"
`;

function realGrepPath() {
  for (const d of (process.env.PATH || "").split(":")) {
    const p = path.join(d, "grep");
    if (fs.existsSync(p)) return p;
  }
  return "/usr/bin/grep";
}

// runSourced(fnLine, { env, args, cwd }) — SOURCE quay-init.sh and invoke ONE of its top-level
// derivation/stability functions DIRECTLY (no full install), with the fake-grep seam (env) in place.
// gap-quay-init-reduce-real-install-count: the torn-read family previously ran a full `--loop` install
// (~33s) per test just to exercise one stability check; quay-init.sh is now sourceable (its
// library-mode guard stops before the install flow), so the test calls the function itself. fnLine is
// the LAST command of a `bash -c`, so the child's exit code IS the function's return code and stderr
// carries any FAIL line (e.g. referenced-not-landed).
function runSourced(fnLine, { env = {}, args = [], cwd } = {}) {
  // Capture the positional args into _fargs and CLEAR $@ BEFORE sourcing: quay-init.sh parses $@ at
  // the top level (its arg parser rejects an unknown positional with "unknown argument"), and
  // sourcing would otherwise feed it the fnLine's args (e.g. the workspace path). fnLine reads them
  // back via ${_fargs[0]}.
  const script = '_fargs=("$@")\nset --\nsource "$QUAY_INIT_SCRIPT"\n' + fnLine;
  return spawnSync("bash", ["-c", script, "quay-init-sourced", ...args], {
    cwd: cwd || pluginDir,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginDir,
      QUAY_INIT_SCRIPT: path.join(pluginDir, "scripts", "quay-init.sh"),
      ...env,
    },
  });
}

// Async spawn variant (the concurrency test must run N installs in PARALLEL, not serially).
function runInitAsync(workspace, args, pluginRoot = pluginDir) {
  return new Promise((resolve) => {
    const argv = ["bash", path.join(pluginRoot, "scripts", "quay-init.sh")];
    if (args.includes("--loop") && !args.some((a) => a === "--worktree-root")) {
      argv.push("--worktree-root", diskWorktreeRoot());
    }
    argv.push(...args);
    const child = spawn(argv[0], argv.slice(1), {
      cwd: workspace,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ status: null, stdout, stderr: `${stderr}${e}` }));
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

// Writes the fake grep into binDir and returns the env the install must run with.
function tornEnv(binDir, opts) {
  const fakeGrep = path.join(binDir, "grep");
  fs.writeFileSync(fakeGrep, FAKE_GREP_SOURCE);
  fs.chmodSync(fakeGrep, 0o755);
  return {
    PATH: `${binDir}:${process.env.PATH || ""}`,
    REAL_GREP: realGrepPath(),
    FAKE_GREP_POLICY: opts.policy,
    FAKE_GREP_COUNTER: path.join(binDir, "counter"),
    FAKE_GREP_LOG: path.join(binDir, "corpus-reads.log"),
    FAKE_GREP_TORN_UNTIL: String(opts.tornUntil ?? 0),
    FAKE_GREP_KEEP: String(opts.keep ?? 5),
  };
}

function readCorpusLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const [kind, rseq, torn, printed] = line.split(" ");
    return { kind, rseq: Number(rseq), torn, printed };
  });
}

// ── torn-read regression (gap-quay-init-torn-read-derive-loop-scripts) ─────────────────────────────
// The stability check: two independent derivation passes must agree before a laydown set is accepted.
// This test tears ONLY the first corpus read (truncating it to 5 lines) and lets every later read
// return the full set — the first pass is torn, the second is full, so the two passes disagree and
// the check retries to two agreeing full passes. A pre-fix (unwrapped) derivation would lay the torn
// set and fail referenced-not-landed on ~100 missing scripts.
test("torn-read stability — a torn corpus derivation (grep truncated) is retried; derive_loop_scripts still returns a stable set", () => {
  const binDir = makeTmp("torn-grep-");
  const env = tornEnv(binDir, { policy: "torn", tornUntil: 1, keep: 5 });
  try {
    const r = runSourced("derive_loop_scripts", { env });
    assert.equal(r.status, 0,
      `a torn corpus read must NOT fail the derivation (the stability check retries to a clean pass):\n${r.stdout}${r.stderr}`);

    // The fake-grep log proves the tear really fired and that the check read PAST it (a full read
    // followed the torn one). A torn read that never happened would make this test vacuous; a full
    // read never following would mean the tear was never absorbed.
    const log = readCorpusLog(env.FAKE_GREP_LOG);
    assert.ok(log.length >= 1, "the fake-grep seam must have intercepted at least one corpus scan");
    assert.equal(log[0].torn, "yes", "the FIRST corpus read must be torn (the tear actually fired)");
    assert.ok(Number(log[0].printed) >= 1 && Number(log[0].printed) <= 5,
      `the torn read must be truncated (printed ${log[0].printed} lines, expected ≤ 5)`);
    assert.ok(log.length >= 3,
      `the stability check must read past the torn pass (≥3 corpus reads; 2-pass agreement requires a retry), got ${log.length}`);
    assert.ok(log.some((e) => e.torn === "no"),
      "a complete (non-torn) corpus read must follow the torn one — the retry moved past it");
  } finally { cleanup(binDir); }
});

test("torn-read control — the pass-through seam preserves the happy path: consistent reads exit 0", () => {
  const binDir = makeTmp("torn-grep-");
  const env = tornEnv(binDir, { policy: "pass" });
  try {
    const r = runSourced("derive_loop_scripts", { env });
    assert.equal(r.status, 0, `the pass-through seam must not change a clean derivation verdict:\n${r.stdout}${r.stderr}`);
  } finally { cleanup(binDir); }
});

// ── concurrency negative control (gap-quay-init-torn-read-derive-loop-scripts AC2) ──────────────────
// Real concurrent --loop installs must each derive a COMPLETE (non-torn) laydown set: every install
// exits 0 and passes verify-referenced-landed (the false-positive detector). A torn read in any one
// install would surface as referenced-not-landed false positives and a non-zero exit.
test("concurrent --loop installs derive a stable loop set — no torn-read false positive (negative control)", async () => {
  const N = 4;
  const wss = Array.from({ length: N }, () => makeTmp("conc-init-"));
  try {
    const results = await Promise.all(wss.map((ws) => runInitAsync(ws, INIT_ARGS(ws))));
    for (const r of results) {
      assert.equal(r.status, 0, `concurrent install must exit 0:\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /verify-referenced-landed: OK/,
        "referenced ⊆ landed must pass under concurrency (no torn-read false positive)");
    }
  } finally { wss.forEach(cleanup); }
});

// ── torn declaration-read regression (gap-quay-init-escalations-vendor-freshness-false-positive) ──────
// verify_referenced_landed's declaration read (self-create / reference-doc) is the SAME torn-read class
// as derive_loop_scripts: under concurrent --loop load a grep in a command substitution can be killed
// mid-stream (the pipeline's `|| true` masks the death), returning a PARTIAL declaration set. A torn
// self-create read that drops `orchestration/escalations.md` (declared at init/SKILL.md:143) would
// false-positive it as referenced-not-landed — the gap's subject. The stability check (two agreeing
// passes + sentinel) must absorb a torn pass and recover the FULL declaration set. This fake grep tears
// the self-create declaration scan to its FIRST line (tick-log.md — the sentinel) for the first N reads,
// then passes through; a torn pass therefore differs from a full pass and the stability check retries.
const SELFCREATE_TORN_GREP = String.raw`#!/usr/bin/env bash
# Torn-read simulation grep (declaration-read stability regression test only).
# Passes through to the real grep EXCEPT the self-create declaration scan (pattern starting with
# '<!-- self-create:'), which it truncates to the first line for the first FAKE_GREP_TORN_UNTIL reads.
set -u
real_grep="$REAL_GREP"
is_selfcreate=no
for a in "$@"; do
  case "$a" in
    '<!-- self-create:'*) is_selfcreate=yes ;;
  esac
done
if [ "$is_selfcreate" = "yes" ]; then
  n=0
  if [ -f "$FAKE_GREP_COUNTER" ]; then n="$(cat "$FAKE_GREP_COUNTER" 2>/dev/null || echo 0)"; fi
  n=$((n + 1)); printf '%s' "$n" > "$FAKE_GREP_COUNTER"
  if [ "$n" -le "$FAKE_GREP_TORN_UNTIL" ]; then
    "$real_grep" "$@" 2>/dev/null | head -n 1 || true
    exit 0
  fi
fi
exec "$real_grep" "$@"
`;

function selfcreateTornEnv(binDir, opts) {
  const fakeGrep = path.join(binDir, "grep");
  fs.writeFileSync(fakeGrep, SELFCREATE_TORN_GREP);
  fs.chmodSync(fakeGrep, 0o755);
  return {
    PATH: `${binDir}:${process.env.PATH || ""}`,
    REAL_GREP: realGrepPath(),
    FAKE_GREP_COUNTER: path.join(binDir, "counter"),
    FAKE_GREP_TORN_UNTIL: String(opts.tornUntil ?? 0),
  };
}

test("torn self-create declaration read is retried — a declared self-create (escalations.md) is recovered", () => {
  const binDir = makeTmp("torn-decl-");
  const env = selfcreateTornEnv(binDir, { tornUntil: 1 });
  try {
    // Tear ONLY the first self-create read (to the sentinel tick-log.md); the second read is full, so
    // the two reads disagree and the stability check retries to two agreeing FULL passes.
    const r = runSourced('_read_declarations; echo "SC=$QUAY_INIT_SELFCREATE"', { env });
    assert.equal(r.status, 0, `sourcing must succeed:\n${r.stderr}`);
    assert.match(r.stdout, /orchestration\/escalations\.md/,
      "the stability-checked declaration read must recover the declared self-create orchestration/escalations.md (the gap's false-positive victim)");
    assert.match(r.stdout, /orchestration\/tick-log\.md/,
      "the sentinel self-create orchestration/tick-log.md must also be present in the recovered set");
  } finally { cleanup(binDir); }
});
