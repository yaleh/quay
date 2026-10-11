#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/cross-machine-verify.ts
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { spawnSync as spawnSync2 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/git-runner.ts
import { spawnSync } from "node:child_process";
function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function ancestry(root, ancestor, descendant) {
  const r = git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/cross-machine-verify.ts
var MERGE_REF = "quay-cmv-merge";
var VERDICT_REF = "quay-cmv-verdict";
var PyFloat = class {
  value;
  constructor(value) {
    this.value = value;
  }
};
function pyStr(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "	") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 32 || c > 126) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}
function pyFloat(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`;
  const s = String(x);
  if (Math.abs(x) >= 1e-4 || /e/.test(s)) return s;
  const [mant, expPart] = x.toExponential().split("e");
  const e = Number(expPart);
  return `${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}
function numOf(v) {
  return v instanceof PyFloat ? v.value : typeof v === "number" ? v : Number.parseFloat(String(v));
}
function pyRound2(x) {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = hi >>> 20 & 2047;
  const frac = BigInt(hi & 1048575) << 32n | BigInt(lo);
  const m = expBits === 0 ? frac : frac | 1n << 52n;
  const e = expBits === 0 ? -1074 : expBits - 1075;
  if (m === 0n) return 0;
  const num = 25n * m;
  const sh = e + 2;
  let q;
  if (sh >= 0) {
    q = num << BigInt(sh);
  } else {
    const den = 1n << BigInt(-sh);
    const quo = num / den;
    const rem = num % den;
    const twice = rem * 2n;
    if (twice > den) q = quo + 1n;
    else if (twice < den) q = quo;
    else q = quo % 2n === 0n ? quo : quo + 1n;
  }
  const r = Number(q) / 100;
  return neg ? -r : r;
}
function jsonScalar(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return pyStr(v);
  if (v instanceof PyFloat) return pyFloat(v.value);
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 1e16 ? String(v) : pyFloat(v);
  return null;
}
function pyJsonCompact(v) {
  const scalar = jsonScalar(v);
  if (scalar !== null) return scalar;
  if (Array.isArray(v)) return "[" + v.map(pyJsonCompact).join(", ") + "]";
  return "{" + Object.entries(v).map(([k, x]) => `${pyStr(k)}: ${pyJsonCompact(x)}`).join(", ") + "}";
}
function pyJsonIndent(v, indent = 2) {
  const emit = (x, depth) => {
    const scalar = jsonScalar(x);
    if (scalar !== null) return scalar;
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    if (Array.isArray(x)) {
      if (x.length === 0) return "[]";
      return "[\n" + x.map((e) => pad + emit(e, depth + 1)).join(",\n") + "\n" + closePad + "]";
    }
    const entries = Object.entries(x);
    if (entries.length === 0) return "{}";
    return "{\n" + entries.map(([k, e]) => `${pad}${pyStr(k)}: ${emit(e, depth + 1)}`).join(",\n") + "\n" + closePad + "}";
  };
  return emit(v, 0);
}
function parseNotes(text) {
  const objs = [];
  let i = 0;
  while (i < text.length) {
    const j = text.indexOf("{", i);
    if (j === -1) break;
    let depth = 0;
    let found = false;
    for (let k = j; k < text.length; k++) {
      if (text[k] === "{") depth++;
      else if (text[k] === "}") {
        depth--;
        if (depth === 0) {
          try {
            objs.push(JSON.parse(text.slice(j, k + 1)));
          } catch {
          }
          i = k + 1;
          found = true;
          break;
        }
      }
    }
    if (!found) i = j + 1;
  }
  return objs;
}
function epoch(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.trunc(t / 1e3);
}
function hoursBetween(aIso, bIso) {
  return pyRound2((epoch(bIso) - epoch(aIso)) / 3600);
}
function field(o, key) {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    const v = o[key];
    if (typeof v === "string") return v;
  }
  return "";
}
function pyBool(v) {
  return v ? "True" : "False";
}
function pyNone(v) {
  return v === null || v === void 0 ? "None" : String(v);
}
var SELF = fileURLToPath2(import.meta.url);
var SCRIPT_DIR = path2.dirname(SELF);
var ENTRY_NAME = "cross-machine-verify.sh";
function usage() {
  process.stdout.write(
    `\u7528\u6CD5: bash ${ENTRY_NAME} [\u53C2\u6570\u2026] \u2014 \u8BE6\u89C1\u4E0B\u65B9\u811A\u672C\u5934\u90E8\u7528\u6CD5\u6CE8\u91CA\uFF08--help|-h \u4EC5\u6253\u5370\u7528\u6CD5\uFF0C\u65E0\u526F\u4F5C\u7528\uFF0C\u9000\u51FA 0\uFF09
`
  );
  try {
    for (const l of fs2.readFileSync(SELF, "utf8").split("\n").slice(0, 120)) {
      if (!l.startsWith("#")) continue;
      const stripped = l.replace(/^# ?/, "");
      if (stripped.startsWith("!")) continue;
      process.stdout.write(stripped + "\n");
    }
  } catch {
  }
  process.exit(0);
}
function parseArgv(argv, defaultRoot) {
  const o = {
    mode: "report",
    remote: "origin",
    branches: "develop integration",
    machine: os.hostname() || "unknown",
    json: false,
    noPush: false,
    gateCmd: "",
    repoRoot: defaultRoot,
    mergeShas: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => i + 1 < argv.length ? argv[++i] : "";
    if (a === "--record-merge") o.mode = "record-merge";
    else if (a === "--verify") o.mode = "verify";
    else if (a === "--report") o.mode = "report";
    else if (a === "--gate-run") o.mode = "gate";
    else if (a === "--gate") o.gateCmd = next();
    else if (a === "--root") o.repoRoot = next();
    else if (a === "--remote") o.remote = next();
    else if (a === "--branches" || a === "--branch") o.branches = next();
    else if (a === "--machine") o.machine = next();
    else if (a === "--no-push") o.noPush = true;
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") usage();
    else if (a.startsWith("-")) {
      process.stderr.write(`cross-machine-verify: unknown argument: ${a}
`);
      process.exit(2);
    } else o.mergeShas.push(a);
  }
  return o;
}
function gateNameOf(cmd) {
  let tok = "";
  for (const t of cmd.split(/\s+/)) if (/\.(sh|ts|mjs|tsx)$/.test(t)) tok = t;
  return tok ? path2.basename(tok) : "gate";
}
function main(argv, defaultRoot, out = process.stdout, err = process.stderr) {
  const o = parseArgv(argv, defaultRoot);
  const root = o.repoRoot;
  const branchList = o.branches.split(/\s+/).filter((b) => b.length > 0);
  const write = (s) => void out.write(s + "\n");
  if (o.remote === "") {
    err.write("cross-machine-verify: empty --remote\n");
    return 2;
  }
  if (o.branches === "") {
    err.write("cross-machine-verify: empty --branches\n");
    return 2;
  }
  if (spawnSync2("git", ["-C", root, "rev-parse", "--git-dir"], { stdio: "ignore" }).status !== 0) {
    err.write(`cross-machine-verify: not a git repo: ${root}
`);
    return 2;
  }
  for (const b of branchList) {
    const r = spawnSync2("git", ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${b}`], { stdio: "ignore" });
    if ((r.status ?? 1) !== 0) {
      err.write(`cross-machine-verify: local branch not found: ${b}
`);
      return 2;
    }
  }
  if (spawnSync2("git", ["-C", root, "remote", "get-url", o.remote], { stdio: "ignore" }).status !== 0) {
    err.write(`cross-machine-verify: remote not found: ${o.remote}
`);
    return 2;
  }
  const gitQuiet = (args) => {
    const r = spawnSync2("git", ["-C", root, ...args], { encoding: "utf8", timeout: 12e4 });
    return (r.stdout ?? "").replace(/\n+$/, "");
  };
  const gitOk = (args) => spawnSync2("git", ["-C", root, ...args], { stdio: "ignore", timeout: 12e4 }).status === 0;
  const nowIso = () => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const commitIso = (sha) => {
    const r = spawnSync2("git", ["-C", root, "show", "-s", "--format=%cI", sha], { encoding: "utf8", timeout: 12e4 });
    const v = (r.stdout ?? "").replace(/\n+$/, "");
    return r.status === 0 && v !== "" ? v : nowIso();
  };
  const noteShow = (ref, sha) => gitQuiet(["notes", `--ref=${ref}`, "show", sha]);
  const noteHas = (ref, sha) => gitQuiet(["notes", `--ref=${ref}`, "list"]).split("\n").some((l) => l.endsWith(` ${sha}`));
  const noteAdd = (ref, msg, sha) => void gitQuiet(["notes", `--ref=${ref}`, "add", "-m", msg, sha]);
  const noteAppend = (ref, msg, sha) => void gitQuiet(["notes", `--ref=${ref}`, "append", "-m", msg, sha]);
  const fetchNotes = () => void gitQuiet([
    "fetch",
    o.remote,
    `refs/notes/${MERGE_REF}:refs/notes/${MERGE_REF}`,
    `refs/notes/${VERDICT_REF}:refs/notes/${VERDICT_REF}`
  ]);
  const pushNotes = () => void gitQuiet([
    "push",
    o.remote,
    `refs/notes/${MERGE_REF}:refs/notes/${MERGE_REF}`,
    `refs/notes/${VERDICT_REF}:refs/notes/${VERDICT_REF}`
  ]);
  const execGate = () => {
    const cmd = o.gateCmd !== "" ? o.gateCmd : `bash ${SCRIPT_DIR}/laydown-set-check.sh --root ${root}`;
    const gate = gateNameOf(cmd);
    const r = spawnSync2("bash", ["-c", cmd], { cwd: root, encoding: "utf8", timeout: 6e5 });
    const text = (r.stdout ?? "") + (r.stderr ?? "");
    const rc = r.status !== null ? r.status : 143;
    const verdict = rc === 0 ? "green" : rc === 1 ? "red" : "error";
    const files = [];
    for (const line of text.split("\n")) {
      const isFailureContext = line.includes("\u2716") || line.includes("not ok") || line.toUpperCase().includes("FAIL") || line.toLowerCase().includes("error") || /\bat\s+[^ ]+\.(?:mjs|js|ts|sh)/.test(line);
      if (!isFailureContext) continue;
      for (const m of line.matchAll(/plugin\/[A-Za-z0-9_./-]+\.(?:test\.mjs|mjs|js|ts|sh)/g)) {
        if (!files.includes(m[0])) files.push(m[0]);
      }
    }
    return { verdict, gate, files, code: verdict === "green" ? 0 : verdict === "red" ? 1 : 2 };
  };
  const gateLine = (g) => `{"verdict":"${g.verdict}","gate":"${g.gate}","files":${pyJsonCompact(g.files)}}`;
  const isAncestor = (ancestor, descendant) => ancestry(root, ancestor, descendant) === true;
  const detectBranch = (sha) => {
    for (const b of branchList) if (isAncestor(sha, `refs/heads/${b}`)) return b;
    return branchList[0] ?? "";
  };
  const notedShas = () => gitQuiet(["notes", `--ref=${MERGE_REF}`, "list"]).split("\n").map((l) => l.split(/\s+/)[1]).filter((s) => !!s);
  const enumerateRecordedMerges = () => {
    if (!o.noPush) fetchNotes();
    const rows = [];
    for (const sha of notedShas()) {
      for (const br of branchList) {
        if (isAncestor(sha, `refs/heads/${br}`)) {
          rows.push({ sha, branch: br });
          break;
        }
      }
    }
    rows.sort((x, y) => x.sha < y.sha ? -1 : x.sha > y.sha ? 1 : 0);
    return rows;
  };
  const unattributedCommits = () => {
    const recorded = notedShas();
    if (recorded.length === 0) return [];
    let baseline = "";
    let baselineTs = "";
    for (const r of recorded) {
      const ts = commitIso(r);
      if (baselineTs === "" || epoch(ts) < epoch(baselineTs)) {
        baseline = r;
        baselineTs = ts;
      }
    }
    if (baseline === "") return [];
    const rows = [];
    for (const br of branchList) {
      if (gitQuiet(["rev-parse", `refs/heads/${br}`]) === "") continue;
      for (const c of gitQuiet(["log", br, "--format=%H", "-n", "300"]).split("\n")) {
        if (c === "" || noteHas(MERGE_REF, c)) continue;
        if (isAncestor(baseline, c)) rows.push({ sha: c.slice(0, 12), branch: br });
      }
    }
    return rows;
  };
  const mergeStatus = (sha, br) => {
    const mergeNote = parseNotes(noteShow(MERGE_REF, sha)).pop();
    const merger = field(mergeNote, "merger_machine") || "unknown";
    let mergedAt = field(mergeNote, "at");
    if (mergedAt === "") mergedAt = commitIso(sha);
    const vline = parseNotes(noteShow(VERDICT_REF, sha)).pop();
    let verified = false;
    let verdict = null;
    let verifier = null;
    let verdictAt = null;
    let vlat = 0;
    if (vline !== void 0) {
      const vv = field(vline, "verdict");
      const vvm = field(vline, "verifier_machine");
      const vat = field(vline, "at");
      if (vvm !== "" && vvm !== merger) {
        verified = true;
        verdict = vv === "null" ? null : vv;
        verifier = vvm;
        verdictAt = vat;
        vlat = hoursBetween(mergedAt, vat);
      }
    }
    const waitH = verified ? vlat : hoursBetween(mergedAt, nowIso());
    const obj = {
      sha,
      branch: br,
      merger_machine: merger,
      merged_at: mergedAt,
      verified,
      verdict,
      verifier_machine: verifier,
      verdict_at: verdictAt,
      wait_h: new PyFloat(waitH),
      post_merge_latency_h: new PyFloat(waitH)
    };
    return { obj, text: pyJsonCompact(obj) };
  };
  const modeRecordMerge = () => {
    if (o.mergeShas.length === 0) {
      err.write("cross-machine-verify: --record-merge requires at least one <sha> (the merges this machine just landed)\n");
      return 2;
    }
    if (!o.noPush) fetchNotes();
    const now = nowIso();
    let recorded = 0;
    let skipped = 0;
    let missing = 0;
    for (const sha of o.mergeShas) {
      if (!gitOk(["cat-file", "-e", `${sha}^{commit}`])) {
        err.write(`cross-machine-verify: not a commit: ${sha}
`);
        missing++;
        continue;
      }
      if (noteHas(MERGE_REF, sha)) {
        skipped++;
        continue;
      }
      const br = detectBranch(sha);
      const ctime = commitIso(sha);
      noteAdd(
        MERGE_REF,
        `{"type":"merge","sha":"${sha}","branch":"${br}","merger_machine":"${o.machine}","at":"${ctime}","recorded_at":"${now}"}`,
        sha
      );
      write(`recorded merge: ${sha.slice(0, 12)} branch=${br} merger_machine=${o.machine} at=${ctime}`);
      recorded++;
    }
    if (!o.noPush) pushNotes();
    write(`cross-machine-verify: record-merge done (recorded ${recorded} / skipped ${skipped} / missing ${missing})`);
    return 0;
  };
  const modeVerify = () => {
    let verified = 0;
    let skippedParticipant = 0;
    let skippedUnattributed = 0;
    let skippedDone = 0;
    let reds = 0;
    let errors = 0;
    for (const { sha, branch: br } of enumerateRecordedMerges()) {
      const mergeNoteText = noteShow(MERGE_REF, sha);
      const merger = field(parseNotes(mergeNoteText).pop(), "merger_machine") || "unknown";
      if (merger === "unknown") {
        write(`verify: skip ${sha.slice(0, 12)} \u2014 unattributed merge (no merger identity); fail-closed, NOT verified`);
        skippedUnattributed++;
        continue;
      }
      if (merger === o.machine) {
        write(`verify: skip ${sha.slice(0, 12)} \u2014 this machine (${o.machine}) IS the merger; a parent cannot verify its own merge (AC4)`);
        skippedParticipant++;
        continue;
      }
      const already = parseNotes(noteShow(VERDICT_REF, sha)).some((v) => {
        const vm = field(v, "verifier_machine");
        return vm !== "" && vm !== merger;
      });
      if (already) {
        skippedDone++;
        continue;
      }
      const now = nowIso();
      write(`verify: verifying ${sha.slice(0, 12)} (merger=${merger}, verifier=${o.machine}) \u2014 running fast gate...`);
      const g = execGate();
      let mergedAt = field(parseNotes(mergeNoteText).pop(), "at");
      if (mergedAt === "") mergedAt = commitIso(sha);
      noteAppend(
        VERDICT_REF,
        `{"type":"verdict","verifier_machine":"${o.machine}","at":"${now}","verdict":"${g.verdict}","gate":"${g.gate}","files":${pyJsonCompact(g.files)}}`,
        sha
      );
      const lat = hoursBetween(mergedAt, now);
      if (g.verdict === "red") {
        reds++;
        write(`verify: ${sha.slice(0, 12)} verdict=RED post_merge_latency_h=${lat} files=${pyJsonCompact(g.files)} \u2014 DETECTED by cross-machine gate`);
      } else if (g.verdict === "green") {
        verified++;
        write(`verify: ${sha.slice(0, 12)} verdict=green post_merge_latency_h=${lat}`);
      } else {
        errors++;
        write(`verify: ${sha.slice(0, 12)} gate error \u2014 verdict not recorded (verdict=error)`);
      }
    }
    for (const { sha, branch: br } of unattributedCommits()) {
      write(`verify: skip ${sha} ${br} \u2014 unattributed merge (no merger identity); fail-closed, NOT verified`);
      skippedUnattributed++;
    }
    if (!o.noPush) pushNotes();
    write(
      `cross-machine-verify: verify done (green ${verified} / red ${reds} / gate-error ${errors} / skipped-participant ${skippedParticipant} / skipped-unattributed ${skippedUnattributed} / already-verified ${skippedDone})`
    );
    return reds === 0 ? 0 : 1;
  };
  const modeReport = () => {
    const rows = [];
    let nUnverified = 0;
    let nVerified = 0;
    let newestPending = "";
    let newestPendingWait = "0";
    for (const { sha, branch: br } of enumerateRecordedMerges()) {
      const st = mergeStatus(sha, br);
      rows.push({ sha, obj: st.obj, text: st.text });
      if (st.obj.verified === true) {
        nVerified++;
      } else {
        nUnverified++;
        const w = pyFloat(st.obj.wait_h instanceof PyFloat ? st.obj.wait_h.value : Number(st.obj.wait_h));
        if (Number.parseFloat(w) > Number.parseFloat(newestPendingWait)) {
          newestPending = sha;
          newestPendingWait = w;
        }
        if (newestPending === "") {
          newestPending = sha;
          newestPendingWait = w;
        }
      }
    }
    let top = null;
    if (newestPending !== "") {
      top = mergeStatus(newestPending, branchList[0] ?? "").obj;
    } else {
      const last = rows[rows.length - 1];
      if (last && last.obj.verified === true) top = last.obj;
    }
    let topMerger = "null";
    let topVerifier = "null";
    let topLat = "0";
    if (top) {
      topMerger = pyJsonCompact(top.merger_machine);
      topVerifier = top.verifier_machine ? pyJsonCompact(top.verifier_machine) : "null";
      topLat = pyFloat(numOf(top.post_merge_latency_h));
    }
    let verifierIsParticipant = 0;
    if (topVerifier !== "null" && topMerger !== "null") {
      if (topMerger.replace(/"/g, "") === topVerifier.replace(/"/g, "")) verifierIsParticipant = 1;
    }
    let postLat = topLat || "0";
    if (newestPending !== "") postLat = newestPendingWait;
    const unattr = unattributedCommits();
    const unattrCount = unattr.length;
    if (o.json) {
      const doc = {
        verifier_machine: topVerifier === "null" ? null : JSON.parse(topVerifier),
        merger_machine: topMerger === "null" ? null : JSON.parse(topMerger),
        verifier_is_participant: verifierIsParticipant,
        post_merge_latency_h: new PyFloat(Number.parseFloat(postLat)),
        unverified_merges: nUnverified,
        verified_merges: nVerified,
        unattributed_commits: unattrCount,
        merges: rows.map((r) => r.obj),
        notes_refs: [`refs/notes/${MERGE_REF}`, `refs/notes/${VERDICT_REF}`],
        machine: o.machine
      };
      out.write(pyJsonIndent(doc) + "\n");
    } else {
      write(`cross-machine-verify: report (machine=${o.machine})`);
      write(`  verifier_machine: ${topVerifier.replace(/"/g, "")}`);
      write(`  merger_machine: ${topMerger.replace(/"/g, "")}`);
      write(`  verifier_is_participant: ${verifierIsParticipant}  (band 0)`);
      write(`  post_merge_latency_h: ${postLat}  (band 0..1)`);
      write(`  unverified_merges: ${nUnverified} / verified_merges: ${nVerified} / unattributed_commits: ${unattrCount}`);
      if (nUnverified > 0 || unattrCount > 0) {
        write("  UNVERIFIED \u2014 the detection latency d for each pending merge is its wait_h (this is the failure surface):");
      } else {
        write("  all recorded merges cross-machine verified");
      }
      for (const r of rows) {
        const a = r.obj;
        write(
          `  ${String(a.sha).slice(0, 12)} ${a.branch} merger=${a.merger_machine} verified=${pyBool(a.verified)} verdict=${pyNone(a.verdict)} verifier=${pyNone(a.verifier_machine)} wait_h=${pyFloat(numOf(a.wait_h))}`
        );
      }
      if (unattrCount > 0) {
        write("  unattributed commits (landed but NOT recorded by a merger \u2014 cannot prove non-participation, NOT verified):");
        for (const { sha, branch: br } of unattr) write(`    ${sha} ${br}`);
      }
    }
    return nUnverified === 0 && unattrCount === 0 ? 0 : 1;
  };
  switch (o.mode) {
    case "record-merge":
      return modeRecordMerge();
    case "verify":
      return modeVerify();
    case "gate": {
      const g = execGate();
      out.write(gateLine(g) + "\n");
      return g.code;
    }
    case "report":
      return modeReport();
    default:
      err.write(`cross-machine-verify: unknown mode ${o.mode}
`);
      return 2;
  }
}
if (process.argv[1] && path2.resolve(process.argv[1]) === SELF) {
  process.exit(main(process.argv.slice(2), repoRoot()));
}
export {
  PyFloat,
  epoch,
  gateNameOf,
  hoursBetween,
  main,
  numOf,
  parseArgv,
  parseNotes,
  pyFloat,
  pyJsonCompact,
  pyJsonIndent,
  pyRound2,
  pyStr
};
