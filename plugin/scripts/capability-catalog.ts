#!/usr/bin/env node
// capability-catalog.ts — the RENDERER + every gate of the capability catalog.
//
// A CAPABILITY CATALOG: every shipped check declares what QUESTION it makes askable.
//
// Organizing principle (the human's ruling, kept as the screening criterion):
//    一个能力 = 让一个原本不可机械提问的问题，变得可提问。
//    A capability = making an originally-unaskable question askable.
//    A checker that answers no question is not a capability — it is repo lint.
//
// The problem this kills: 82 scripts ship and not one declares what question it
// answers — capability was never missing, VISIBILITY was. A project installs quay and
// gets dozens of checks with nothing telling it what each one answers.
//
// ── The machine-readable field (AC1a) ─────────────────────────────────────────────
// Each delivered check has ONE machine-readable declaration of the question it makes
// askable. The declarations live as DATA in capability-catalog-declarations.json (the
// SINGLE SOURCE OF TRUTH: file → the question it answers, plus the ①②③④ crystallization
// fields and the shipping / entry-surface classifications). This renderer reads that file;
// the entry `bash plugin/scripts/capability-catalog.sh <mode>` is a thin wrapper around it
// (gap-arch-catalog-declarations-leave-bash: the tables used to be 1907 bash
// `declare -A` assignments inside that .sh — shell-quoted data is an evaluation surface).
// The check set itself is DERIVED from the filesystem, never a hardcoded "82".
//
// ── The entry-point gate (AC1c) ───────────────────────────────────────────────────
// A new script entering the artifact that has NO declaration in the data file is reported
// as unclassified (question: null) and this catalog EXITS NON-ZERO. That is the mechanical
// "field must be present the moment a script enters the artifact" requirement — the only
// thing that stops the unclassified number growing before visibility exists.
//
// ── The data-integrity gate (AC5) ─────────────────────────────────────────────────
// A command-substitution pattern (backtick or $( ) inside a declaration VALUE used to be
// EXECUTED by bash at load time — round 143 red: a backtick value ran a whole doc-check
// suite on every catalog load and its multiline output broke the tab-separated rows).
// JSON values are never evaluated, so that hazard is structurally gone here; this gate is
// kept, and RAISED to cover EVERY string value in the file (the old `^  [` source scan had
// an indentation blind spot — 0/3-space-indented declarations escaped it), so a
// migrated-away hazard does not silently become a permanently-green check. It can still
// take false: inject a backtick into any value and the catalog exits non-zero.
//
// ── The screening (AC2) ───────────────────────────────────────────────────────────
// NOT_SHIPPED lists the exp5-legacy scripts whose existence is motivated only by THIS
// repo's history — they answer questions a target project does not ask. They are judged
// `ships: false` (do not ship with the artifact). The three named families
// (codex-stage1-selfcheck, it0-enforcement-with-design-check, audit-independence-check)
// must be so judged (AC2) — and they already do not ship under the derived LOOP_SCRIPTS.
//
// Usage (the ENTRY contract is `bash plugin/scripts/capability-catalog.sh <mode>`):
//   --json                 machine-readable JSON array (see Output shape below)
//   --table                explicit human table (the default when no mode is given)
//   --summary              one summary line only
//   --entry-surface [--summary|--json]
//                          .sh delivery-form gate (AC3): every consumer-doc-referenced
//                          .sh must be declared public; exit 1 on a violation
//   --superseded-check     superseded-capability gate (AC5 of that task): every SUPERSEDED
//                          entry must NOT exist in plugin/scripts, plugin/test,
//                          packages/*/plugin nor be taught in SKILL/README; exit 1 otherwise
//   --help | -h            print this header, exit 0 (no side effects)
//
// Exit status: 0 when every shipped check declares its question (unclassified == 0) AND no
// declaration value contains a command-substitution pattern AND (in --entry-surface mode)
// no internal .sh is referenced by consumer-facing docs; 1 when any check is unclassified
// (AC1c gate), the data-integrity gate fires, a declared check lacks a crystallization
// field (①②④ entry gate), or the delivery-form gate fails (AC3); 2 on a usage error;
// 3 when the declarations data file is missing / unparsable / missing a table — an ABSENT
// table is reported as NOT-EVALUATED, never silently rendered as an empty (passing) one.
//
// Output shape (--json): a top-level JSON array of
//   {"file": "<basename>", "question": "<question>" | null, "ships": true|false}
// so the contract's measures work verbatim:
//   declared_questions = --json | jq '[.[]|select(.question)]|length'
//   shipped_checks     = ls plugin/scripts/*.{sh,ts,mjs} | wc -l
//   unclassified       = --json | jq '[.[]|select(.question==null)]|length'   (band 0)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./repo-root.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DECLARATIONS_BASENAME = "capability-catalog-declarations.json";

