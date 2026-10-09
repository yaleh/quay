// @test-group lowconc
// ac248-adr-check-flip-record.test.mjs — GOAL-016-AC-248 producer
// (gap-ac248-adr-check-differential-record-producer).
//
// AC-248 asks for a record in `.quay/productization-verification.jsonl` proving that a fix quay's
// drivers drove out of a foreign project made **that project's own** mechanical checker go from NOT
// seeing a tool to seeing it — read as a `false → true` flip of two booleans, ⛔ never from a single
// run's exit code (that value is already green today: 漏检与合格同形, 硬规则 3b).
//
// Before this task the three field names `adr_check_before_detects` / `adr_check_after_detects` /
// `adr_check_probe_tool` had never appeared in ANY record in the carrier's history: the nearest
// relative (`write_ac207_record`) writes eight of the fields this AC also needs, and not one
// `adr_check_*` field. So this is a missing **step**, not a producer that never ran.
//
// What this file pins (the parts that are testable hermetically — the live cross-host run is AC4's
// job and is recorded in the task, not here):
//
//   ① CRITERION ↔ PRODUCER FIELD PARITY. The goal's criterion is a python snippet that filters
//      carrier lines on a fixed set of top-level fields; the producer is `write_ac248_record` in
//      verify-deliver-coldstart.sh. Those are the two sides of ONE predicate set and nothing forces
//      them to stay in sync — a rename on one side would silently make the criterion unsatisfiable.
//   ①b NO LITERAL DEFAULTS ON THE WRITE PATH (AC2): the writer's own body carries no `true`/`false`
//      literal and no second `build_sha` anchor — the two booleans come from the run readings, the
//      anchor comes from the ONE choke point `ac_record_append`.
//   ② THE CRITERION TAKES ALL THREE OF ITS VALUES, against the REAL extracted payload: exit 0 (a
//      qualifying record), exit 1 (a record present but failing ONE filter — every filter, including
//      the two strict-bool ones, is exercised with an impostor), exit 3 (carrier absent).
//   ③ THE FLIP READING IS A MEASUREMENT, NOT AN ECHO (硬规则 4): `ac248_adr_flip_reading` is driven
//      against a REAL temp git repo whose checker really changes between two commits — the positive
//      case yields the newly-seen tool name and `false`/`true`; the control where nothing changed
//      yields an EMPTY probe (⇒ no record), so `before=false ∧ after=true` is not something the
//      producer can assert unconditionally.
//   ④ quay DOES NOT OWN THE JUDGMENT (AC3): the producer segment carries no `adr-ok` / `ADR-007`
//      judgment of its own and does call the target checker's own exported enumerator.
//
// Run:
//   node --test plugin/test/ac248-adr-check-flip-record.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "verify-deliver-coldstart.sh");

/** The AC-248 goal file (name carries CJK, so match by prefix rather than by literal name). */
function goalFilePath() {
  const dir = path.join(REPO_ROOT, "goals");
  const hit = fs.readdirSync(dir).find((f) => f.startsWith("AC-248") && f.endsWith(".md"));
  assert.ok(hit, "goals/AC-248-*.md must exist — this test reads the criterion from it, never a copy");
  return path.join(dir, hit);
}

/** Extract the embedded `python3 - <<'P' … P` payload of the criterion block (the REAL judge).
 *
 *  ⚠️ The block is a YAML `>-` FOLDED scalar, so its semantics are NOT "join the lines": consecutive
 *  lines at the block's own indentation fold into ONE line separated by a space, blank lines become
 *  newlines, and MORE-indented lines keep their line breaks. A plain join reproduces source line
 *  breaks inside a `"…"` literal and yields a PYTHON SYNTAX ERROR — which exits 1 and therefore looks
 *  exactly like "the criterion ran and found no qualifying record" (the sibling AC-247 test measured
 *  this on 2026-09-12). The folding is done here so the payload is what a YAML parser would hand to
 *  python. */
