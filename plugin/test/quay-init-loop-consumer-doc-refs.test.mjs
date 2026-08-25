// @test-group engine
// @load-sensitive real-install
// @judges plugin/loop/*
// @load-sensitive-entry 2026-08-11 real-install e2e; install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop install subprocess tree. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init-loop-consumer-doc-refs.test.mjs — gap-quay-init-loop-tick-doc-paths-reference-unlanded-
// plugin-loop (AC37, ad-arm1 archguard). The consumer tick doc docs/analysis/fast-mode-loop-tick.md
// referenced plugin/loop/* paths that quay-init NEVER lays (the loop lays orchestration/ +
// docs/analysis/), and the referenced⊆landed gate did not catch it (it scanned only the plugin
// source docs, and `plugin/loop` was not in the path-spelling alternation). This pins the fix:
//   AC2 — verify_referenced_landed ALSO scans the CONSUMER-LAID docs (docs/analysis/): a laid doc
//         referencing a path that does not land FAILS the install (referenced-not-landed).
//   AC3 — the shipped tick docs + skills reference the consumer landing (orchestration/ +
//         docs/analysis/), never the non-landed plugin/loop/ bundle-source path.
//   AC5 — the docs/analysis/ copy a consumer actually reads has ZERO plugin/loop/ refs, and every
//         orchestration//docs/analysis/ ref is landed or declared self-create/reference-doc.
//   regression — a reintroduced plugin/loop/ ref in a source doc makes the install FAIL (the AC37
//         path-spelling blind spot stays closed).
//
// Run:
//   scripts/test.sh plugin/test/quay-init-loop-consumer-doc-refs.test.mjs
//   node --test plugin/test/quay-init-loop-consumer-doc-refs.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
// AC3 (gap-serial-install-family-shared-prebuilt-fixture): the positive-case install is pure setup —
// copy it from the shared prebuilt fixture; the negative controls stay REAL installs.
import { laydownWorkspace, laydownTemplate, runInit, makeTmp, cleanup, pluginDir, declaredSet, diskWorktreeRoot } from "./quay-init-loop-helpers.mjs";

const INIT_ARGS = (ws) => ["--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0"];

