// observation-split-analysis.mjs — read-only static analysis helper for observation-split.md.
// Usage: node docs/rup/observation-split-analysis.mjs <counts|edges|state|refs <name>|consumers>
// Reads packages/quay/src/observation.ts from the main checkout (read-only). The installed
// `typescript` is v7 (native, no JS AST API), so this uses a small LEXER: comments, string literals
// and template-literal text are blanked (only `${...}` expressions survive) before identifiers are
// matched, and an identifier preceded by `.` (property access) is skipped. => mentions in comments
// or strings never count (hard rule 2). Known approximations: a local variable that shadows a
// top-level name counts as a reference; object-literal keys equal to a top-level name count.
import fs from "node:fs";
import path from "node:path";

const SRC = "/data/home/yale/work/quay/packages/quay/src";
const file = path.join(SRC, "observation.ts");
const src = fs.readFileSync(file, "utf8");
const lines = src.split("\n");

export const sections = [
  ["S0 shared", 1, 77], ["S1 telemetry/activity", 78, 441], ["S2 blocking", 442, 624], ["S3 worker-carriers", 625, 1414],
  ["S4 promo-outcome", 1415, 1460], ["S5 task-at-ref", 1461, 1888], ["S6 readLive", 1889, 2160], ["S7 journal", 2161, 2400],
  ["S8 landing/exec", 2401, 2707], ["S9 git-history", 2708, 2958], ["S10a script-runner", 2959, 3042], ["S10b system", 3043, 3180], ["S11 manager", 3181, 3650],
  ["S12 tests", 3651, 4056], ["S13 sessions", 4057, 4645], ["S14 arch+branch", 4646, 4760]];
const OVERRIDE = { JournalSection: "S7 journal", JournalResult: "S7 journal", ObservationStatus: "S0 shared", jsonNum: "S0 shared" };
const secOf = (l, name) => { if (name && OVERRIDE[name]) return OVERRIDE[name]; for (const s of sections) if (l >= s[1] && l <= s[2]) return s[0]; return "?"; };

