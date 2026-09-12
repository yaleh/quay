// @test-group lowconc
// ac250-web-observe-progress-record.test.mjs — GOAL-016-AC-250 producer
// (gap-ac250-web-observe-tailscale-progress-record).
//
// AC-250 asks for a record in `.quay/productization-verification.jsonl` proving the OBSERVATION
// surface: the target project's quay web server is bound to that host's **tailscale0** address, was
// probed **from another machine**, and actually **reflects progress** (the same task's rendered
// status differs between two readings) with the store agreeing with the page.
//
// Before this task none of `bind_host` / `tailscale0_ip` / `probe_from_host` / `observed_status_before`
// / `observed_status_after` / `store_status_after` / `observed_task_id` appeared anywhere outside
// `goals/`, and `grep -rn tailscale plugin/` was 0 hits — a missing **step**, not a producer that
// never ran. The nearest relative is AC-234 (`write_ac234_record`), whose shape is the OPPOSITE of
// this one on every axis (`--host 127.0.0.1`, one page read, same-machine curl), and the criterion's
// own words ("⛔ 不判单点渲染") name that mechanism as the excluded one — so AC-234's green carries
// no information about this AC.
//
// What this file pins (the parts testable hermetically — the live cross-host run is AC4's job and is
// recorded in the task, not here):
//
//   ① CRITERION ↔ PRODUCER FIELD PARITY. The goal's criterion is a python snippet filtering carrier
//      lines on a fixed set of top-level fields; the producer is `write_ac250_record`. Nothing forces
//      the two sides to stay in sync, so a rename on one side would silently make the AC
//      unsatisfiable.
//   ①b NO LITERAL DEFAULTS ON THE WRITE PATH (AC2): the writer's own body carries no `build_sha`
//      anchor literal and no address literal — the anchor comes from the ONE choke point
//      `ac89_append_goal009`, and every field comes from a run reading.
//   ② THE CRITERION TAKES ALL THREE OF ITS VALUES, against the REAL extracted payload: exit 0, exit 1
//      (every filter exercised with an impostor, including the loopback/listen-address one and the
//      same-task-differential one), exit 3 (carrier absent).
//   ③ THE READINGS ARE MEASUREMENTS, NOT ECHOES (硬规则 4): the row parser is driven against REAL
//      rendered HTML and the listen-address reader against REAL `ss -ltnp` text — including a control
//      where the page shows the loopback binding and a control where the `--host` argument and the
//      observed listen address DISAGREE (the whole point of ①): the reader must report the observed
//      one, and `bind_host` built from the argument alone must be REFUSED.
//   ④ THE STEP'S OUTCOME VOCABULARY HAS THREE DISTINCT VALUES (硬规则 3b): `ok` / `no-change` /
//      `not-evaluated:*` all exist and none is spelled the same as another — "measured, nothing
//      changed" must never be indistinguishable from "could not measure", and neither may look like
//      a qualifying record.
//
// Run:
//   node --test plugin/test/ac250-web-observe-progress-record.test.mjs

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

/** The AC-250 goal file (name carries CJK, so match by prefix rather than by literal name). */
function goalFilePath() {
  const dir = path.join(REPO_ROOT, "goals");
  const hit = fs.readdirSync(dir).find((f) => f.startsWith("AC-250") && f.endsWith(".md"));
  assert.ok(hit, "goals/AC-250-*.md must exist — this test reads the criterion from it, never a copy");
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
  assert.ok(py.includes("GOAL-016-AC-250"), "the extracted criterion must be the AC-250 one");
  // A syntax error would make every assertion below meaningless (it exits non-zero for a reason that
  // has nothing to do with the record), so fail loudly instead of mis-reading it as a verdict.
  const chk = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: py, encoding: "utf8" });
  assert.equal(chk.status, 0, `the extracted criterion must be valid python (folding bug?):\n${chk.stderr}\n---\n${py}`);
  return py;
}

/** Run the real criterion in a scratch dir; returns the spawnSync result.
 *
 *  `carrierLines` may be an array, or a function `(ws) => array` — the criterion decides "inside this
 *  repo" against ITS OWN cwd (`os.path.realpath(".")`), so an in-repo `project_root` impostor has to
 *  name a path under the scratch workspace, which only exists once the workspace does. */