/** The ten declaration tables. A missing one is NOT-EVALUATED (exit 3) — never an empty table. */
const TABLE_NAMES = [
  "QUESTION", "GUARD_OBJECT", "CADENCE", "INVALIDATION", "LAST_REAFFIRMED",
  "MATCHING", "CONSUMER", "SUPERSEDED", "NOT_SHIPPED", "PUBLIC_ENTRYPOINTS",
] as const;

type Tables = Record<string, Record<string, string>>;

// ── declarations loading (fail-closed: missing/unparsable/missing-table ⇒ exit 3) ─────────────
// The data file sits beside the renderer in the dev tree (plugin/scripts/) and one level up in
// the packaged artifact (plugin/scripts/dist/capability-catalog.js → plugin/scripts/), because
// package.sh bundles the .ts into dist/ and deletes the raw source. Two candidate paths, first
// hit wins; ZERO hits is a hard error, never a silently-empty catalog (硬规则 3b).
//
// ⛔ The directory the file is FOUND IN is also the answer to "which directory holds the checks"
// (PLUGIN_SCRIPTS_DIR below), and that matters: in the packaged artifact this module lives in
// dist/ while the check set lives one level up, so enumerating `SCRIPT_DIR` would silently derive
// an EMPTY check set and report `0 scripts | 0 declared | 0 unclassified` — a vacuous PASS of
// exactly the kind 硬规则 3b forbids. The declarations file is the anchor for both, so the two
// can never disagree. (Found by running the real packages/quay/scripts/package.sh and reading the
// staged artifact; the dev tree alone cannot see it.)
function declarationsCandidates(): string[] {
  return [
    path.join(SCRIPT_DIR, DECLARATIONS_BASENAME),
    path.join(SCRIPT_DIR, "..", DECLARATIONS_BASENAME),
  ];
}

function die(cause: string, detail: string): never {
  console.error(`CAUSE=${cause} — ${detail}`);
  process.exit(3);
}

interface Declarations {
  tables: Tables;
  file: string;
  scriptsDir: string;
}

function loadTables(): Declarations {
  const candidates = declarationsCandidates();
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    die("declarations-missing",
      `no ${DECLARATIONS_BASENAME} found (looked in: ${candidates.join(", ")}). The capability catalog's ` +
      `declaration data is absent — refusing to render an empty catalog as if every check were declared.`);
  }
  const scriptsDir = path.dirname(path.resolve(file));
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    die("declarations-unreadable", `${file} could not be read: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    die("declarations-unparsable", `${file} is not valid JSON: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    die("declarations-unparsable", `${file} must parse to a JSON object of tables, got ${Array.isArray(parsed) ? "an array" : typeof parsed}.`);
  }
  const obj = parsed as Record<string, unknown>;
  const tables: Tables = {};
  const missing: string[] = [];
  for (const name of TABLE_NAMES) {
    const v = obj[name];
    if (v === undefined) { missing.push(name); continue; }
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      die("declarations-table-malformed", `${file}: table ${name} must be a JSON object of key → string.`);
    }
    const t: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val !== "string") {
        die("declarations-table-malformed", `${file}: ${name}[${k}] must be a string, got ${typeof val}.`);
      }
      t[k] = val;
    }
    tables[name] = t;
  }
  if (missing.length > 0) {
    die("declarations-table-missing",
      `${file} is missing the ${missing.join(", ")} table(s). An absent table is NOT an empty table — ` +
      `rendering it as empty would silently report every check as unclassified-or-undeclared.`);
  }
  return { tables, file, scriptsDir };
}