// ── torn-read simulation seam (gap-quay-init-verify-referenced-landed-torn-read) ──────────────────────
// The completeness sentinel in verify_referenced_landed() used to pin only TWO always-present
// declaration lines (tick-log.md self-create + manager-tick-log.md reference-doc). A torn read of
// init/SKILL.md (racing a concurrent --loop install) can keep BOTH sentinel lines yet drop a LATER
// declaration — a declared ref is then false-positived as not-declared and the install fails
// referenced-not-landed (observed: SPEC-methodology-as-a-deliverable.md @line 173 → worktree-root-
// fs-check AC4). The fix replaces the sentinel with a STABILITY check: two independent reads of
// init/SKILL.md must produce IDENTICAL declaration sets, so a torn read (truncating at a
// nondeterministic point) is retried; only two agreeing reads are accepted as complete. A genuinely
// undeclared ref is absent from every read, so real drift still fails (negative control unchanged).
//
// These tests exercise the REAL quay-init.sh --loop install path with a fake `grep` injected first
// on PATH. The fake passes through every invocation to the real grep EXCEPT the declaration reads on
// init/SKILL.md (a pattern arg mentioning self-create/reference-doc AND a file arg ending in
// skills/init/SKILL.md); those it can truncate deterministically by dropping one declaration line,
// simulating a torn read that keeps the sentinels but loses a later declaration. The drop schedule
// forces reads 1..6 (the first two attempts of the stability check, plus the first fresh re-read of
// the per-reference loop) to differ from each other, then lets reads 7+ return the full set — the
// stability check retries until two agreeing full reads, while the pre-fix sentinel would accept the
// first torn snapshot and fail on the dropped declaration.
const FAKE_GREP_SOURCE = `#!/usr/bin/env bash
# Torn-read simulation grep (quay-init torn-read regression test only).
# Passes through to the real grep except for declaration reads on init/SKILL.md, which it can tear.
set -u
real_grep="$REAL_GREP"
policy="$FAKE_GREP_POLICY"

declare_file=""
kind=""
for a in "$@"; do
  case "$a" in
    *skills/init/SKILL.md) declare_file="$a" ;;
    *self-create*) kind="self-create" ;;
    *reference-doc*) kind="reference-doc" ;;
  esac
done

if [ -n "$declare_file" ] && [ -n "$kind" ] && [ "$policy" = "torn" ]; then
  full="$("$real_grep" "$@" 2>/dev/null || true)"
  rseq=0
  if [ -f "$FAKE_GREP_COUNTER" ]; then
    rseq="$(cat "$FAKE_GREP_COUNTER" 2>/dev/null || echo 0)"
  fi
  rseq=$((rseq + 1))
  printf '%s' "$rseq" > "$FAKE_GREP_COUNTER"

  drop=""
  torn=no
  if [ "$rseq" -le "$FAKE_GREP_TORN_UNTIL" ]; then
    torn=yes
    if [ "$kind" = "self-create" ]; then
      case $((rseq % 4)) in
        1) drop="$FAKE_GREP_DROP0" ;;
        3) drop="$FAKE_GREP_DROP2" ;;
        *) drop="$FAKE_GREP_DROP0" ;;
      esac
    else
      drop="$FAKE_GREP_DROP1"
    fi
  fi
  printf '%s %s %s %s\n' "$kind" "$rseq" "$torn" "$drop" >> "$FAKE_GREP_LOG"

  if [ "$torn" = "yes" ]; then
    if [ "$kind" = "self-create" ]; then sentinel="orchestration/tick-log.md"; else sentinel="orchestration/manager-tick-log.md"; fi
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in
        *"$sentinel"*) printf '%s\n' "$line" ;;
        *)
          if [ -n "$drop" ] && printf '%s' "$line" | "$real_grep" -qF -- "$drop"; then
            : # torn read loses this declaration (the sentinel line above is always kept)
          else
            printf '%s\n' "$line"
          fi
          ;;
      esac
    done <<< "$full"
  else
    printf '%s\n' "$full"
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

// Like the helpers' runInit, but with an extra env layer (the fake-grep PATH + policy) so a real
// --loop install runs with the torn-read seam in place.
function runInitEnv(workspace, args, extraEnv, pluginRoot = pluginDir) {
  const loop = args.includes("--loop");
  const argv = ["bash", path.join(pluginRoot, "scripts", "quay-init.sh")];
  if (loop && !args.some((a) => a === "--worktree-root")) {
    argv.push("--worktree-root", diskWorktreeRoot());
  }
  argv.push(...args);
  return spawnSync(argv[0], argv.slice(1), {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...extraEnv },
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
    FAKE_GREP_LOG: path.join(binDir, "decl-reads.log"),
    FAKE_GREP_TORN_UNTIL: String(opts.tornUntil ?? 0),
    FAKE_GREP_DROP0: opts.drop0 || "",
    FAKE_GREP_DROP1: opts.drop1 || "",
    FAKE_GREP_DROP2: opts.drop2 || "",
  };
}

function readDeclLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const [kind, rseq, torn, ...dropParts] = line.split(" ");
    return { kind, rseq: Number(rseq), torn, drop: dropParts.join(" ") };
  });
}

// Every relative path that a real --loop install lays down (walk of the shared prebuilt fixture).
function collectLanded(root) {
  const out = new Set();
  const walk = (dir, rel) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), relPath);
      else out.add(relPath);
    }
  };
  walk(root, "");
  return out;
}

// Pick declaration paths to drop in the torn simulation: DECLARED self-create / reference-doc paths
// that a real install does NOT lay down. Losing one of these from a torn read is exactly the
// declared→not-declared false positive the stability check fixes (the file exists only in the
// declaration, so the per-reference loop's fresh re-read cannot rescue it while reads stay torn).
// The two self-create drops must differ (so the stability check's two reads disagree); the one
// reference-doc drop is repeated on every torn reference-doc read (so the pre-fix sentinel path —
// which accepts the first torn snapshot — cannot be rescued by a later fresh re-read).
function tornDropCandidates() {
  const landed = collectLanded(laydownTemplate().ws);
  const selfcreate = declaredSet(pluginDir, "self-create");
  const refdoc = declaredSet(pluginDir, "reference-doc");
  const scCands = [...selfcreate].filter((p) => !landed.has(p) && p !== "orchestration/tick-log.md");
  const rdCands = [...refdoc].filter((p) => !landed.has(p) && p !== "orchestration/manager-tick-log.md");
  assert.ok(scCands.length >= 2,
    `torn-read fixture needs >=2 not-landed self-create declarations to tear, got ${scCands.length}: ${scCands}`);
  assert.ok(rdCands.length >= 1,
    `torn-read fixture needs >=1 not-landed reference-doc declaration to tear, got ${rdCands.length}: ${rdCands}`);
  return { drop0: scCands[0], drop2: scCands[1], drop1: rdCands[0] };
}

// The REF extraction the Contract measure + the gate share: every path-prefixed reference in a doc.
const REF_RE = /(plugin\/loop|plugin\/scripts|orchestration|docs\/analysis)\/[a-zA-Z0-9._-]+/g;
function extractPathRefs(text) {
  const refs = new Set();
  let m;
  while ((m = REF_RE.exec(text)) !== null) refs.add(m[0]);
  return [...refs];
}

// The shipped docs/skills that quay-init lays VERBATIM to a consumer must never reference the
// non-landed plugin/loop/ bundle-source path.
function shippedDocs() {
  const files = [];
  const loopDir = path.join(pluginDir, "loop");
  for (const f of fs.readdirSync(loopDir)) if (f.endsWith(".md")) files.push(path.join(loopDir, f));
  for (const d of fs.readdirSync(path.join(pluginDir, "skills"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(pluginDir, "skills", d.name, "SKILL.md");
    if (fs.existsSync(f)) files.push(f);
  }
  return files;
}

// ── AC3: shipped docs/skills never reference the non-landed plugin/loop/ source path ──────────────
// The reference-doc/self-create declaration mechanism is EXEMPT: a `<!-- reference-doc: ... -->` /
// `<!-- self-create: ... -->` declaration line in init/SKILL.md is the declaration itself, not a
// content reference (7e64a86b declares plugin/loop/fast-mode-loop-tick.md reference-doc; AC3 must
// consult the declaredSet like AC2+AC5 do — an internal contradiction, fixed 2026-08-15).
test("AC3 — the shipped tick docs + skills have ZERO plugin/loop/ path references (the non-landed bundle-source path), except paths declared reference-doc/self-create", () => {
  const refdoc = declaredSet(pluginDir, "reference-doc");
  const selfcreate = declaredSet(pluginDir, "self-create");
  const offenders = [];
  for (const f of shippedDocs()) {
    const src = fs.readFileSync(f, "utf8");
    for (const ref of extractPathRefs(src)) {
      if (ref.startsWith("plugin/loop/") && !refdoc.has(ref) && !selfcreate.has(ref)) {
        offenders.push(`${path.relative(pluginDir, f)}: ${ref}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    "no shipped doc/skill may reference plugin/loop/* unless it is declared reference-doc/self-create in init/SKILL.md (quay-init never lays plugin/loop; the consumer landing is orchestration/ + docs/analysis/)");
});