function runCriterion(py, carrierLines) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ac250-crit-"));
  try {
    if (typeof carrierLines === "function") carrierLines = carrierLines(ws);
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

function fnBody(name) {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const start = src.indexOf(`${name}() {`);
  assert.ok(start >= 0, `${name} must exist in verify-deliver-coldstart.sh`);
  return src.slice(start, src.indexOf("\n}", start));
}

function stepBody() {
  return fnBody("step_ac250_web_observe");
}

/** The script's OWN function source, verbatim — so the controls below drive the PRODUCT code rather
 *  than a fixture-side re-implementation of the reading logic (硬规则 4 推论三: a fixture that
 *  satisfies only the fixture is not a test). */
function sliceFn(name) {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const i = src.indexOf(`${name}() {`);
  assert.ok(i >= 0, `${name} must exist in verify-deliver-coldstart.sh`);
  return src.slice(i, src.indexOf("\n}", i) + 2) + "\n";
}

/** Extract a top-level single-quoted declaration verbatim from the product script. */
function bashDeclarationSource(src, name) {
  const start = src.indexOf(`\n${name}='`);
  assert.ok(start >= 0, `${name} must be a single-quoted top-level declaration in verify-deliver-coldstart.sh`);
  const end = src.indexOf("'\n", start + name.length + 3);
  assert.ok(end > start, `${name} must be a closed single-quoted scalar`);
  return src.slice(start + 1, end + 2);
}

/** The AC-250 record as the producer writes it, built through the REAL writer (bash). */
function writeRecordViaProduct(spec) {
  // ⚠️ This list is a HAND-maintained model of `ac89_append_goal009`'s dependency graph, so it goes
  // stale whenever that graph grows. Left stale, the extracted writer dies with
  // `ac_record_schema_validate_fragment: command not found` / `AC_RECORD_SCHEMA: unbound variable`
  // ⇒ non-zero ⇒ REFUSED for EVERY input. This fixture has NO positive control on this path (its one
  // caller asserts REFUSED), so a stale closure here does not turn it red — it turns it VACUOUS, an
  // assertion that passes for a reason that has nothing to do with the record's shape (硬规则 3b).
  // Measured 2026-09-12: exactly that happened when the schema choke point landed.
  const fnNames = ["ac89_append_goal009", "ac_record_schema_validate_fragment", "ac_record_fragment_ac",
    "ac_record_carrier_root", "ac_record_finalize", "ac250_not_loopback", "ac250_http_status_ok",
    "write_ac250_record"];
  const src = fs.readFileSync(SCRIPT, "utf8");
  let harness = 'set -uo pipefail\nVC_NODE="${VC_NODE:-node}"\n';
  for (const fn of fnNames) {
    const i = src.indexOf(`${fn}() {`);
    assert.ok(i >= 0, `${fn} must exist`);
    harness += src.slice(i, src.indexOf("\n}", i) + 2) + "\n";
  }
  harness += bashDeclarationSource(src, "AC_RECORD_SCHEMA") + "\n";
  harness += `AC89="$AC89"; BUILD_SHA="$BUILD_SHA"; TS="2026-09-12T00:00:00Z"\n`;
  harness += `if write_ac250_record ${spec.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ")} 2>/dev/null; then echo WROTE; else echo REFUSED; fi\n`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac250-w-"));
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

/** A qualifying record built the way the producer builds it. */
function goodRecord(overrides = {}) {
  return {
    build_sha: "0123456789abcdef0123456789abcdef01234567",
    ts: "2026-09-12T00:00:00Z",
    ac: "GOAL-016-AC-250",
    host: "instance-20221019-1509",
    project_root: "/home/yale/work/archguard",
    bind_host: "100.100.148.48",
    tailscale0_ip: "100.100.148.48",
    probe_from_host: "boheidc",
    http_status: 200,
    observed_task_id: "AC250PROBE-1",
    observed_status_before: "todo",
    observed_status_after: "ready",
    store_status_after: "ready",
    ...overrides,
  };
}

test("① the goal's criterion fields are ALL emitted by write_ac250_record (parity + negative control)", () => {
  const py = criterionPython();
  const fields = criterionFields(py);
  // The criterion reads NO `build_sha` (unlike AC-247's) — the anchor is still written, through the
  // shared choke point, but this AC's judge does not filter on it, and this list says so out loud.
  assert.deepEqual(fields,
    ["ac", "bind_host", "host", "http_status", "observed_status_after", "observed_status_before",
     "observed_task_id", "probe_from_host", "project_root", "store_status_after", "tailscale0_ip"],
    "the criterion must read exactly these top-level fields — a change here is a change to the AC");

  const body = fnBody("write_ac250_record").replace(/\\"/g, '"');
  assert.ok(body.includes("GOAL-016-AC-250"), "the writer must emit the ac value the criterion filters on");
  for (const f of fields) {
    if (f === "ac") continue;
    assert.ok(new RegExp(`"${f}"`).test(body),
      `the producer must emit top-level "${f}" — the criterion reads it, so a producer without it makes the AC unsatisfiable`);
  }
  // Negative control (硬规则 4: a量 that cannot take false is not a measurement).
  const mutated = body.replace('"bind_host"', '"bind_host_renamed"');
  assert.notEqual(mutated, body, "the negative control must actually change the fragment");
  assert.ok(!/"bind_host":/.test(mutated), "the negative control must remove the field the criterion reads");
});

test("①b the write path carries NO literal default: no build_sha anchor, no address literal", () => {
  const body = fnBody("write_ac250_record");
  assert.ok(!body.includes("build_sha"),
    "write_ac250_record must NOT write its own build_sha literal — ac89_append_goal009 is the single anchor choke point");
  assert.ok(/ac89_append_goal009\s+"/.test(body), "the record must be appended through ac89_append_goal009");
  // AC2: no address may be hardcoded anywhere on the write path (the criterion demands
  // `bind_host == tailscale0_ip`, i.e. DERIVED, not copied). Note the loopback/wildcard literals live
  // in the `ac250_not_loopback` predicate — the only place they may live.
  for (const lit of ["100.100.148.48", "127.0.0.1", "0.0.0.0", "localhost"]) {
    assert.ok(!body.includes(lit), `write_ac250_record must contain no address literal (${lit})`);
  }
  assert.ok(/ac250_not_loopback\s+"\$bind_host"/.test(body) || /ac250_not_loopback\s+"\$1"/.test(body),
    "the loopback refusal must be delegated to the predicate, so the body stays literal-free");
  // …and the step (where the readings are taken) has no address literal either.
  const step = stepBody();
  assert.ok(!step.includes("100.100.148.48"),
    "the step must not hardcode the target's tailscale0 address — it is read from `ip -4 addr show tailscale0`");
});

test("② the REAL criterion takes 0 / 1 / 3, and every filter can reject", () => {
  const py = criterionPython();

  // exit 3 — carrier absent is NOT-EVALUATED, distinct from both pass and fail (硬规则 3b).
  assert.equal(runCriterion(py, null).status, 3, "carrier absent ⇒ exit 3");

  // exit 0 — the qualifying shape.
  const ok = runCriterion(py, [goodRecord()]);
  assert.equal(ok.status, 0, `a qualifying record must pass:\n${ok.stderr}`);

  // exit 1 — a carrier that is present but holds no QUALIFYING record. Each impostor below breaks
  // EXACTLY one filter; `goodRecord()` with no override must be the only passing shape.
  const impostors = {
    "ac tag": { ac: "GOAL-016-AC-249" },
    "host equals this machine": { host: os.hostname() },
    // The criterion's `here` is ITS OWN cwd, so these two impostors must name paths under the
    // scratch workspace the judge runs in — otherwise they would be testing a different predicate.
    "project_root under the judge's own cwd": (ws) => ({ project_root: path.join(ws, "tasks") }),
    "project_root == the judge's own cwd": (ws) => ({ project_root: ws }),
    "bind_host empty": { bind_host: "" },
    "tailscale0_ip empty": { tailscale0_ip: "" },
    "bind_host != tailscale0_ip (the --host argument, not the observed listener)": { bind_host: "100.100.148.49" },
    "bind_host is loopback": { bind_host: "127.0.0.1", tailscale0_ip: "127.0.0.1" },
    "bind_host is the wildcard": { bind_host: "0.0.0.0", tailscale0_ip: "0.0.0.0" },
    "bind_host is ::": { bind_host: "::", tailscale0_ip: "::" },
    "bind_host is localhost": { bind_host: "localhost", tailscale0_ip: "localhost" },
    "probe_from_host empty (no cross-machine evidence)": { probe_from_host: "" },
    "probe_from_host == host (the target curled itself)": { probe_from_host: "instance-20221019-1509" },
    "http_status 404": { http_status: 404 },
    "http_status a non-numeric string": { http_status: "ok" },
    "http_status null": { http_status: null },
    "observed_task_id empty (empty shell page)": { observed_task_id: "" },
    "observed_status_before empty": { observed_status_before: "" },
    "observed_status_after empty": { observed_status_after: "" },
    "before == after (single-point render, the AC's own exclusion)": { observed_status_after: "todo", store_status_after: "todo" },
    "store_status_after disagrees with the page (stale cache)": { store_status_after: "done" },
    "store_status_after absent": { store_status_after: undefined },
    "store_status_after null": { store_status_after: null },
  };
  for (const [what, override] of Object.entries(impostors)) {
    const r = runCriterion(py, typeof override === "function"
      ? (ws) => [goodRecord(override(ws))]
      : [goodRecord(override)]);
    assert.equal(r.status, 1, `impostor must be rejected — ${what} (got exit ${r.status})`);
  }

  // The containment filter is a SEGMENT test, not a string-prefix test: a sibling directory whose
  // name merely begins with the cwd's characters is NOT inside it, so it must still qualify. Without
  // this the loop above would be satisfied by an over-broad `startswith(cwd)` impostor-killer.
  assert.equal(runCriterion(py, (ws) => [goodRecord({ project_root: ws + "x" })]).status, 0,
    "project_root ws+'x' is a sibling, not a child — must NOT be treated as inside the judge's repo");

  // …and a carrier that ALSO holds an older, non-qualifying record of this AC still passes when the
  // qualifying one is present (the criterion scans, it does not stop at the first match).
  assert.equal(runCriterion(py, [goodRecord({ bind_host: "127.0.0.1" }), goodRecord()]).status, 0,
    "a qualifying record anywhere in the carrier must be found");
});

test("③ the readings come from REAL rendered HTML / REAL `ss` text — the listen address is OBSERVED, not the argument", () => {
  const ssText = [
    "State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process",
    'LISTEN 0      128          0.0.0.0:22         0.0.0.0:*     users:(("sshd",pid=800,fd=3))',
    'LISTEN 0      511          127.0.0.1:4173     0.0.0.0:*     users:(("MainThread",pid=999,fd=22))',
  ].join("\n");
  const ssBound = ssText.replace("127.0.0.1:4173", "100.100.148.48:4173");

  // Feed the two texts through the REAL reader via env (avoids shell-escaping the newlines).
  const read = (text) =>
    spawnSync("bash", ["-c",
      'set -uo pipefail\nVC_NODE="${VC_NODE:-node}"\n' + sliceFn("ac250_listen_addr") +
      '\nac250_listen_addr "$AC250_SS_IN" "$AC250_PORT_IN"'],
      { encoding: "utf8", env: { ...process.env, AC250_SS_IN: text, AC250_PORT_IN: "4173" } }).stdout.trim();
  assert.equal(read(ssText), "127.0.0.1",
    "the reader must report the listener that ss actually shows (here: the loopback binding — the AC-234 shape)");
  assert.equal(read(ssBound), "100.100.148.48",
    "the reader must report the listener ss actually shows (here: the tailscale0 binding)");
  // The AC's own trap: had the producer taken `--host` as `bind_host`, the loopback run would have
  // "passed" while the page was unreachable from any other machine. Pin that the WRITER refuses the
  // argument-shaped value when it disagrees with the observed tailscale0 address.
  assert.equal(writeRecordViaProduct(
    ["target-B", "/home/other/archguard", "127.0.0.1", "100.100.148.48", "probe-A", "200", "T-1", "todo", "ready", "ready", ""]
  ).verdict, "REFUSED",
    "a bind_host taken from the --host argument (127.0.0.1) while tailscale0 is elsewhere must be refused");

  // …and the POSITIVE control for that very call, so the refusal above cannot be vacuous. Without it a
  // stale harness — one dependency the list in writeRecordViaProduct does not model ⇒ command-not-found
  // ⇒ non-zero ⇒ REFUSED for every input — leaves this test GREEN while it measures nothing. Measured
  // 2026-09-12 when the AC_RECORD_SCHEMA choke point landed: this was the only one of the three
  // record-writer fixtures that went vacuously green instead of red (硬规则 2: 零/恒一的配套动作是把
  // 谓词对着一个【已知为真】的样本干跑一次).
  const good = writeRecordViaProduct(
    ["target-B", "/home/other/archguard", "100.100.148.48", "100.100.148.48", "probe-A", "200", "T-1", "todo", "ready", "ready", ""]
  );
  assert.equal(good.verdict, "WROTE",
    "the same writer must ACCEPT the observed non-loopback listener — else every refusal above is vacuous");
  assert.equal(good.lines.length, 1, "…writing exactly one record");

  // The page reading is parsed out of REAL rendered row HTML, and the status cell may carry the
  // develop/disk divergence marker the renderer adds — the id and status must still parse.
  const html = [
    '<tr><th>id</th><th>status</th></tr>',
    '        <tr>',
    '        <td><a href="/task/AC250PROBE-1?from=%2Ftasks%3FpageSize%3D500">AC250PROBE-1</a></td>',
    '        <td>todo<span class="meta" data-divergence="status"> ⚠ disk:ready</span></td>',
    '        <td class="col-role">primitive</td>',
    '      </tr>',
    '        <tr>',
    '        <td><a href="/task/OTHER-2?from=%2Ftasks%3FpageSize%3D500">OTHER-2</a></td>',
    '        <td>done</td>',
    '        <td class="col-role">primitive</td>',
    '      </tr>',
  ].join("\n");
  const r3 = spawnSync("bash", ["-c",
    'set -uo pipefail\nVC_NODE="${VC_NODE:-node}"\n' + sliceFn("ac250_parse_rows") + sliceFn("ac250_lookup_row") +
    '\nac250_parse_rows "$HTML_IN" | sed "s/^/ROW[*]/"\n' +
    'AC250_TASK_ID_ARG="AC250PROBE-1"\n' +
    'ac250_lookup_row "$(ac250_parse_rows "$HTML_IN")" "$AC250_TASK_ID_ARG"\n' +
    'echo "LOOKUP=[$AC250_ROW_STATUS] RAW=[$AC250_ROW_RAW]"\n'],
    { encoding: "utf8", env: { ...process.env, HTML_IN: html } });
  assert.match(r3.stdout, /AC250PROBE-1\ttodo/,
    `the parser must read the id/status out of real rendered row HTML:\n${r3.stdout}\n${r3.stderr}`);
  assert.match(r3.stdout, /LOOKUP=\[todo\]/, "the same-task lookup must return the rendered status");
  assert.match(r3.stdout, /RAW=\[AC250PROBE-1\ttodo\]/,
    "the row原文 must be the SAME id as the one asked for — that is what makes the two readings a differential of ONE task");
  assert.doesNotMatch(r3.stdout, /disk:ready/, "the divergence marker must not leak into the status value");
});

test("④ the step distinguishes ok / no-change / not-evaluated — three values, none aliased", () => {
  const step = stepBody();
  assert.match(step, /AC250_OUTCOME="ok"/, "the qualifying value must be `ok`");
  assert.match(step, /AC250_OUTCOME="no-change"/,
    "「measured, nothing changed」 must have its OWN value — never folded into the qualifying one");
  assert.match(step, /AC250_OUTCOME="not-evaluated:/,
    "「could not measure」 must carry the `not-evaluated:` prefix (硬规则 3b)");
  // The three value sets must be disjoint by construction: `ok` and `no-change` are exact strings,
  // and every unreadable path names its own reason after the prefix.
  const reasons = [...step.matchAll(/AC250_OUTCOME="(not-evaluated:[a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(reasons.length >= 5,
    `each unreadable path must name its own reason (found ${reasons.length}: ${reasons.join(", ")})`);
  assert.equal(new Set(reasons).size, reasons.length, "the not-evaluated reasons must be distinct, not one alias");
  for (const r of reasons) assert.notEqual(r, "ok");
  // The step must actually CALL the readers (a step whose body merely mentions them measures nothing).
  for (const fn of ["ac250_read_target_identity", "ac250_resolve_target_tools", "ac250_fetch_page",
                    "ac250_read_store_status", "ac250_start_serve", "ac250_stop_serve"]) {
    assert.ok(step.includes(fn), `the step must call ${fn}`);
  }
  // …and it must never derive `bind_host` from the argument it passed to serve.
  assert.match(step, /AC250_BIND_HOST="\$\(ac250_listen_addr /,
    "bind_host must be read back from `ss -ltnp`, never taken from the --host argument (硬规则 4b)");
  assert.ok(/AC250_PROBE_FROM_HOST="\$\(hostname/.test(step),
    "probe_from_host must be THIS machine's hostname (the probe side), not the target's");
});
