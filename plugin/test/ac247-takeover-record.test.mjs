// @test-group lowconc
// ac247-takeover-record.test.mjs — GOAL-016-AC-247 producer (gap-ac247-stalled-project-clean-takeover-record).
//
// AC-247 asks for a record in `.quay/productization-verification.jsonl` proving that the CURRENT build
// cleanly took over a **≥14-day-stalled legacy project on a foreign host** and that the driver really
// ran — read from the carrier, ⛔ never from `quay driver start`'s exit code. Before this task the
// producer did not exist at all: the field names `stale_days` / `pre_task_count` / `post_task_count`
// had never appeared in ANY record in the carrier's history.
//
// What this file pins (the parts that are testable hermetically — the live cross-host run is AC3's
// job and is recorded in the task, not here):
//
//   ① CRITERION ↔ PRODUCER FIELD PARITY. The goal's criterion is a python snippet that filters
//      carrier lines on a fixed set of top-level fields; the producer is `write_ac247_record` in
//      verify-deliver-coldstart.sh. Those are the two sides of ONE predicate set, and nothing in this
//      repo forces them to stay in sync — so a rename on one side would silently make the criterion
//      unsatisfiable (or, worse, satisfiable by a record that means something else). This test reads
//      the field names OUT of the goal file and asserts every one of them is emitted by the producer.
//      It carries its own negative control: deleting a field from the producer's fragment must flip
//      the predicate, otherwise the check is vacuous.
//   ② THE CRITERION TAKES ALL THREE OF ITS VALUES. exit 0 (a qualifying record), exit 1 (a record
//      present but failing one filter — checked for the boundary case stale_days just below 14), and
//      exit 3 (carrier absent ⇒ NOT-EVALUATED, ⛔ not shaped like a pass). Run against the REAL
//      extracted criterion, in a temp workspace, with no network and no cross-host run.
//
// Run:
//   node --test plugin/test/ac247-takeover-record.test.mjs

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

/** The AC-247 goal file (name carries CJK, so match by prefix rather than by literal name). */
function goalFilePath() {
  const dir = path.join(REPO_ROOT, "goals");
  const hit = fs.readdirSync(dir).find((f) => f.startsWith("AC-247") && f.endsWith(".md"));
  assert.ok(hit, "goals/AC-247-*.md must exist — this test reads the criterion from it, never a copy");
  return path.join(dir, hit);
}

/** Extract the embedded `python3 - <<'P' … P` payload of the criterion block (the REAL judge).
 *
 *  ⚠️ The block is a YAML `>-` FOLDED scalar, so its semantics are NOT "join the lines": consecutive
 *  lines at the block's own indentation fold into ONE line separated by a space, blank lines become
 *  newlines, and MORE-indented lines keep their line breaks. Extracting with a plain join reproduces
 *  the source line breaks inside a `"…"` literal and yields a PYTHON SYNTAX ERROR — which exits 1 and
 *  therefore looks exactly like "the criterion ran and found no qualifying record" (measured
 *  2026-09-12: this test was green until a merge re-wrapped the criterion's long lines, then reported
 *  `carrier absent ⇒ exit 3, got 1`). The folding is done here so the payload is what a YAML parser
 *  would hand to python. */
function foldBlockScalar(lines) {
  let out = "";
  let prev = ""; // "" | "blank" | "more" | "normal"
  for (const line of lines) {
    if (line.trim() === "") { out += "\n"; prev = "blank"; continue; }
    const moreIndented = /^[ \t]/.test(line);
    if (out === "") out += line;
    else if (prev === "blank") out += line;              // the blank line already broke it
    else if (moreIndented || prev === "more") out += "\n" + line;
    else out += " " + line;
    prev = moreIndented ? "more" : "normal";
  }
  return out.replace(/^\n+/, "");
}