// ── AC2 + AC5: a real install passes the gate, and the consumer-laid docs/analysis/ copy has zero
//    plugin/loop refs with every orchestration//docs/analysis/ ref landed-or-declared ──────────────
test("AC2+AC5 — a real --loop install: verify-referenced-landed OK, and every consumer-doc ref is landed or declared self-create/reference-doc (no plugin/loop refs)", () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/,
      "the referenced⊆landed gate must pass with the consumer docs laid at orchestration/ + docs/analysis/");
    const laid = path.join(ws, "docs", "analysis", "fast-mode-loop-tick.md");
    assert.ok(fs.existsSync(laid), "the inner tick doc must land at docs/analysis/fast-mode-loop-tick.md");
    assert.equal(fs.readFileSync(laid, "utf8"),
      fs.readFileSync(path.join(pluginDir, "loop", "fast-mode-loop-tick.md"), "utf8"),
      "the laid copy must be byte-identical to the plugin source (verbatim laydown)");
    // The consumer-laid docs/analysis/ copy is what a target project ACTUALLY reads — its refs must
    // resolve in the target (landed or declared). No plugin/loop/ ref may survive the verbatim copy.
    const selfcreate = declaredSet(pluginDir, "self-create");
    const refdoc = declaredSet(pluginDir, "reference-doc");
    const missing = [];
    const docsDir = path.join(ws, "docs", "analysis");
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.endsWith(".md")) continue;
      const src = fs.readFileSync(path.join(docsDir, f), "utf8");
      for (const ref of extractPathRefs(src)) {
        // A declared self-create/reference-doc path is the declaration mechanism itself — exempt
        // BEFORE the plugin/loop/ scan (a declared plugin/loop/* reference-doc, e.g.
        // plugin/loop/fast-mode-loop-tick.md, must not be flagged as a never-lands content ref).
        if (selfcreate.has(ref) || refdoc.has(ref)) continue;
        if (ref.startsWith("plugin/loop/")) missing.push(`${f}: plugin/loop/ ref (never lands) — ${ref}`);
        else if (!fs.existsSync(path.join(ws, ref))) {
          missing.push(`${f}: ${ref} is neither landed nor declared self-create/reference-doc`);
        }
      }
    }
    assert.deepEqual(missing, [], "every consumer-laid docs/analysis/ ref must be landed or declared; none may point at plugin/loop/");
  } finally { cleanup(ws); }
});