function foldBlockScalar(lines) {
  let out = "";
  let prev = ""; // "" | "blank" | "more" | "normal"
  for (const line of lines) {
    if (line.trim() === "") { out += "\n"; prev = "blank"; continue; }
    const moreIndented = /^[ \t]/.test(line);
    if (out === "") out += line;
    else if (prev === "blank") out += line;
    else if (moreIndented || prev === "more") out += "\n" + line;
    else out += " " + line;
    prev = moreIndented ? "more" : "normal";
  }
  return out.replace(/^\n+/, "");
}

function criterionPython() {
  const lines = fs.readFileSync(goalFilePath(), "utf8").split("\n");
  const start = lines.findIndex((l) => /^criterion:\s*>[-+]?\s*$/.test(l));
  assert.ok(start >= 0, "the goal must declare `criterion: >-`");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(lines[i])) { end = i; break; }
  }
  const block = lines.slice(start + 1, end).map((l) => (l.startsWith("  ") ? l.slice(2) : l));
  const folded = foldBlockScalar(block).split("\n");
  const hStart = folded.findIndex((l) => l.includes("python3 - <<"));
  assert.ok(hStart >= 0, "the criterion must embed `python3 - <<'P'`");
  let hEnd = folded.length;
  for (let i = hStart + 1; i < folded.length; i++) {
    if (/^P\s*$/.test(folded[i])) { hEnd = i; break; }
  }
  const py = folded.slice(hStart + 1, hEnd).join("\n");
  assert.ok(py.includes("GOAL-016-AC-248"), "the extracted criterion must be the AC-248 one");
  // A syntax error would make every assertion below meaningless (it exits non-zero for a reason that
  // has nothing to do with the record), so fail loudly instead of mis-reading it as a verdict.
  const chk = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: py, encoding: "utf8" });
  assert.equal(chk.status, 0, `the extracted criterion must be valid python (folding bug?):\n${chk.stderr}\n---\n${py}`);
  return py;
}