function criterionPython() {
  const lines = fs.readFileSync(goalFilePath(), "utf8").split("\n");
  const start = lines.findIndex((l) => /^criterion:\s*>-\s*$/.test(l));
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
  assert.ok(py.includes("GOAL-016-AC-247"), "the extracted criterion must be the AC-247 one");
  // A syntax error would make every assertion below meaningless (it exits non-zero for a reason that
  // has nothing to do with the record), so fail loudly instead of mis-reading it as a verdict.
  const chk = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: py, encoding: "utf8" });
  assert.equal(chk.status, 0, `the extracted criterion must be valid python (folding bug?):\n${chk.stderr}\n---\n${py}`);
  return py;
}

/** Run the real criterion in a scratch dir; returns its exit code. */
function runCriterion(py, carrierLines) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ac247-crit-"));
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

test("① the goal's criterion fields are ALL emitted by write_ac247_record (parity, with a negative control)", () => {
  const py = criterionPython();
  const fields = criterionFields(py);
  // The eight AC-247 fields are the whole point of the task; if the criterion ever stops reading one of
  // them, this list is the place that says so out loud (rather than the parity loop silently shrinking).
  assert.deepEqual(fields,
    ["ac", "build_sha", "carrier_records", "driver_alive", "host", "post_task_count",
     "pre_task_count", "project_root", "stale_days"],
    "the criterion must read exactly these top-level fields — a change here is a change to the AC");

  const src = fs.readFileSync(SCRIPT, "utf8");
  const rawBody = src.slice(src.indexOf("write_ac247_record() {"), src.indexOf("\n}", src.indexOf("write_ac247_record() {")));
  assert.ok(rawBody.includes("GOAL-016-AC-247"), "the writer must emit the ac value the criterion filters on");
  // The fragment is shell-escaped (`\"host\":\"$host\"`), so unescape before matching field names —
  // ⛔ otherwise every key misses and the loop fails for the wrong reason (a false negative that would
  // be "fixed" by weakening the predicate instead of the test).
  const body = rawBody.replace(/\\"/g, '"');

  // `ac` is matched against a literal in BOTH places (the criterion's `!= "GOAL-016-AC-247"` and the
  // writer's fragment); every other field must be readable from the writer's fragment key set —
  // EXCEPT `build_sha`, which the criterion reads but the writer deliberately does NOT emit: it is added
  // by the shared anchor choke point `ac_record_append` (test ①b pins that, and pins that no second
  // `build_sha` literal exists in the writer). ⛔ Exempting it here is not a loophole: the choke point is
  // exactly the single-source rule, and ①b is what keeps the exemption honest.
  for (const f of fields) {
    if (f === "ac" || f === "build_sha") continue;
    assert.ok(new RegExp(`"${f}"`).test(body),
      `the producer must emit top-level "${f}" — the criterion reads it, so a producer without it makes the AC unsatisfiable`);
  }
  assert.ok(!/"build_sha"/.test(body),
    "the writer must NOT carry its own build_sha literal — that field comes from ac_record_append (see ①b)");

  // Negative control (硬规则 4: a量 that cannot take false is not a measurement): drop one field from the
  // fragment and the SAME predicate must flip. Without this, a producer that emitted nothing would still
  // pass the loop above.
  const mutated = body.replace('"stale_days"', '"stale_days_renamed"');
  assert.notEqual(mutated, body, "the negative control must actually change the fragment");
  assert.ok(!/"stale_days"/.test(mutated), "the negative control must remove the field the criterion reads");
});

test("①b the producer anchors build_sha through the SHARED choke point, not a second literal (AC-214)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const body = src.slice(src.indexOf("write_ac247_record() {"), src.indexOf("\n}", src.indexOf("write_ac247_record() {")));
  assert.ok(!body.includes("build_sha"),
    "write_ac247_record must NOT write its own build_sha literal — ac_record_append is the single anchor choke point");
  assert.ok(/ac_record_append\s+"/.test(body),
    "the record must be appended through ac_record_append (the single choke point that adds build_sha/ts)");
});

test("② the REAL criterion takes all three values: 0 (qualifying), 1 (fails a filter), 3 (carrier absent)", () => {
  const py = criterionPython();

  // exit 3 — carrier absent is NOT-EVALUATED, distinct from both pass and fail (硬规则 3b).
  const absent = runCriterion(py, null);
  assert.equal(absent.status, 3, `carrier absent ⇒ exit 3, got ${absent.status}\n${absent.stderr}`);

  // A record built the way the producer builds it: host on ANOTHER machine, project_root outside this
  // repo, 61 pre-existing tasks, unchanged count, 22 days stalled, anchored, driver alive with records.
  const good = {
    build_sha: "0123456789abcdef0123456789abcdef01234567",
    ts: "2026-09-12T00:00:00Z",
    ac: "GOAL-016-AC-247",
    host: "instance-20221019-1509",
    project_root: "/home/yale/work/archguard",
    pre_task_count: 61,
    post_task_count: 61,
    stale_days: 22.5,
    driver_alive: 1,
    carrier_records: 1,
  };

  // exit 0 — the qualifying record passes.
  const ok = runCriterion(py, [good]);
  assert.equal(ok.status, 0, `a qualifying AC-247 record ⇒ exit 0, got ${ok.status}\n${ok.stderr}`);

  // exit 1 — the boundary case the AC's whole "not freshly built" guard rests on: 13.999 days of
  // staleness must NOT qualify (and 22.5 above must), so the 14-day threshold is a real filter and not
  // a constant that always passes.
  const tooFresh = runCriterion(py, [{ ...good, stale_days: 13.999 }]);
  assert.equal(tooFresh.status, 1, `stale_days=13.999 ⇒ exit 1 (below the 14-day floor), got ${tooFresh.status}`);

  // exit 1 — "the takeover destroyed the backlog" must also fail, one field at a time; these are the
  // filters that make the AC about a REAL stalled project rather than a shape.
  for (const [label, over] of [
    ["pre_task_count=0 (looks like a fresh quay-init)", { pre_task_count: 0, post_task_count: 0 }],
    ["post_task_count≠pre (backlog changed by the takeover)", { post_task_count: 60 }],
    ["build_sha empty (not traceable to a delivery)", { build_sha: "" }],
    ["driver_alive=0 (read the carrier, it was not alive)", { driver_alive: 0 }],
    ["carrier_records=0 (no carrier evidence the driver ran)", { carrier_records: 0 }],
    ["host = the evaluating host (⛔ must be a foreign host)", { host: os.hostname() }],
    ["carrier_records missing entirely (缺值 ⇒ not a pass)", { carrier_records: undefined }],
  ]) {
    const r = runCriterion(py, [{ ...good, ...over }]);
    assert.equal(r.status, 1, `${label} ⇒ exit 1, got ${r.status}`);
  }
});

test("③ --ac247-takeover is a documented flag AND the step reads liveness from the carrier, not the start rc", () => {
  const help = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, "--help must exit 0");
  assert.match(help.stdout, /--ac247-takeover/, "--help must document the AC-247 takeover mode");
  assert.match(help.stdout, /--takeover-root/, "--help must document --takeover-root");

  const src = fs.readFileSync(SCRIPT, "utf8");
  // The step exists and is wired into the main flow (a function nobody calls is not a producer).
  assert.ok(/^step_ac247_takeover\(\) \{/m.test(src), "step_ac247_takeover must be defined");
  assert.match(src, /step_ac247_takeover "\$AC247_ROOT"/, "the main flow must invoke the AC-247 step");
  // ⛔ AC4: the recorded driver_alive must come from the status carrier. The start rc may be recorded
  // as a diagnostic, but it must never be the value written into the record's driver_alive field.
  const writer = src.slice(src.indexOf("write_ac247_record() {"), src.indexOf("\n}", src.indexOf("write_ac247_record() {")));
  assert.ok(!/DRIVER_START_RC/.test(writer.replace(/^.*ac_record_append.*$/m, "")),
    "the record's driver_alive must not be derived from the driver start exit code");
});