// ── AC2 negative control: a consumer-laid doc referencing a path that never lands FAILS the install ─
test("AC2 negative — a pre-existing consumer docs/analysis/ doc referencing a non-landed path FAILS --loop (referenced-not-landed)", () => {
  const ws = makeTmp();
  try {
    fs.mkdirSync(path.join(ws, "docs", "analysis"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs", "analysis", "evil-consumer-doc.md"),
      "this consumer doc references a path the loop never lays: plugin/scripts/nonexistent-checker.ts\n", "utf8");
    const r = runInit(ws, INIT_ARGS(ws));
    assert.notEqual(r.status, 0, "--loop must FAIL when a consumer-laid docs/analysis/ doc references a non-landed path");
    assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
    assert.match(r.stderr, /nonexistent-checker\.ts/, "must name the non-landed referenced path");
  } finally { cleanup(ws); }
});

// ── AC37 regression: a reintroduced plugin/loop/ ref in a source doc FAILS the install ─────────────
test("AC37 regression — a reintroduced plugin/loop/ ref in a shipped tick doc FAILS --loop (path-spelling blind spot stays closed)", () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.appendFileSync(path.join(src, "loop", "fast-mode-tick-core.md"),
      "\nplugin/loop/orchestrator-loop-tick.md is referenced here (regression probe)\n", "utf8");
    const ws = makeTmp();
    try {
      const r = runInit(ws, INIT_ARGS(ws), src);
      assert.notEqual(r.status, 0, "--loop must FAIL when a shipped doc references the non-landed plugin/loop/ path");
      assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
      assert.match(r.stderr, /plugin\/loop\/orchestrator-loop-tick\.md/, "must name the plugin/loop/ referenced path");
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ── AC91 (gap-ac91-delivery-core-refs-undelivered-files): the delivered execution core must not
//    reference undelivered files — the `.claude/workflows/` class ────────────────────────────────
// The shipped orchestrator-tick-core.md references `.claude/workflows/execute-suite-fix.js` (:39)
// and `.claude/workflows/pool-quality-judge.js` (:70), but plugin/workflows/ (the distribution
// mirror quay-init --workflows lays to .claude/workflows/) carried only 3 workflows — so on an
// installed target those two steps pointed at files that do not exist. The referenced-not-landed
// gate escaped it because its reference-set alternation did not include the `.claude/` prefix:
// the refs never entered $refs to be exempted (NOT the init/SKILL.md declaration clause — AC4
// disposition, quay-init.sh:1131-area 判定分支 实读). These tests pin the fix.
const WF_REF_RE = /\.claude\/workflows\/[a-zA-Z0-9._-]+/g;

test("AC91 — shipped docs/skills reference `.claude/workflows/<name>` ONLY for workflows mirrored in plugin/workflows/ (delivered exec core never points at an undelivered workflow)", () => {
  const wfDir = path.join(pluginDir, "workflows");
  const missing = [];
  for (const f of shippedDocs()) {
    const src = fs.readFileSync(f, "utf8");
    let m;
    while ((m = WF_REF_RE.exec(src)) !== null) {
      const ref = m[0];
      const name = ref.replace(/^\.claude\/workflows\//, "");
      if (!fs.existsSync(path.join(wfDir, name))) {
        missing.push(`${path.relative(pluginDir, f)}: ${ref} — no plugin/workflows/${name} mirror`);
      }
    }
  }
  assert.deepEqual(missing, [],
    "every .claude/workflows/<name> reference in a shipped doc/skill must have a byte-identical plugin/workflows/<name> mirror (quay-init --workflows lays plugin/workflows/ → .claude/workflows/)");
});

test("AC91 — a real --loop install lays the referenced workflows AND the fan-in workflow's script deps (referenced ⊆ landed for the workflow class)", () => {
  const { ws } = laydownWorkspace();
  try {
    // The workflows the delivered exec cores reference must land (--loop now implies --workflows).
    for (const wf of ["execute-suite-fix.js", "pool-quality-judge.js", "fan-in-execute.js"]) {
      assert.ok(fs.existsSync(path.join(ws, ".claude", "workflows", wf)),
        `--loop must lay .claude/workflows/${wf} (the shipped exec core references it)`);
    }
    // The delivered fan-in-execute workflow calls these scripts; a workflow referencing a script
    // the loop does not lay down is the same referenced-not-landed defect (AC91). They must land.
    for (const script of ["per-task-suite-record.ts", "fan-in-ac-completion-gate.ts", "anti-drift-touches-check.ts"]) {
      assert.ok(fs.existsSync(path.join(ws, "plugin", "scripts", script)),
        `--loop must lay plugin/scripts/${script} (the delivered fan-in-execute.js workflow references it)`);
    }
  } finally { cleanup(ws); }
});

// ── AC91 negative control: a shipped doc referencing an UNMIRRORED workflow FAILS --loop ─────────
test("AC91 negative — a shipped tick doc referencing `.claude/workflows/<name>` with no plugin/workflows/ mirror FAILS --loop (referenced-not-landed)", () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.appendFileSync(path.join(src, "loop", "orchestrator-tick-core.md"),
      "\nregression probe: the outer suite fix runs via `.claude/workflows/ghost-workflow.js`\n", "utf8");
    const ws = makeTmp();
    try {
      const r = runInit(ws, INIT_ARGS(ws), src);
      assert.notEqual(r.status, 0, "--loop must FAIL when a shipped doc references a .claude/workflows/ file that has no plugin/workflows/ mirror");
      assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
      assert.match(r.stderr, /ghost-workflow\.js/, "must name the unreferenced-workflow path");
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ── torn-read regression (gap-quay-init-verify-referenced-landed-torn-read) ──────────────────────────
// The stability check: two independent reads of init/SKILL.md must agree before a declaration set is
// accepted. The first test forces the first TWO attempts (reads 1-6) to be mutually inconsistent torn
// reads (each keeping the sentinels but dropping a declared-not-landed path), then lets reads 7+
// return the full set — the stability check must retry to a clean attempt and the install must pass.
// A pre-fix sentinel-only check would accept the first torn snapshot and fail referenced-not-landed.
test("torn-read stability — torn declaration reads (keeping sentinels, dropping a later declaration) are retried; a real --loop install still passes", () => {
  const { drop0, drop1, drop2 } = tornDropCandidates();
  const binDir = makeTmp("torn-grep-");
  const env = tornEnv(binDir, { policy: "torn", tornUntil: 6, drop0, drop1, drop2 });
  const ws = makeTmp("torn-ws-");
  try {
    const r = runInitEnv(ws, INIT_ARGS(ws), env);
    assert.equal(r.status, 0, `torn reads must NOT fail the install (stability check retries to a clean read):\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /verify-referenced-landed: OK/,
      "the referenced⊆landed gate must pass once the declaration reads stabilize");

    // The fake-grep log proves the retry really happened: reads 1-6 were torn (a declaration dropped,
    // so consecutive reads disagreed), and the check read on past them instead of accepting the first
    // torn snapshot. A sentinel-only implementation stops after attempt 1 (4 reads) or fails.
    const log = readDeclLog(env.FAKE_GREP_LOG);
    assert.ok(log.length >= 9,
      `stability check must retry past the torn first attempt (>=9 declaration reads; 3 attempts = 12), got ${log.length}`);
    for (const e of log.slice(0, 6)) {
      assert.equal(e.torn, "yes", `declaration read ${e.rseq} must be inside the torn window`);
      assert.ok(e.drop !== "", `torn read ${e.rseq} must name the declaration it dropped`);
    }
    const accepted = log.slice(8).filter((e) => e.kind === "self-create");
    assert.ok(accepted.length >= 1 && accepted.every((e) => e.torn === "no"),
      `the reads the check finally accepted must be complete (not torn), got ${JSON.stringify(accepted)}`);
  } finally { cleanup(ws); cleanup(binDir); }
});

test("torn-read control — the pass-through seam preserves the happy path: consistent reads exit 0", () => {
  const binDir = makeTmp("torn-grep-");
  const env = tornEnv(binDir, { policy: "pass" });
  const ws = makeTmp("torn-ws-");
  try {
    const r = runInitEnv(ws, INIT_ARGS(ws), env);
    assert.equal(r.status, 0, `the pass-through seam must not change a clean install verdict:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /verify-referenced-landed: OK/,
      "the referenced⊆landed gate must pass on consistent reads");
  } finally { cleanup(ws); cleanup(binDir); }
});

test("torn-read negative control — a genuinely missing ref still FAILS --loop (referenced-not-landed), unchanged under the seam", () => {
  const binDir = makeTmp("torn-grep-");
  const env = tornEnv(binDir, { policy: "pass" });
  const ws = makeTmp("torn-ws-");
  try {
    fs.mkdirSync(path.join(ws, "docs", "analysis"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs", "analysis", "torn-evil-consumer.md"),
      "this consumer doc references a path the loop never lays: plugin/scripts/nonexistent-checker.ts\n", "utf8");
    const r = runInitEnv(ws, INIT_ARGS(ws), env);
    assert.notEqual(r.status, 0, "--loop must FAIL when a consumer-laid docs/analysis/ doc references a non-landed path");
    assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
    assert.match(r.stderr, /nonexistent-checker\.ts/, "must name the non-landed referenced path");
  } finally { cleanup(ws); cleanup(binDir); }
});