/** Run the real criterion in a scratch dir; returns the spawnSync result. */
function runCriterion(py, carrierLines) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ac248-crit-"));
  try {
    if (carrierLines !== null) {
      fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
      fs.writeFileSync(path.join(ws, ".quay", "productization-verification.jsonl"),
        carrierLines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
    }
    const pyFile = path.join(ws, "criterion.py");
    fs.writeFileSync(pyFile, py);
    return spawnSync("python3", [pyFile], { cwd: ws, encoding: "utf8" });
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

/** Every top-level field name the criterion reads off a carrier record. */
function criterionFields(py) {
  const names = new Set();
  for (const m of py.matchAll(/r\.get\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) names.add(m[1]);
  return [...names].sort();
}

function writerBody() {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const start = src.indexOf("write_ac248_record() {");
  assert.ok(start >= 0, "write_ac248_record must exist in verify-deliver-coldstart.sh");
  return src.slice(start, src.indexOf("\n}", start));
}

/** The AC-248 producer segment (from its first helper to the install section) — used for ④. */
function producerSegment() {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const start = src.indexOf("ac248_checker_relpath() {");
  const end = src.indexOf("# ── ① 安装");
  assert.ok(start >= 0 && end > start, "the AC-248 producer segment must be locatable");
  return src.slice(start, end);
}

/** Extract a top-level single-quoted declaration verbatim from the product script. */
function bashDeclarationSource(src, name) {
  const start = src.indexOf(`\n${name}='`);
  assert.ok(start >= 0, `${name} must be a single-quoted top-level declaration in verify-deliver-coldstart.sh`);
  const end = src.indexOf("'\n", start + name.length + 3);
  assert.ok(end > start, `${name} must be a closed single-quoted scalar`);
  return src.slice(start + 1, end + 2);
}

/** The AC-248 record as the producer writes it, built through the real writer (bash) — see ③b. */
function writeRecordViaProduct(spec) {
  // `ac_record_*` = the rest of `ac_record_append`'s closure: since
  // gap-ac-record-schema-duplicated-between-criterion-and-writer the ONE anchor choke point also
  // enforces AC_RECORD_SCHEMA at production time. This list is a HAND-maintained model of the writer's
  // dependency graph, so an unlisted dependency makes the extracted writer die with
  // `ac_record_schema_validate_fragment: command not found` ⇒ non-zero ⇒ REFUSED for EVERY input —
  // i.e. all of ③b's negatives stay vacuously green and only the positive control ("the positive spec
  // must write exactly one record") goes red. Listed so the refusals below are the product's verdicts.
  const fnNames = ["ac_record_append", "ac_record_schema_validate_fragment", "ac_record_fragment_ac",
    "ac_record_carrier_root", "ac_record_finalize", "ac248_json_bool_ok", "ac248_flip_is_forward",
    "ac248_produced_by_driver_ok", "ac_files_non_bookkeeping", "write_ac248_record"];
  const src = fs.readFileSync(SCRIPT, "utf8");
  let harness = 'set -uo pipefail\nVC_NODE="${VC_NODE:-node}"\n';
  for (const fn of fnNames) {
    const i = src.indexOf(`${fn}() {`);
    assert.ok(i >= 0, `${fn} must exist`);
    harness += src.slice(i, src.indexOf("\n}", i) + 2) + "\n";
  }
  // AC_RECORD_SCHEMA lives OUTSIDE every function body, so a harness built from bodies alone leaves it
  // unset ⇒ the choke point dies under `set -u` ⇒ REFUSED for every input (see fnNames above). Read
  // from the product script, ⛔ never re-pasted here: a second copy of the field list IS the defect.
  harness += bashDeclarationSource(src, "AC_RECORD_SCHEMA") + "\n";
  harness += `AC89="$AC89"; BUILD_SHA="$BUILD_SHA"; TS="2026-09-12T00:00:00Z"\n`;
  harness += `if write_ac248_record ${spec.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ")} 2>/dev/null; then echo WROTE; else echo REFUSED; fi\n`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac248-w-"));
  try {
    const env = { ...process.env, AC89: path.join(tmp, "carrier.jsonl"),
      BUILD_SHA: "0123456789abcdef0123456789abcdef01234567" };
    const r = spawnSync("bash", ["-c", harness], { encoding: "utf8", env });
    const lines = fs.existsSync(path.join(tmp, "carrier.jsonl"))
      ? fs.readFileSync(path.join(tmp, "carrier.jsonl"), "utf8").trim().split("\n").filter(Boolean)
      : [];
    return { verdict: r.stdout.trim(), lines };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("① the goal's criterion fields are ALL emitted by write_ac248_record (parity + negative control)", () => {
  const py = criterionPython();
  const fields = criterionFields(py);
  // The whole point of the task is the three `adr_check_*` fields on top of the AC-207 eight. Note the
  // criterion reads NO `build_sha` (unlike AC-247's) — the anchor is still written, through the shared
  // choke point, but this AC's judge does not filter on it, and this list says so out loud.
  assert.deepEqual(fields,
    ["ac", "adr_check_after_detects", "adr_check_before_detects", "adr_check_probe_tool",
     "commit_files", "commit_sha", "gate_events", "host", "produced_by_driver", "project_root",
     "task_id", "task_status"],
    "the criterion must read exactly these top-level fields — a change here is a change to the AC");

  const rawBody = writerBody();
  assert.ok(rawBody.includes("GOAL-016-AC-248"), "the writer must emit the ac value the criterion filters on");
  // The fragment is shell-escaped (`\"host\":\"$host\"`), so unescape before matching field names —
  // ⛔ otherwise every key misses and the loop fails for the wrong reason.
  const body = rawBody.replace(/\\"/g, '"');
  for (const f of fields) {
    if (f === "ac" || f === "build_sha") continue;
    assert.ok(new RegExp(`"${f}"`).test(body),
      `the producer must emit top-level "${f}" — the criterion reads it, so a producer without it makes the AC unsatisfiable`);
  }
  // Negative control (硬规则 4: a量 that cannot take false is not a measurement).
  const mutated = body.replace('"adr_check_probe_tool"', '"adr_check_probe_tool_renamed"');
  assert.notEqual(mutated, body, "the negative control must actually change the fragment");
  assert.ok(!/"adr_check_probe_tool"/.test(mutated), "the negative control must remove the field the criterion reads");
});

test("①b the write path carries NO literal default: zero true/false, and build_sha only from the choke point", () => {
  const body = writerBody();
  assert.ok(!body.includes("build_sha"),
    "write_ac248_record must NOT write its own build_sha literal — ac_record_append is the single anchor choke point");
  assert.ok(/ac_record_append\s+"/.test(body), "the record must be appended through ac_record_append");
  // AC2: the two booleans must be the READINGS. A literal `true`/`false` on the write path would be a
  // hardcoded default that makes the flip assertable without ever running a checker (硬规则 4).
  const literalHits = (body.replace(/#.*/g, "").match(/(^|[^_a-zA-Z])(true|false)([^_a-zA-Z]|$)/g) || []).length;
  assert.equal(literalHits, 0,
    "write_ac248_record's body must contain ZERO `true`/`false` literals — the booleans come from the two run readings");
  // …and the readings really are what flows in: the fragment interpolates the two parameters unquoted
  // (⇒ JSON booleans), and the direction/OK validators are the only place literals may live.
  const frag = body.replace(/\\"/g, '"');
  assert.ok(/"adr_check_before_detects":\$before/.test(frag), "before_detects must be interpolated as a bare value");
  assert.ok(/"adr_check_after_detects":\$after/.test(frag), "after_detects must be interpolated as a bare value");
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(/ac248_flip_is_forward\(\)\s*\{[^}]*false[^}]*true/.test(src),
    "the direction predicate (the only place the literals may live) must require false → true");
});

test("② the REAL criterion takes 0 / 1 / 3, and every filter — including both strict bools — can reject", () => {
  const py = criterionPython();

  // exit 3 — carrier absent is NOT-EVALUATED, distinct from both pass and fail (硬规则 3b).
  assert.equal(runCriterion(py, null).status, 3, "carrier absent ⇒ exit 3");

  // A record built the way the producer builds it (host on another machine, project_root outside this
  // repo, an implementation commit touching a source file, before false / after true, a probe tool).
  const good = {
    build_sha: "0123456789abcdef0123456789abcdef01234567",
    ts: "2026-09-12T00:00:00Z",
    ac: "GOAL-016-AC-248",
    host: "instance-20221019-1509",
    project_root: "/home/yale/work/archguard",
    commit_sha: "1111111111111111111111111111111111111111",
    commit_files: ["src/cli/mcp/tools/metric-trend-tools.ts"],
    task_id: "TASK-88",
    task_status: "done",
    gate_events: 3,
    produced_by_driver: true,
    adr_check_before_detects: false,
    adr_check_after_detects: true,
    adr_check_probe_tool: "archguard_get_metric_trend",
  };
  assert.equal(runCriterion(py, [good]).status, 0, "a qualifying AC-248 record ⇒ exit 0");

  const base = "exit 1 (present but failing a filter)";
  const rejects = [
    ["after_detects flipped to false", { adr_check_after_detects: false }, "the reverse direction must not pass"],
    ["before_detects flipped to true", { adr_check_before_detects: true }, "asserting the flip from the wrong side must not pass"],
    ["after_detects as 1 (number)", { adr_check_after_detects: 1 }, "`is True` must reject 1"],
    ["before_detects as 0 (number)", { adr_check_before_detects: 0 }, "`is False` must reject 0"],
    ["after_detects as \"true\" (string)", { adr_check_after_detects: "true" }, "`is True` must reject the string"],
    ["before_detects as \"false\" (string)", { adr_check_before_detects: "false" }, "`is False` must reject the string"],
    ["after_detects missing", { adr_check_after_detects: undefined }, "缺字段 must not impersonate `is False`"],
    ["probe tool empty", { adr_check_probe_tool: "" }, "an empty probe names no tool"],
    ["probe tool missing", { adr_check_probe_tool: undefined }, "a missing probe must not count"],
    ["bookkeeping-only commit_files", { commit_files: ["tasks/a.md", "goals/b.md"] }, "a status flip is not an implementation"],
    ["commit_files empty", { commit_files: [] }, "no files is no implementation"],
    ["task_status not done", { task_status: "ready" }, "an unfinished task produces no evidence"],
    ["gate_events zero", { gate_events: 0 }, "no gate events ⇒ not driven"],
    ["produced_by_driver false", { produced_by_driver: false }, "must be exactly true"],
    ["task_id empty", { task_id: "" }, "the task must be named"],
    ["commit_sha empty", { commit_sha: "" }, "the implementation commit must be named"],
  ];
  for (const [name, patch, why] of rejects) {
    const rec = { ...good };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete rec[k]; else rec[k] = v;
    }
    assert.equal(runCriterion(py, [rec]).status, 1, `${base} — ${name}: ${why}`);
  }

  // host = THIS machine and project_root = the criterion's own CWD are the two locality guards: a
  // record about a checkout right here would make "an external judge confirmed the fix" meaningless.
  // (`project_root` is given as "." because the criterion resolves it with `os.path.realpath` against
  // its own cwd — the scratch workspace — which is exactly the in-repo case it must reject.)
  assert.equal(runCriterion(py, [{ ...good, host: os.hostname() }]).status, 1, "host == local hostname must not qualify");
  assert.equal(runCriterion(py, [{ ...good, project_root: "." }]).status, 1, "project_root inside the evaluating repo must not qualify");
});

test("③ the flip reading measures a REAL checker in a REAL git repo — and takes false when nothing changed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac248-flip-"));
  try {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    // The fixture checker reads its input through a CWD-RELATIVE path, like the real one does (the real
    // checker locates the directory it scans from `process.cwd()`). That shape is load-bearing: a
    // candidate-set read that does NOT run inside the materialized revision silently reads an EMPTY set
    // with exit code 0 — measured 2026-09-12 against archguard (0 tools read vs 32 in the worktree).
    // ⛔ A fixture whose checker ignores cwd would be green against that defect.
    fs.writeFileSync(path.join(repo, "scripts", "check-adr.ts"),
      'import fs from "node:fs";\n' +
      'export function extractMcpToolNames(): string[] {\n' +
      '  return fs.readFileSync("src/tools.txt", "utf8").trim().split("\\n").filter(Boolean);\n' +
      '}\n');
    fs.writeFileSync(path.join(repo, "src", "tools.txt"), "tool_seen\n");
    fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(repo, "tasks", "seed.md"), "seed\n");
    git("add", "-A"); git("commit", "-qm", "seed: project baseline");
    // The BOOKKEEPING BOUNDARY: a tasks/-only commit between the history and the fix series — what a
    // quay driver lands every round. It is what makes the pre-revision derivable when the fix spans
    // several commits (below).
    fs.writeFileSync(path.join(repo, "tasks", "T-1.md"), "T-1 ready\n");
    git("add", "-A"); git("commit", "-qm", "tasks: T-1 首次登记（机械落盘）");
    // A real fix is SEVERAL commits (measured 2026-09-12 on ad-arm1 TASK-88: fix + test + lint fixup),
    // and the NEWEST one only touches the test file — its parent already carries the fix. So the
    // pre-revision must be derived from the fix-series boundary, not from `<impl>^`.
    fs.writeFileSync(path.join(repo, "src", "tools.txt"), "tool_seen\ntool_newly_seen\n");
    git("add", "-A"); git("commit", "-qm", "fix: checker sees the comment-prefixed declaration");
    fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
    fs.writeFileSync(path.join(repo, "tests", "check-adr.test.ts"), "test\n");
    git("add", "-A"); git("commit", "-qm", "test: assert the two extractors agree directly");
    const sha = git("rev-parse", "HEAD").stdout.trim();
    // The pre-revision the producer must derive: the BOOKKEEPING boundary (HEAD~2), NOT the impl
    // commit's parent (HEAD~1) — the latter already carries the fix.
    const base = git("rev-parse", "HEAD~2").stdout.trim();
    const implParent = git("rev-parse", "HEAD~1").stdout.trim();

    const driver = `
set -uo pipefail
VC_NODE="\${VC_NODE:-node}"
SCRIPT="$SCRIPT"
${["ac248_checker_relpath", "ac248_materialize_rev", "ac248_run_checker_cli", "ac248_candidate_set",
   "ac248_pre_rev", "ac248_adr_flip_reading"].map((fn) => `eval "$(sed -n '/^${fn}()/,/^}$/p' "$SCRIPT")"`).join("\n")}
eval "$(sed -n '/^ac207_commit_files()/,/^}$/p' "$SCRIPT")"
eval "$(sed -n '/^ac207_is_bookkeeping_commit()/,/^}$/p' "$SCRIPT")"
ac248_adr_flip_reading "$REPO" "$SHA" "$WORK"
printf 'PROBE=%s\\nBEFORE=%s\\nAFTER=%s\\n' "$AC248_PROBE_TOOL" "$AC248_BEFORE_DETECTS" "$AC248_AFTER_DETECTS"
printf 'PRE=%s\\nSRC=%s\\nSPAN=%s\\nTOOLS_BEFORE=%s\\nTOOLS_AFTER=%s\\n' "$AC248_PRE_REV" "$AC248_PRE_REV_SOURCE" "$AC248_PRE_REV_SPAN" "$AC248_BEFORE_TOOLS_JSON" "$AC248_AFTER_TOOLS_JSON"
ac248_adr_flip_reading "$REPO" "$BASE" "$WORK2"
printf 'NOFIX_PROBE=<%s>\\n' "$AC248_PROBE_TOOL"
# reverse control: an explicitly recorded pre-head of <impl>^ must yield NO probe (otherwise the
# "derive the boundary" rule above would be indistinguishable from "pick whatever produces a diff").
ac248_adr_flip_reading "$REPO" "$SHA" "$WORK3" "$IMPLPARENT"
printf 'IMPLPARENT_PROBE=<%s>\\n' "$AC248_PROBE_TOOL"
`;
    const r = spawnSync("bash", ["-c", driver], {
      encoding: "utf8",
      env: { ...process.env, SCRIPT, REPO: repo, SHA: sha, BASE: base, IMPLPARENT: implParent,
        WORK: path.join(tmp, "rt1"), WORK2: path.join(tmp, "rt2"), WORK3: path.join(tmp, "rt3") },
    });

    const out = r.stdout;
    const get = (k) => (out.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1];

    // ③a positive: the checker's own two runs really differ, and the difference names the tool.
    assert.equal(get("PROBE"), "tool_newly_seen", `probe tool must come from the set difference\n${out}\n${r.stderr}`);
    assert.equal(get("BEFORE"), "false", "the tool must be OUTSIDE the before candidate set");
    assert.equal(get("AFTER"), "true", "the tool must be INSIDE the after candidate set");
    assert.equal(get("PRE"), base, "the pre-revision must be the fix-series BOUNDARY (a bookkeeping commit), not <impl>^");
    assert.equal(get("SRC"), "fix-series-boundary", "the derivation rule must be recorded");
    assert.equal(get("SPAN"), "2", "the span (fix + test) must be recorded — the pre is the state BEFORE the whole series");
    assert.equal(get("TOOLS_BEFORE"), '["tool_seen"]', "the before candidate set must be the checker's real reading");
    assert.equal(get("TOOLS_AFTER"), '["tool_seen","tool_newly_seen"]', "the after candidate set must be the checker's real reading");

    // ③c the rule must not be "pick whatever produces a difference": an explicitly recorded pre-head of
    // `<impl>^` (which already carries the fix) yields NO probe — i.e. the boundary derivation above is
    // doing real work, and the flip is not assertable from any pairing of revisions.
    assert.equal(get("IMPLPARENT_PROBE"), "<>",
      "a recorded pre-head of <impl>^ must yield NO probe — the boundary derivation is what makes the reading real");

    // ③b the control that keeps ③a from being an echo: point the SAME reading at a commit where nothing
    // changed ⇒ the difference is EMPTY ⇒ no probe ⇒ the producer must refuse to write (硬规则 4: if
    // `before=false ∧ after=true` were assertable without any real reading, this control would still
    // produce a probe).
    assert.equal(get("NOFIX_PROBE"), "<>", "with no change between the two revisions there must be NO probe ⇒ no record");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("③b the producer refuses every malformed record — including 0/1 and string impostors (product function)", () => {
  const sha = "1111111111111111111111111111111111111111";
  const files = '["src/cli/mcp/tools/metric-trend-tools.ts"]';
  const ok = ["hostX-arm", "/home/other/archguard", sha, "TASK-88", "done", "3", "true", files,
    "false", "true", "archguard_get_metric_trend"];
  const pos = writeRecordViaProduct(ok);
  assert.equal(pos.verdict, "WROTE", "the positive spec must write exactly one record");
  assert.equal(pos.lines.length, 1);
  const rec = JSON.parse(pos.lines[0]);
  assert.equal(rec.adr_check_before_detects, false, "before_detects must be a JSON boolean, not 0/\"false\"");
  assert.equal(rec.adr_check_after_detects, true, "after_detects must be a JSON boolean, not 1/\"true\"");
  assert.equal(rec.adr_check_probe_tool, "archguard_get_metric_trend");
  assert.equal(typeof rec.adr_check_before_detects, "boolean");

  const at = (i, v) => ok.map((x, j) => (j === i ? v : x));
  const negatives = [
    ["reverse direction (true → false)", at(8, "true").map((x, j) => (j === 9 ? "false" : x))],
    ["0/1 impostors", at(8, "0").map((x, j) => (j === 9 ? "1" : x))],
    ["string \"false\"/\"true\" impostors", at(8, '"false"').map((x, j) => (j === 9 ? '"true"' : x))],
    ["before unreadable (empty)", at(8, "")],
    ["after unreadable (empty)", at(9, "")],
    ["probe tool empty", at(10, "")],
    ["bookkeeping-only commit_files", at(7, '["tasks/a.md","goals/b.md"]')],
    ["gate_events 0", at(5, "0")],
    ["produced_by_driver false", at(6, "false")],
    ["task not done", at(4, "ready")],
    ["task_id empty", at(3, "")],
    ["commit_sha empty", at(2, "")],
    ["host empty", at(0, "")],
    ["project_root empty", at(1, "")],
  ];
  for (const [name, spec] of negatives) {
    assert.equal(writeRecordViaProduct(spec).verdict, "REFUSED",
      `the writer must refuse: ${name} (零记录 + 非 0 —— 缺值≠合格)`);
  }
});

test("④ quay does not own the ADR judgment: no adr-ok/ADR-007 in the producer, and the checker's own enumerator is called", () => {
  const seg = producerSegment().replace(/#.*/g, "");
  assert.equal((seg.match(/adr-ok|ADR-007/g) || []).length, 0,
    "the AC-248 producer must carry NO ADR-007 judgment of its own — the criterion's correctness belongs to the target project");
  assert.ok(/extractMcpToolNames/.test(seg),
    "the candidate set must come from the TARGET checker's own exported enumerator, not a quay-side re-implementation");
  // The candidate set is only meaningful if it is read from the materialized revision (not the live tree):
  assert.ok(/git[^\n]*-C[^\n]*archive/.test(seg) || /ac248_materialize_rev/.test(seg),
    "both revisions must be materialized from git (⛔ never read off the live worktree)");
  const src = fs.readFileSync(SCRIPT, "utf8");
  const stepBody = src.slice(src.indexOf("step_ac248_adr_flip() {"));
  assert.ok(/probe_ac248_measures/.test(stepBody.slice(0, stepBody.indexOf("\n}"))),
    "the reading must be invoked from INSIDE step_ac248_adr_flip's body (positional control)");
});