// ── data-integrity gate (AC5): no command-substitution pattern in any DECLARATION value ──────
// Scope = every entry of every one of the ten tables (1909 values today), NOT a scan of source
// text. The old gate matched source lines by shape (`^  \[`), so 9 declarations that were not
// two-space-indented escaped it entirely — this scope has no indentation or quoting blind spot.
// Underscore-prefixed prose keys (the file's own `_comment`) are excluded, exactly as the old
// gate excluded comment lines: prose never crosses back into a shell. That exclusion is the ONLY
// one — it is stated here rather than implied, so it cannot silently widen.
function findCommandSubstitutions(tables: Tables): string[] {
  const hits: string[] = [];
  for (const table of TABLE_NAMES) {
    for (const [k, v] of Object.entries(tables[table])) {
      if (v.includes("`") || v.includes("$(")) hits.push(`${table}[${k}]: ${v.slice(0, 120)}`);
    }
  }
  return hits;
}

// ── derive the check set from the filesystem (never a hardcoded count) ───────────────────────
// Mirrors the original `find "$SELF_DIR" -mindepth 1 -type f \( -name '*.sh' -o -name '*.ts' -o
// -name '*.mjs' \) -not -path '*/checker-mutation-cases/*' -not -path '*/archive/*'`: recursive,
// basename-keyed, skipping the fixture dir and archive/** (SPEC §12c) so a misplaced archive
// subdir can never pollute the live catalog.
const SKIPPED_SEGMENTS = new Set(["checker-mutation-cases", "archive"]);
const CHECK_EXT_RE = /\.(sh|ts|mjs)$/;

function deriveScripts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIPPED_SEGMENTS.has(e.name)) continue;
        walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      if (!CHECK_EXT_RE.test(e.name)) continue;
      out.push(e.name);
    }
  };
  walk(dir);
  return [...out].sort();
}

