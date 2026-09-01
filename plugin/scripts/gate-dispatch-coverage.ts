// gate-dispatch-coverage.ts — gap-gate-registration-vs-dispatch-unmeasured: a REPORT (not a gate,
// not a judge) that measures which gates registered in `.quay/config.yml`'s `gates:` section are
// actually referenced across 4 static dispatch surfaces, which are not, and which scripts are
// dispatched without being registered. Output is a table for human reading; `--json` emits the
// AC7 machine shape. CONSTANT EXIT 0 (AC8) and ZERO WRITES (AC9) — this module only reads.
//
// Byte-identical mirror: experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts
// (symlink → ../../../plugin/scripts/gate-dispatch-coverage.ts).
//
// Dispatch surfaces scanned (AC3):
//   1. .claude/workflows/*.js  +  plugin/workflows/*.js   (Gate + other phase shell calls)
//   2. experiments/quay-perpetual-stream/scripts/it0-dod-check.ts  (clause shell-outs)
//   3. .github/workflows/*.yml (.yaml)                     (CI jobs)
//   4. experiments/quay-perpetual-stream/OUTER-LOOP.md
//
// Run:
//   node --experimental-strip-types plugin/scripts/gate-dispatch-coverage.ts [--root <dir>] [--json]
//   node --experimental-strip-types experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts ...
//
// The tool NEVER writes and NEVER exits non-zero. A missing config or missing surface is a REPORTED
// fact (empty registered set / empty surface list), not an error — the report is the deliverable.
//
// `--json` shape (AC7, with the AC6 `mismatches` array added):
//   { registered: [{ name, script, dispatchedBy: [{ file, line, via }] }],
//     undispatched: [{ name, script }],
//     unregistered: [{ script, dispatchedBy: [{ file, line, via }] }],
//     mismatches:   [{ gate, registeredScript, liveScript, refs, kind }] }

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Workspace-root discovery ─────────────────────────────────────────────────────────────────────────


// ── Config parsing (.quay/config.yml `gates:` section) ────────────────────────────────────────────────

/** Index of the closing `quote` starting the scan at `start`, skipping `\quote` escapes; -1 if none. */
function findClosingQuote(s, quote, start) {
  for (let i = start; i < s.length; i++) {
    if (s[i] !== quote) continue;
    let bs = 0;
    for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) bs++;
    if (bs % 2 === 0) return i; // not escaped → real closing quote
  }
  return -1;
}

/**
 * Strip surrounding quotes and inline ` # ...` comments from a YAML scalar.
 *
 * A quoted scalar's VALUE ends at its closing quote (found by skipping `\"` escapes); anything after
 * the closing quote is a trailing `# comment` and is dropped. A `#` INSIDE the quotes is data and is
 * preserved. Unquoted scalars strip the inline ` # ...` comment directly.
 */