// ---- lexer: blank comments/strings, keep ${} expressions; returns code text same length -----------
function blank(text) {
  let out = "", i = 0, prevSig = "";
  const n = text.length;
  const stack = []; // template nesting: brace depth markers
  let braceDepth = 0;
  const isRegexStart = () => prevSig === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prevSig) || prevSig === "return";
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "/" && d === "/") { while (i < n && text[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") { while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { out += text[i] === "\n" ? "\n" : " "; i++; } out += "  "; i += 2; continue; }
    if (c === "'" || c === '"') {
      out += " "; i++;
      while (i < n && text[i] !== c) { if (text[i] === "\\") { out += "  "; i += 2; continue; } out += text[i] === "\n" ? "\n" : " "; i++; }
      out += " "; i++; prevSig = "x"; continue;
    }
    if (c === "`" || (c === "}" && stack.length && stack[stack.length - 1] === braceDepth)) {
      // inside template text until ` or ${
      if (c === "}") { stack.pop(); braceDepth--; }
      out += " "; i++;
      while (i < n) {
        if (text[i] === "\\") { out += "  "; i += 2; continue; }
        if (text[i] === "`") { out += " "; i++; prevSig = "x"; break; }
        if (text[i] === "$" && text[i + 1] === "{") { out += "  "; i += 2; braceDepth++; stack.push(braceDepth); prevSig = "{"; break; }
        out += text[i] === "\n" ? "\n" : " "; i++;
      }
      continue;
    }
    if (c === "/" && isRegexStart()) {
      out += " "; i++; let inClass = false;
      while (i < n) {
        const ch = text[i];
        if (ch === "\\") { out += "  "; i += 2; continue; }
        if (ch === "[") inClass = true; else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        else if (ch === "\n") break;
        out += " "; i++;
      }
      out += " "; i++; while (i < n && /[a-z]/.test(text[i])) { out += " "; i++; }
      prevSig = "x"; continue;
    }
    if (c === "{") braceDepth++;
    if (c === "}") braceDepth--;
    if (!/\s/.test(c)) prevSig = c;
    out += c; i++;
  }
  return out;
}

const DECL = /^(export\s+)?(?:(async)\s+)?(?:(function)\s*\*?\s+|(const|let|var)\s+|(interface|type|class)\s+)([A-Za-z_$][\w$]*)/;
const decls = []; // {name, kind, exported, line}
lines.forEach((l, idx) => {
  const m = DECL.exec(l);
  if (m && !/^\s/.test(l)) decls.push({ name: m[6], kind: m[3] ? "function" : m[4] ?? m[5], exported: !!m[1], line: idx + 1 });
});
decls.forEach((d, i) => { d.end = (decls[i + 1]?.line ?? lines.length + 1) - 1; d.sec = secOf(d.line, d.name); });
const byName = new Map(decls.map((d) => [d.name, d]));
const codeLines = blank(src).split("\n");
const symRefs = new Map();
for (const d of decls) {
  const body = codeLines.slice(d.line - 1, d.end).join("\n");
  const seen = new Set();
  for (const m of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
    const id = m[1];
    if (id !== d.name && byName.has(id)) seen.add(id);
  }
  symRefs.set(d.name, seen);
}

const mode = process.argv[2];
if (mode === "counts") {
  const cnt = {};
  for (const d of decls) {
    const c = (cnt[d.sec] ??= { fn: 0, fnExp: 0, iface: 0, ifaceExp: 0, type: 0, typeExp: 0, const: 0, constExp: 0, let: 0 });
    if (d.kind === "function") { c.fn++; if (d.exported) c.fnExp++; }
    else if (d.kind === "interface") { c.iface++; if (d.exported) c.ifaceExp++; }
    else if (d.kind === "type") { c.type++; if (d.exported) c.typeExp++; }
    else if (d.kind === "let") c.let++;
    else { c.const++; if (d.exported) c.constExp++; }
  }
  const T = {};
  for (const s of sections) {
    const c = cnt[s[0]] || {};
    console.log(s[0].padEnd(24), `${s[1]}-${s[2]}`.padEnd(10), `${s[2] - s[1] + 1}L`.padEnd(6), JSON.stringify(c));
    for (const k in c) T[k] = (T[k] || 0) + c[k];
  }
  console.log("TOTAL decls", decls.length, JSON.stringify(T));
}
if (mode === "edges") {
  const edges = new Map();
  for (const [name, seen] of symRefs) {
    const from = byName.get(name).sec;
    for (const t of seen) {
      const to = byName.get(t).sec;
      if (to === from) continue;
      const k = `${from} -> ${to}`;
      if (!edges.has(k)) edges.set(k, new Set());
      edges.get(k).add(`${name}>${t}`);
    }
  }
  for (const [k, v] of [...edges].sort()) console.log(k, v.size, [...v].slice(0, 3).join(", "));
}
if (mode === "state") {
  for (const d of decls) if (d.kind === "let" || (d.kind === "const" && /Cache\b|Warned|Promise$/.test(d.name) && !/_TTL|MS$/.test(d.name))) console.log(d.name, d.kind, d.line, d.sec);
}
if (mode === "refs") {
  const x = process.argv[3];
  for (const [n, seen] of symRefs) if (seen.has(x)) console.log(n, byName.get(n).sec, byName.get(n).line);
}
if (mode === "dump") {
  for (const d of decls) console.log(d.line, d.end, d.sec, d.kind, d.exported ? "export" : "local", d.name);
}
if (mode === "consumers" || mode === "usage") {
  // for every .ts/.mjs/.js file under packages/ and plugin/, tests/ etc: find import statements from observation(.ts|.js)
  const roots = ["/data/home/yale/work/quay/packages", "/data/home/yale/work/quay/plugin", "/data/home/yale/work/quay/scripts", "/data/home/yale/work/quay/experiments"];
  const out = [];
  const walk = (dir) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mts|mjs|js|cjs)$/.test(e.name) && p !== file) {
        const t = fs.readFileSync(p, "utf8");
        if (!t.includes("observation")) continue;
        const cl = blank(t); // positions: only real import/export/dynamic-import code remains
        const re = /(?:import|export)\s*(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:from)?\s*[\s\S]{0,3}?(?=\s*;?\s*$)/gm;
        // string literals are blanked in cl, so locate import statements by regex on the ORIGINAL text but
        // require the statement start to be real code (cl has the keyword at the same offset).
        const imp = /(?:^|\n)\s*(import|export)\s+(type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|[\w$]+)?\s*(?:,\s*\{[^}]*\})?\s*(?:from\s*)?(["'])([^"']*observation(?:\.[a-z]+)?)\4/g;
        for (const m of t.matchAll(imp)) {
          const off = m.index + m[0].indexOf(m[1]);
          if (cl.slice(off, off + m[1].length) !== m[1]) continue; // keyword was inside a comment/string
          const rawSpec = m[5];
          if (!/(^|\/)observation(\.[a-z]+)?$/.test(rawSpec)) continue;
          out.push({ file: p, kind: m[1], typeOnly: !!m[2], names: m[3] ?? "", spec: rawSpec });
        }
        // dynamic import("./observation.ts")
        for (const m of t.matchAll(/import\(\s*(["'])([^"']*observation(?:\.[a-z]+)?)\1\s*\)/g)) {
          out.push({ file: p, kind: "dynamic", typeOnly: false, names: "(dynamic)", spec: m[2] });
        }
      }
    }
  };
  roots.forEach(walk);
  if (mode === "usage") {
    // per exported symbol: section, kind, non-test src consumers (basenames), test-file count, dynamic-import test files
    const dyn = out.filter((r) => r.kind === "dynamic").map((r) => r.file);
    const isTest = (f) => /\/test\/|\.test\./.test(f);
    for (const d of decls.filter((x) => x.exported)) {
      const src_ = new Set(), tst = new Set();
      for (const r of out) {
        const names = r.names.replace(/[{}]/g, "").split(",").map((x) => x.trim().replace(/^type\s+/, "").replace(/\s+as\s+\w+$/, ""));
        if (names.includes(d.name)) (isTest(r.file) ? tst : src_).add(path.basename(r.file));
      }
      // intra-file use (referenced by another top-level symbol of observation.ts)
      let internal = 0; for (const [n, seen] of symRefs) if (seen.has(d.name)) internal++;
      console.log([d.sec.split(" ")[0], d.kind, d.name, `src=${[...src_].join("+") || "-"}`, `tests=${tst.size}`, `internalRefs=${internal}`].join("\t"));
    }
    console.log("# dynamic-import test files:", dyn.map((f) => path.basename(f)).join(", "));
  } else if (process.argv[3] === "json") { console.log(JSON.stringify(out, null, 1)); }
  else {
    // report: one line per (file, statement): relative file | typeOnly | specifier | names
    for (const r of out) {
      const names = r.names.replace(/[{}]/g, "").split(",").map((x) => x.trim().replace(/^type\s+/, "").replace(/\s+as\s+\w+$/, "")).filter(Boolean);
      console.log(`${r.file.replace("/data/home/yale/work/quay/", "")} | ${r.kind}${r.typeOnly ? " type" : ""} | ${r.spec} | ${names.join(",")}`);
    }
  }
}
if (mode === "intra") {
  const pre = process.argv[3];
  for (const [n, seen] of symRefs) {
    const d = byName.get(n);
    if (!d.sec.startsWith(pre)) continue;
    const t = [...seen].filter((x) => byName.get(x).sec.startsWith(pre) && byName.get(x).kind !== "interface" && byName.get(x).kind !== "type");
    if (t.length) console.log(`${d.line} ${n} -> ${t.join(", ")}`);
  }
}

// ---- stateRefs: for every module-level mutable binding (let / *Cache / *Warned / *Promise), which sections reference it
if (mode === "stateRefs") {
  for (const d of decls) {
    if (!(d.kind === "let" || (d.kind === "const" && /Cache$|Warned$|Promise$/.test(d.name)))) continue;
    const secs = new Set(); const who = [];
    for (const [n, seen] of symRefs) if (seen.has(d.name)) { secs.add(byName.get(n).sec.split(" ")[0]); who.push(n); }
    console.log(d.name.padEnd(28), `def=${d.sec.split(" ")[0]}`, `refSections=${[...secs].join(",")}`, `n=${who.length}`);
  }
}
// ---- purity classification (by position, on blanked code): direct effect tokens, then transitive closure over the call graph.
// effect classes: io (fs./readFileSync/...), proc (execFile*/spawn/readProcCmdlineText), clock (Date.now/new Date()), state (touches a module-level let/cache/Set), dyn (import()).
if (mode === "purity") {
  const tok = { proc: /\b(execFileSync|execFileP|execFile|spawn)\s*\(|\breadProcCmdlineText\s*\(/, io: /\bfs\.|\bfs\s*$|\breadFileSync\b|\bos\.homedir\b|process\.stderr/, clock: /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/, dyn: /\bimport\s*\(/ };
  const stateNames = new Set(decls.filter((d) => d.kind === "let" || (d.kind === "const" && /Cache$|Warned$/.test(d.name))).map((d) => d.name));
  const direct = new Map();
  for (const d of decls) {
    if (d.kind !== "function" && !(d.kind === "const" && /=\s*\(/.test(lines[d.line - 1]))) continue;
    const body = codeLines.slice(d.line - 1, d.end).join("\n");
    const e = new Set();
    for (const [k, re] of Object.entries(tok)) if (re.test(body)) e.add(k);
    for (const s of stateNames) if (new RegExp(`(?<![.\\w$])${s}(?![\\w$])`).test(body)) e.add("state");
    direct.set(d.name, e);
  }
  const eff = new Map();
  const visit = (n, stack = new Set()) => {
    if (eff.has(n)) return eff.get(n);
    if (stack.has(n)) return new Set();
    stack.add(n);
    const e = new Set(direct.get(n) ?? []);
    for (const t of symRefs.get(n) ?? []) if (direct.has(t)) for (const x of visit(t, stack)) e.add(x);
    stack.delete(n);
    eff.set(n, e);
    return e;
  };
  const tally = {};
  for (const d of decls) {
    if (!direct.has(d.name)) continue;
    const e = visit(d.name);
    const key = e.size === 0 ? "pure" : [...e].sort().join("+");
    (tally[d.sec] ??= {})[key] = (tally[d.sec][key] ?? 0) + 1;
    if (process.argv[3] === "list") console.log(d.sec.split(" ")[0], d.name, key, d.exported ? "export" : "local");
  }
  if (process.argv[3] !== "list") for (const [s, t] of Object.entries(tally)) console.log(s.padEnd(22), JSON.stringify(t));
}
// ---- proposal check: assign every top-level symbol to a PROPOSED module, then compute the module graph,
// ---- SCCs (value-only graph and value+type graph), per-module size/exports/state. Mode: proposal [edges]
if (mode === "proposal") {
  const BASE = new Set(["ObservationStatus", "jsonNum", "SESSION_ID_RE", "isValidSessionId", "projectSlug", "sessionTranscriptPath", "ORCHESTRATION_DIR", "TICK_LOG_FILE", "execFileP", "scriptBasename"]);
  const EXEC = new Set(["runScriptBounded", "runPluginScript"]);
  const LIVE_TYPES = new Set(["InFlightTask", "InFlightPhase", "SuiteStateView", "RunLiveness", "LiveState", "ActivitySignals", "LiveResult"]);
  const RUN_LIVENESS = new Set(["runProcessAliveSync", "classifyRunLiveness", "isRunProcessAlive", "worktreeFallbackWarned", "resetWorktreeFallbackWarnings", "taskWorktreeOpen", "warnWorktreeFallback"]);
  const BOARD_EXTRA = new Set(["TASK_STATUS_DRIFT_CHECK_REL", "TASK_STATUS_DRIFT_CHECK_NAME", "IN_FLIGHT_TIMEOUT_MINUTES"]);
  const OUTCOMES = new Set(["MechanicalFanInRecord", "WorkerOutcomeRecord", "ParsedWorkerOutcomes", "parseMechanicalFanIn", "parseWorkerOutcomeRecordsDetailed", "parseWorkerOutcomeRecords",
    "CarrierTextStatus", "CarrierText", "readCarrierText", "readWorkerOutcomeText", "readWorkerOutcomeRecords", "FanInAttempt", "FanInAttemptsStatus", "FanInAttemptsResult", "fanInAttemptFromRecord",
    "readFanInAttempts", "WORKER_OUTCOME_REL"]);
  const JOURNAL = new Set(["ESCALATIONS_FILE", "GIT_LOG_LIMIT", "JOURNAL_ESCALATION_SECTIONS", "JOURNAL_TICK_SECTIONS", "ESCALATIONS_STALE_DAYS"]);
  const SECMOD = { S0: "live", S1: "live", S2: "blocking", S3: "worker-runtime", S4: "outcomes", S5: "task-at-ref", S6: "live", S7: "journal", S8: "board",
    S9: "repo", S10a: "exec", S10b: "system", S11: "system", S12: "tests", S13: "sessions", S14: "repo" };
  const modOf = (d) => {
    const n = d.name;
    if (BASE.has(n)) return "base";
    if (EXEC.has(n)) return "exec";
    // NEGATIVE CONTROL: NO_LIVE_TYPES=1 leaves the live types inside `live` => a value+type SCC must appear.
    if (LIVE_TYPES.has(n)) return process.env.NO_LIVE_TYPES ? "live" : "live-types";
    if (RUN_LIVENESS.has(n)) return "run-liveness";
    if (BOARD_EXTRA.has(n)) return "board";
    if (OUTCOMES.has(n)) return "outcomes";
    if (JOURNAL.has(n)) return "journal";
    return SECMOD[d.sec.split(" ")[0]];
  };
  const mod = new Map(decls.map((d) => [d.name, modOf(d)]));
  const kindOf = (n) => byName.get(n).kind;
  const vEdges = new Map(), aEdges = new Map();
  const detail = new Map();
  const add = (m, a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
  for (const [name, seen] of symRefs) {
    const from = mod.get(name);
    for (const t of seen) {
      const to = mod.get(t);
      if (from === to) continue;
      const isType = kindOf(t) === "interface" || kindOf(t) === "type";
      add(aEdges, from, to);
      if (!isType) add(vEdges, from, to);
      const k = `${from}->${to}${isType ? " (type)" : ""}`;
      if (!detail.has(k)) detail.set(k, new Set());
      detail.get(k).add(`${name}>${t}`);
    }
  }
  const mods = [...new Set(mod.values())].sort();
  const scc = (g) => {
    let idx = 0; const st = [], on = new Set(), id = new Map(), low = new Map(), out = [];
    const strong = (v) => {
      id.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
      for (const w of g.get(v) ?? []) {
        if (!id.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), id.get(w)));
      }
      if (low.get(v) === id.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) out.push(c); }
    };
    for (const v of mods) if (!id.has(v)) strong(v);
    return out;
  };
  if (process.argv[3] === "map") { for (const d of decls) if (d.exported) console.log(`${d.name}\t${mod.get(d.name)}`); process.exit(0); }
  console.log("modules:", mods.length);
  for (const m of mods) {
    const ds = decls.filter((d) => mod.get(d.name) === m);
    const lines_ = ds.reduce((a, d) => a + (d.end - d.line + 1), 0);
    const exp = ds.filter((d) => d.exported).length;
    const st = ds.filter((d) => d.kind === "let" || /Cache$|Warned$|Promise$/.test(d.name)).map((d) => d.name);
    console.log(m.padEnd(14), `~${lines_}L(decl ranges incl. comments)`, `decls=${ds.length}`, `exports=${exp}`, `out=${[...(aEdges.get(m) ?? [])].sort().join(",") || "-"}`, st.length ? `state=${st.join("|")}` : "");
  }
  const needExport = new Set();
  for (const [name, seen] of symRefs) for (const t of seen) if (mod.get(name) !== mod.get(t) && !byName.get(t).exported) needExport.add(`${t}(${mod.get(t)})`);
  console.log("non-exported symbols that would need `export` (cross-module refs):", needExport.size, [...needExport].sort().join(", "));
  console.log("value-graph SCCs (>1 node):", JSON.stringify(scc(vEdges)));
  console.log("value+type-graph SCCs (>1 node):", JSON.stringify(scc(aEdges)));
  if (process.argv[3] === "edges") for (const [k, v] of [...detail].sort()) console.log(k, v.size, [...v].slice(0, 3).join(", "));
}
// ---- negative control for the proposal check: put the types back into `live` (no live-types) => expect a type SCC
if (mode === "proposal-neg") {
  console.log("negative control: run `proposal`, then in the script move LIVE_TYPES members to module `live` and re-run — a value+type SCC {live, worker-runtime|blocking|run-liveness} must appear.");
}