// ── superseded-capability check (AC5: 一个能力=一个实现, 被取代的实现不存在于仓库, 不被教学) ──
// Asserts the SUPERSEDED table invariant: every superseded implementation must NOT exist in the
// executable layer (plugin/scripts, plugin/test, packages/*/plugin vendored copies) and must NOT
// be taught in SKILL/README positions. Wired into run_static_checks (scripts/test.sh) so a
// deleted superseded implementation can never silently regrow.
// Exit 0 = every superseded capability is gone and untaught; 1 = at least one still exists.
function listDirs(parent: string): string[] {
  try {
    return fs.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

function fileExists(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function runSupersededCheck(tables: Tables, scriptsDir: string): number {
  const root = repoRoot(scriptsDir);
  const superseded = tables.SUPERSEDED;
  let viol = "";
  for (const b of Object.keys(superseded)) {
    const stem = b.replace(/\.[^.]*$/, "");
    if (fileExists(path.join(root, "plugin", "scripts", b))) {
      viol += `  plugin/scripts/${b} — superseded implementation still exists\n`;
    }
    for (const pkg of listDirs(path.join(root, "packages"))) {
      const v = path.join(root, "packages", pkg, "plugin", "scripts", b);
      if (fileExists(v)) viol += `  packages/${pkg}/plugin/scripts/${b} — superseded vendored copy still exists\n`;
    }
    if (fileExists(path.join(root, "plugin", "test", b))) {
      viol += `  plugin/test/${b} — superseded test still exists\n`;
    }
    if (fileExists(path.join(root, "plugin", "test", `${stem}.test.mjs`))) {
      viol += `  plugin/test/${stem}.test.mjs — superseded test still exists\n`;
    }
    const teaching: string[] = [];
    for (const d of listDirs(path.join(root, "plugin", "skills"))) teaching.push(path.join(root, "plugin", "skills", d, "SKILL.md"));
    teaching.push(path.join(root, "plugin", "README.md"), path.join(root, "README.md"));
    for (const pkg of listDirs(path.join(root, "packages"))) teaching.push(path.join(root, "packages", pkg, "README.md"));
    for (const tf of teaching) {
      if (!fileExists(tf)) continue;
      if (fs.readFileSync(tf, "utf8").includes(stem)) {
        viol += `  ${path.relative(root, tf)} teaches the superseded capability ${b} (stem ${stem})\n`;
      }
    }
  }
  if (viol) {
    console.error("FAIL (superseded-capability check): a superseded implementation must NOT exist in the executable layer nor be taught:");
    process.stderr.write(viol);
    return 1;
  }
  console.log(`superseded-capability check: PASS — every superseded capability is removed from the executable layer and not taught (${Object.keys(superseded).length} superseded)`);
  return 0;
}

// ── delivery-form computation (AC3): which .sh do the consumer-facing docs reference? ─────────
// Self-locating: works in the repo AND in the staged package copy. Consumer-facing operation docs
// = plugin/loop/*.md + plugin/skills/*/SKILL.md — the SAME surface the task contract's
// `consumer_facing_entrypoints` measure scans.
const DOC_SH_RE = /plugin\/scripts\/([a-zA-Z0-9._-]+\.sh)/g;

function docReferencedSh(pluginRoot: string): string[] {
  const loopDir = path.join(pluginRoot, "loop");
  const skillsDir = path.join(pluginRoot, "skills");
  if (!fs.existsSync(loopDir) || !fs.existsSync(skillsDir)) return [];
  const files: string[] = [];
  try {
    for (const f of fs.readdirSync(loopDir)) if (f.endsWith(".md")) files.push(path.join(loopDir, f));
  } catch { /* leave empty */ }
  for (const d of listDirs(skillsDir)) files.push(path.join(skillsDir, d, "SKILL.md"));
  const found = new Set<string>();
  for (const f of files) {
    let text: string;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const m of text.matchAll(DOC_SH_RE)) found.add(m[1]);
  }
  return [...found].sort();
}

function readHeaderComment(): string {
  let text: string;
  try { text = fs.readFileSync(fileURLToPath(import.meta.url), "utf8"); } catch { return ""; }
  return text.split("\n")
    .slice(0, 120)
    .filter((l) => l.startsWith("#") && !l.startsWith("#!"))
    .map((l) => l.replace(/^# ?/, ""))
    .filter((l) => !l.startsWith("!"))
    .join("\n");
}

function main(argv: string[]): number {
  const a0 = argv[0] ?? "";
  if (a0 === "--help" || a0 === "-h") {
    console.log("用法: bash capability-catalog.sh [参数…] — 详见下方脚本头部用法注释（--help|-h 仅打印用法，无副作用，退出 0）");
    const header = readHeaderComment();
    if (header) console.log(header);
    return 0;
  }

  let mode = "table";
  let entrySurfaceSubmode = "";
  switch (a0) {
    case "--json": mode = "json"; break;
    case "--table": mode = "table"; break;
    case "--summary": mode = "summary"; break;
    case "--entry-surface":
      mode = "entry-surface";
      switch (argv[1] ?? "") {
        case "--json": entrySurfaceSubmode = "json"; break;
        case "--summary": entrySurfaceSubmode = "summary"; break;
        case "": break;
        default:
          console.error(`ERROR: unknown --entry-surface sub-argument: ${argv[1]} (expected --json | --summary)`);
          return 2;
      }
      break;
    case "--superseded-check": mode = "superseded-check"; break;
    case "": break;
    default:
      console.error(`ERROR: unknown argument: ${a0} (expected --json | --table | --summary | --entry-surface | --superseded-check)`);
      return 2;
  }

  const { tables, scriptsDir } = loadTables();

  // AC5 data-integrity gate — fail-fast BEFORE any rendering, over EVERY declaration value.
  const csHits = findCommandSubstitutions(tables);
  if (csHits.length > 0) {
    console.error(`FAIL (AC5 no-command-substitution): a declaration value in ${DECLARATIONS_BASENAME} contains a command-substitution pattern (backtick or $( ) — it would be evaluated as code wherever the value crosses back into a shell.`);
    console.error("  Write the command as plain text.");
    for (const h of csHits) console.error(`  ${h}`);
    return 1;
  }

  if (mode === "superseded-check") return runSupersededCheck(tables, scriptsDir);

  // ── build rows ────────────────────────────────────────────────────────────────────────────
  // ⛔ scriptsDir, NOT SCRIPT_DIR: in the packaged artifact this module lives in scripts/dist/ while
  // the check set lives in scripts/ (see loadTables). Enumerating the module's own dir derives an
  // EMPTY set and reports a vacuous `0 scripts | 0 declared | 0 unclassified` PASS.
  const scripts = deriveScripts(scriptsDir);
  const QUESTION = tables.QUESTION, CADENCE = tables.CADENCE, INVALIDATION = tables.INVALIDATION;
  const LAST_REAFFIRMED = tables.LAST_REAFFIRMED, MATCHING = tables.MATCHING;
  const CONSUMER = tables.CONSUMER, NOT_SHIPPED = tables.NOT_SHIPPED, PUBLIC_ENTRYPOINTS = tables.PUBLIC_ENTRYPOINTS;

  const TOTAL = scripts.length;
  let DECLARED = 0, UNCLASSIFIED = 0, SHIPPED = 0;
  let MISSING_CADENCE = 0, MISSING_INVALIDATION = 0, MISSING_LAST_REAFFIRMED = 0, MISSING_MATCHING = 0;
  let SH_SHIPPED = 0, PUBLIC_SH = 0, INTERNAL_SH = 0;

  interface Row { file: string; question: string; ships: boolean; surface: string | null; cadence: string; invalidation: string; lastReaffirmed: string; matching: string; consumer: string; }
  const rows: Row[] = [];

  for (const b of scripts) {
    const q = QUESTION[b] ?? "";
    if (q) DECLARED++; else UNCLASSIFIED++;
    const ships = !(NOT_SHIPPED[b]);
    if (ships) SHIPPED++;
    // delivery-form surface (AC3): .sh in PUBLIC_ENTRYPOINTS is consumer-facing (public); every
    // other shipped .sh is an internal part. Non-.sh (.ts/.mjs) are a DIFFERENT axis → surface null.
    let surface: string | null = null;
    if (b.endsWith(".sh")) surface = PUBLIC_ENTRYPOINTS[b] ? "public" : "internal";
    // 熔融-结晶张力五方向 ①②③④ per-entry attributes. A DECLARED script missing cadence /
    // invalidation / last-reaffirmed / matching is an entry-gate reject (below), NOT silently
    // defaulted — 缺字段=入口闸拒绝 (照 capability-catalog 已有 AC1c 做法).
    const cadence = CADENCE[b] ?? "";
    const invalidation = INVALIDATION[b] ?? "";
    const lastReaffirmed = LAST_REAFFIRMED[b] ?? "";
    const matching = MATCHING[b] ?? "";
    const consumer = CONSUMER[b] ?? "";
    if (q) {
      if (!cadence) MISSING_CADENCE++;
      if (!invalidation) MISSING_INVALIDATION++;
      if (!lastReaffirmed) MISSING_LAST_REAFFIRMED++;
      if (!matching) MISSING_MATCHING++;
    }
    if (surface === "public") PUBLIC_SH++;
    if (surface === "internal") INTERNAL_SH++;
    if (b.endsWith(".sh")) SH_SHIPPED++;
    rows.push({ file: b, question: q, ships, surface, cadence, invalidation, lastReaffirmed, matching, consumer });
  }

  const pluginRoot = path.resolve(scriptsDir, "..");
  const docRefs = docReferencedSh(pluginRoot);
  const violations = docRefs.filter((b) => !PUBLIC_ENTRYPOINTS[b]);
  const DOC_REFERENCED_SH_COUNT = docRefs.length;
  const VIOLATION_COUNT = violations.length;

  // ── output ────────────────────────────────────────────────────────────────────────────────
  if (mode === "json") {
    const entries = rows.map((r) => ({
      file: r.file,
      question: r.question ? r.question : null,
      ships: r.ships,
      surface: r.surface,
      cadence: r.cadence ? r.cadence : null,
      invalidation: r.invalidation ? r.invalidation : null,
      last_reaffirmed: r.lastReaffirmed ? r.lastReaffirmed : null,
      matching: r.matching ? r.matching : null,
      consumer: r.consumer ? r.consumer : null,
    }));
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
  } else if (mode === "entry-surface") {
    if (entrySurfaceSubmode === "json") {
      process.stdout.write(JSON.stringify({
        sh_shipped: SH_SHIPPED,
        public_sh: PUBLIC_SH,
        internal_sh: INTERNAL_SH,
        doc_referenced_sh: DOC_REFERENCED_SH_COUNT,
        violations,
        ok: VIOLATION_COUNT === 0,
      }, null, 2) + "\n");
    } else {
      console.log(`delivery form (.sh): ${SH_SHIPPED} shipped | ${PUBLIC_SH} declared consumer-facing | ${INTERNAL_SH} internal`);
      console.log(`consumer-facing docs reference ${DOC_REFERENCED_SH_COUNT} distinct .sh`);
      if (VIOLATION_COUNT > 0) {
        console.error(`FAIL (AC3): ${VIOLATION_COUNT} internal .sh script(s) are referenced by consumer-facing docs — the demotion is verbal, not real:`);
        for (const v of violations) console.error(`  ${v}`);
        console.error("  Declare each in PUBLIC_ENTRYPOINTS (capability-catalog-declarations.json) OR remove the doc reference.");
      } else {
        console.log("AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS");
      }
    }
  } else if (mode === "summary") {
    console.log(`capability-catalog: ${TOTAL} scripts | ${DECLARED} declared | ${UNCLASSIFIED} unclassified | ${SHIPPED} ship`);
  } else if (mode === "table") {
    console.log(`capability catalog — what each shipped check answers (${scriptsDir})`);
    console.log("---------------------------------------------------------------------------");
    for (const r of rows) {
      if (!r.ships) console.log(`  ${r.file.padEnd(40, " ")} ${r.question}   [NOT SHIPPED — exp5 legacy]`);
      else console.log(`  ${r.file.padEnd(40, " ")} ${r.question}`);
    }
    console.log("---------------------------------------------------------------------------");
    console.log(`summary: ${TOTAL} scripts | ${DECLARED} declared | ${UNCLASSIFIED} unclassified | ${SHIPPED} ship`);
    if (UNCLASSIFIED > 0) {
      console.error(`FAIL (AC1c): ${UNCLASSIFIED} script(s) entered the artifact without a declared question.`);
      console.error("  Add an entry to the QUESTION table in capability-catalog-declarations.json, or the check is rejected.");
    }
  }

  // ── AC1c gate: unclassified > 0 ⇒ exit non-zero ────────────────────────────────────────────
  if (UNCLASSIFIED > 0) return 1;

  // ── 熔融-结晶张力五方向 entry gate (①②④): a DECLARED script missing cadence / invalidation /
  // last-reaffirmed / matching is rejected — 缺字段=入口闸拒绝, 照 capability-catalog 已有 AC1c 做法.
  // 这一条把「结晶时写失效前提/周期」从纪律变成入口闸: 新脚本进 artifact 时作者必须声明这四个字段,
  // 否则该脚本的 entry 被拒。无默认值兜底 — 有默认值就是假装字段在场。
  if (MISSING_CADENCE > 0 || MISSING_INVALIDATION > 0 || MISSING_LAST_REAFFIRMED > 0 || MISSING_MATCHING > 0) {
    console.error("FAIL (entry-gate, gap-crystallization-five-directions): a declared check is missing a required crystallization field.");
    if (MISSING_CADENCE > 0) console.error(`  ${MISSING_CADENCE} check(s) lack cadence: (每轮|每红窗|每里程碑|冷启动|按需) — add a CADENCE row.`);
    if (MISSING_INVALIDATION > 0) console.error(`  ${MISSING_INVALIDATION} check(s) lack 失效前提 (invalidation) — add an INVALIDATION row (testable precondition, or '无可测前提，靠周期复核').`);
    if (MISSING_LAST_REAFFIRMED > 0) console.error(`  ${MISSING_LAST_REAFFIRMED} check(s) lack last-reaffirmed — add a LAST_REAFFIRMED row (YYYY-MM-DD).`);
    if (MISSING_MATCHING > 0) console.error(`  ${MISSING_MATCHING} check(s) lack matching method — add a MATCHING row (position|keyword|enumerative|n/a).`);
    return 1;
  }

  // ── AC3 gate (delivery form): an internal .sh referenced by consumer-facing docs ⇒ exit 1 ──
  // This is the load-bearing negative control: "demoted" must be real, not verbal.
  if (mode === "entry-surface" && VIOLATION_COUNT > 0) return 1;

  return 0;
}

process.exitCode = main(process.argv.slice(2));