export function cleanScalar(v) {
  let s = String(v ?? "").trim();
  if (s.startsWith('"')) {
    const close = findClosingQuote(s, '"', 1);
    if (close > 0) return s.slice(1, close);
  }
  if (s.startsWith("'")) {
    const close = findClosingQuote(s, "'", 1);
    if (close > 0) return s.slice(1, close);
  }
  s = s.replace(/\s+#.*$/, "").trim();
  return s;
}

/**
 * Minimal line-based parser for the `gates:` block (DIR-050 unified format). Produces:
 *   { records: [{ name, script, command, section, line }], adr: [{ id, line }] }
 * Only entries carrying a `name` become records (the "名称 → script/command" registered set).
 * ADR scalar entries (`adr: ["ADR-001"]`) are returned separately — they have no script/command.
 * Self-contained (no YAML dependency) so the tool runs in any checkout without `npm install`.
 */
export function parseGates(configText, srcFile = "config") {
  const records = [];
  const adr = [];
  const lines = String(configText ?? "").split(/\r?\n/);
  let inGates = false;
  let curSection = null;
  let curItem = null;
  let itemIndent = -1; // indent of the current `- ` list item (fields are deeper)

  const flushItem = () => {
    if (curItem && curItem.name) {
      records.push({
        name: curItem.name,
        script: curItem.script,
        command: curItem.command,
        section: curSection,
        line: curItem.line,
      });
    }
    curItem = null;
    itemIndent = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const content = raw.trim();
    if (content === "" || content.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;

    if (!inGates) {
      if (indent === 0 && content === "gates:") inGates = true;
      continue;
    }

    // Leaving the gates block: another top-level `key:` at column 0 (e.g. `loop:`).
    if (indent === 0 && /^[A-Za-z][\w-]*:\s*(?:#.*)?$/.test(content)) {
      flushItem();
      break;
    }

    // List item: `- name: ...` (or an adr scalar `- "ADR-001"`). Any item starts a new record.
    if (content.startsWith("- ")) {
      flushItem();
      itemIndent = indent;
      const rest = content.slice(2).trim();
      const nm = rest.match(/^name:\s*(.+)$/);
      if (nm) {
        curItem = { name: cleanScalar(nm[1]), script: null, command: null, line: i + 1 };
      } else if (curSection === "adr") {
        adr.push({ id: cleanScalar(rest), line: i + 1 });
      }
      continue;
    }

    // Section header: a `key:` line (with no value after the colon, optional trailing comment)
    // that is shallower than the current item, or appears with no active item. Indentation-relative,
    // so any valid YAML layout (`  it0:`/`    - name:`/`      script:` or tighter) parses the same.
    if (/^[A-Za-z][\w-]*:\s*(?:#.*)?$/.test(content) && (curItem === null || indent < itemIndent)) {
      flushItem();
      curSection = content.slice(0, -1);
      continue;
    }

    // Field within the current item: deeper than the item line. `name:` / `script:` / `command:` / ...
    if (curItem && indent > itemIndent && itemIndent >= 0) {
      const fm = content.match(/^(name|script|command|argsKey|cwd|floor|red|green|pattern|timeoutMs):\s*(.*)$/);
      if (fm) {
        const key = fm[1];
        const val = cleanScalar(fm[2] ?? "");
        if (key === "name" && !curItem.name) curItem.name = val;
        else if (key === "script") curItem.script = val;
        else if (key === "command") curItem.command = val;
      }
    }
  }
  flushItem();
  return { records, adr, srcFile };
}

// ── Surface discovery ─────────────────────────────────────────────────────────────────────────────────

export const WORKFLOW_DIRS = [".claude/workflows", "plugin/workflows"];
export const DOD_CHECK_REL = "experiments/quay-perpetual-stream/scripts/it0-dod-check.ts";
export const CI_DIR = ".github/workflows";
export const OUTER_LOOP_REL = "experiments/quay-perpetual-stream/OUTER-LOOP.md";

/** Collect the 4 dispatch-surface file set as { rel, abs, kind, text }. Missing dirs are skipped. */
export function collectSurfaces(root) {
  const surfaces = [];
  for (const dir of WORKFLOW_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((n) => n.endsWith(".js")).sort()) {
      const rel = `${dir}/${f}`;
      surfaces.push({ rel, abs: path.join(abs, f), kind: "workflow", text: fs.readFileSync(path.join(abs, f), "utf8") });
    }
  }
  const dod = path.join(root, DOD_CHECK_REL);
  if (fs.existsSync(dod)) {
    surfaces.push({ rel: DOD_CHECK_REL, abs: dod, kind: "dodCheck", text: fs.readFileSync(dod, "utf8") });
  }
  const ciAbs = path.join(root, CI_DIR);
  if (fs.existsSync(ciAbs)) {
    for (const f of fs.readdirSync(ciAbs).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml")).sort()) {
      const rel = `${CI_DIR}/${f}`;
      surfaces.push({ rel, abs: path.join(ciAbs, f), kind: "ci", text: fs.readFileSync(path.join(ciAbs, f), "utf8") });
    }
  }
  const ol = path.join(root, OUTER_LOOP_REL);
  if (fs.existsSync(ol)) {
    surfaces.push({ rel: OUTER_LOOP_REL, abs: ol, kind: "outerLoop", text: fs.readFileSync(ol, "utf8") });
  }
  return surfaces;
}

// ── Token helpers ────────────────────────────────────────────────────────────────────────────────────

/**
 * Extract the first script basename (`*.sh|*.ts|*.mjs`) from a script path or command string.
 * `./plugin/scripts/alpha-check.sh` → `alpha-check.sh`; `node .../it0-split-or-commit-check.ts .`
 * → `it0-split-or-commit-check.ts`; a pure shell builtin command (`npx tsc ...`) → null.
 */
export function extractScriptBasename(scriptOrCommand) {
  if (!scriptOrCommand) return null;
  const m = String(scriptOrCommand).match(/[\w.-]+\.(?:sh|ts|mjs)\b/);
  return m ? m[0] : null;
}

/** Dedupe reference points (same file+line+via). */
export function dedupeRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const r of refs) {
    const key = `${r.file}:${r.line}:${r.via}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── Per-gate dispatch scan (AC3) ─────────────────────────────────────────────────────────────────────

/**
 * A line counts as a NAME-based dispatch reference only when it also carries a real dispatch marker
 * (a gate-engine invocation, a run verb, or an OUTER-LOOP.md `→` instruction). This keeps prose /
 * comment mentions of a gate name (e.g. it0-dod-check.ts clause descriptions) from drowning the
 * dispatch signal while still catching genuine name dispatches like `quay gate --gate split-or-commit`
 * or the workflow's Gate-phase `Run it0-dashboard-line-budget-check.sh` prompt.
 *
 * The verb alternation uses `\b…\b` (word boundaries around the verb only) so verb-flag forms are
 * matched too: `\bnode\b` matches inside `node --experimental-strip-types …` and `\bbash\b` inside
 * `bash -e …`, while camelCase prose (`someNode`, `node_modules`, `bashful`) does not match.
 */
export const DISPATCH_MARKER_RE = /\b(?:Run|run|bash|node|sh|exec|execute)\b|quay gate|--gate\b|→/i;

/** A line that is purely a comment (`//`, `#`, `*`) and carries no executable instruction. */
export function isCommentLine(line) {
  return /^\s*(\/\/|#|\*|<!--)/.test(line);
}

/**
 * For one registered gate, collect every surface line that references the gate — either by its
 * registered script's basename (strongest, always counted) or by its gate NAME appearing on the
 * line together with a dispatch marker (weaker, e.g. `quay gate --gate split-or-commit`). Both match
 * kinds skip pure-comment lines so doc-comment mentions (a `//` clause header naming a script, a
 * prose note about a gate) do not pollute the dispatch list — only executable/instruction lines
 * (a shell-out `path.join(...)`, a Gate-phase `Run …` prompt, a `quay gate` invocation, an
 * OUTER-LOOP.md `→ …` instruction) count as dispatch points. Returns [{ file, line, via }].
 */
export function scanGateDispatchers(gate, surfaces) {
  const base = extractScriptBasename(gate.script ?? gate.command ?? "");
  const name = gate.name;
  const refs = [];
  for (const surf of surfaces) {
    const lines = surf.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let via = null;
      if (base && !isCommentLine(line) && line.includes(base)) via = "script-basename";
      else if (name && !isCommentLine(line) && line.includes(name) && DISPATCH_MARKER_RE.test(line)) via = "name";
      if (via) refs.push({ file: surf.rel, line: i + 1, via });
    }
  }
  return dedupeRefs(refs);
}

// ── Reverse scan: dispatched but NOT registered (AC5) ────────────────────────────────────────────────

/** Gate-flavored basename filter: a *check/gate/guard/smoke/…* script, not a generic helper. */
export const GATE_FLAVOR_RE = /(?:check|gate|guard|smoke|budget|hygiene|lag|row|evidence|selfcheck|enforcement)[\w-]*\.(?:sh|ts)$/i;

/**
 * Collect every gate-flavored script basename referenced on the dispatch surfaces that is NOT the
 * registered script of any gate. `it0-dashboard-line-budget-check.sh` is the known instance: it is
 * run by the workflow's Gate phase but no gate registers it (the `line-budget` gate registers
 * `it0-ceiling-line-budget-check.sh` instead).
 */
export function scanUnregistered(registered, surfaces) {
  const registeredBases = new Set(
    registered.map((g) => extractScriptBasename(g.script ?? g.command ?? "")).filter(Boolean)
  );
  const map = new Map(); // basename -> { script, dispatchedBy }
  for (const surf of surfaces) {
    const lines = surf.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const tokens = lines[i].match(/[\w.-]+\.(?:sh|ts|mjs)\b/g) ?? [];
      for (const tok of tokens) {
        if (registeredBases.has(tok)) continue;
        if (!GATE_FLAVOR_RE.test(tok)) continue;
        // A real script basename has a dash (it0-…-check.sh); a bare `check.sh`/`check.ts` is a
        // line-wrapped comment fragment, not a script reference.
        if (!tok.includes("-")) continue;
        if (!map.has(tok)) map.set(tok, { script: tok, dispatchedBy: [] });
        map.get(tok).dispatchedBy.push({ file: surf.rel, line: i + 1, via: "script-basename" });
      }
    }
  }
  return [...map.values()]
    .map((e) => ({ script: e.script, dispatchedBy: dedupeRefs(e.dispatchedBy) }))
    .sort((a, b) => a.script.localeCompare(b.script));
}

// ── Mismatch detection: registration name vs run script (AC6) ────────────────────────────────────────

/** Script action = last dash-separated stem segment, e.g. `it0-…-check.sh` → "check". */
export function scriptAction(base) {
  const stem = String(base).replace(/\.(?:sh|ts|mjs)$/, "");
  const parts = stem.split("-");
  return parts[parts.length - 1];
}

/** Only check-like live scripts participate in mismatch detection. */
export const CHECK_ACTIONS = new Set(["check", "gate", "guard"]);

/**
 * Pair a registered gate with an unregistered live script when the live script's basename contains
 * the gate name and the live script is a check-like script — the AC6 signal that the gate's
 * registered script and the actually-run script differ.
 *   "different-script" (→ `mismatches`) — stems differ beyond the extension; a REAL registration-vs-
 *     run divergence (line-budget: registered it0-ceiling-…, live it0-dashboard-…).
 *   "wrapper-pair"     (→ `aliasPairs`) — same stem, different extension (drivable-workspace-check.sh
 *     vs .ts); the registered script and the live script are the SAME gate in wrapper/module form,
 *     NOT a divergence. Reported separately so `mismatches` stays a true-positive list.
 */
export function detectDivergences(registered, unregistered) {
  const mismatches = [];
  const aliasPairs = [];
  for (const u of unregistered) {
    if (!CHECK_ACTIONS.has(scriptAction(u.script))) continue;
    for (const g of registered) {
      const regBase = extractScriptBasename(g.script ?? g.command ?? "");
      if (!regBase || regBase === u.script) continue;
      if (!g.name || !u.script.includes(g.name)) continue;
      const sameStem =
        regBase.replace(/\.(?:sh|ts|mjs)$/, "") === u.script.replace(/\.(?:sh|ts|mjs)$/, "");
      const entry = {
        gate: g.name,
        registeredScript: regBase,
        liveScript: u.script,
        refs: u.dispatchedBy,
        kind: sameStem ? "wrapper-pair" : "different-script",
      };
      if (sameStem) aliasPairs.push(entry);
      else mismatches.push(entry);
    }
  }
  mismatches.sort((a, b) => (a.gate < b.gate ? -1 : a.gate > b.gate ? 1 : 0));
  aliasPairs.sort((a, b) => (a.gate < b.gate ? -1 : a.gate > b.gate ? 1 : 0));
  return { mismatches, aliasPairs };
}

// ── Report assembly ──────────────────────────────────────────────────────────────────────────────────

export function buildReport(configText, surfaces, srcFile = "config") {
  const { records, adr } = parseGates(configText, srcFile);
  const registered = records.map((g) => ({
    name: g.name,
    script: g.script ?? g.command ?? "",
    section: g.section,
    line: g.line,
    dispatchedBy: scanGateDispatchers(g, surfaces),
  }));
  const unregistered = scanUnregistered(registered, surfaces);
  const { mismatches, aliasPairs } = detectDivergences(registered, unregistered);
  const undispatched = registered
    .filter((g) => g.dispatchedBy.length === 0)
    .map((g) => ({ name: g.name, script: g.script }));
  return { registered, undispatched, unregistered, mismatches, aliasPairs, adr, surfacesScanned: surfaces.map((s) => s.rel) };
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────────

export function renderReport(report) {
  const lines = [];
  lines.push("GATE-DISPATCH COVERAGE — report, not a gate, not a judge (gap-gate-registration-vs-dispatch-unmeasured)");
  lines.push(`surfaces scanned: ${report.surfacesScanned.length} — ${report.surfacesScanned.join(", ") || "none"}`);
  lines.push(`registered gates: ${report.registered.length}  (ADR string entries, no script: ${report.adr.length})`);
  lines.push("");
  lines.push("── registered (name → script/command, per-gate dispatched-by) ──");
  for (const g of report.registered) {
    const refs = g.dispatchedBy.length
      ? g.dispatchedBy.map((r) => `${r.file}:${r.line} (${r.via})`).join(", ")
      : "no-known-dispatcher";
    lines.push(`${g.name}  →  ${g.script}`);
    lines.push(`    dispatched-by: ${refs}`);
  }
  lines.push("");
  lines.push("── undispatched (registered but no-known-dispatcher) ──");
  if (report.undispatched.length === 0) lines.push("(none)");
  for (const u of report.undispatched) lines.push(`${u.name}  →  ${u.script}`);
  lines.push("");
  lines.push("── unregistered (dispatched but NOT registered) ──");
  if (report.unregistered.length === 0) lines.push("(none)");
  for (const u of report.unregistered) {
    const refs = u.dispatchedBy.map((r) => `${r.file}:${r.line}`).join(", ");
    lines.push(`${u.script}  —  ${refs}`);
  }
  lines.push("");
  lines.push("── registration-name vs run-script mismatches (different-script divergences only) ──");
  if (report.mismatches.length === 0) lines.push("(none)");
  for (const m of report.mismatches) {
    const refs = m.refs.map((r) => `${r.file}:${r.line}`).join(", ");
    lines.push(`${m.gate}: registered ${m.registeredScript}, live ${m.liveScript} — ${refs}`);
  }
  lines.push("");
  lines.push("── alias pairs (registered script vs same-gate .sh/.ts wrapper — NOT divergences) ──");
  if (report.aliasPairs.length === 0) lines.push("(none)");
  for (const m of report.aliasPairs) {
    const refs = m.refs.map((r) => `${r.file}:${r.line}`).join(", ");
    lines.push(`${m.gate}: registered ${m.registeredScript}, live ${m.liveScript} — ${refs}`);
  }
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2)) {
  let root = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--root") root = argv[++i];
  }

  // AC8: keep exit 0 even when stdout closes early (e.g. `--json | head -0` → EPIPE). Swallowing the
  // EPIPE error lets main() return 0 instead of the process dying with a non-zero status.
  process.stdout.on("error", () => {});

  const workspaceRoot = root ? path.resolve(root) : repoRoot();
  let report;
  try {
    const configPath = path.join(workspaceRoot, ".quay", "config.yml");
    const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const surfaces = collectSurfaces(workspaceRoot);
    report = buildReport(configText, surfaces, configPath);
  } catch (err) {
    // Report the failure, never exit non-zero (AC8). JSON stays in the AC7 shape.
    process.stderr.write(`[gate-dispatch-coverage] error (reported, exit stays 0): ${(err && err.message) || err}\n`);
    report = { registered: [], undispatched: [], unregistered: [], mismatches: [], aliasPairs: [], adr: [], surfacesScanned: [] };
  }

  if (json) {
    const out = {
      registered: report.registered.map(({ name, script, dispatchedBy }) => ({ name, script, dispatchedBy })),
      undispatched: report.undispatched,
      unregistered: report.unregistered,
      mismatches: report.mismatches,
      aliasPairs: report.aliasPairs ?? [],
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write(renderReport(report) + "\n");
  }
  return 0; // constant exit 0 (AC8)
}

// Entry gate: only run main() when invoked directly (not when imported by tests).
let _isMain = false;
try {
  _isMain =
    !!process.argv[1] &&
    fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch {
  _isMain = false;
}
if (_isMain) {
  process.exitCode = main();
}
