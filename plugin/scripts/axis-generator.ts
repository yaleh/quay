#!/usr/bin/env node
// axis-generator.ts — the predictive dimension generator
// (tasks/gap-axis-generator-question-what-range-every-standing-criterion, AC1/AC3).
//
// The machine's dimension generation is a BYPRODUCT of friction: all 7 machine-opened dimensions
// were post-friction, and without a human present discovery goes ASYMPTOTIC — every snag gets
// fixed, then green is reported on every never-opened axis. This generator turns that
// friction-bound discovery into a MECHANISM: for every standing criterion, ask
//
//     "what range does it quantify — time / scope / layer / instance / cost?
//      if the answer is 'the present one', there's an unopened axis."
//
// The generator IS the question, not a keyword scan for axis NAMES: it classifies, per criterion,
// which RANGE the criterion quantifies beyond the present instance on each of the five axes, and
// reports the axes whose answer is "the present one" as UNOPENED. An axis-name word alone ("time",
// "instance") never opens an axis; only a quantified window/subset/layer-set/multiplicity/cost
// does (the invariant `generator_is_question`, exercised by --selfcheck and the unit test).
//
// It reverse-derives the human's 5/5 known axes from
// orchestration/SYNTHESIS-axis-generation-2026-08-05.md (AC3 regression control) and must
// reproduce a NEW axis with the same question.
//
// Axis verdicts:
//   time     present  — quantifies THIS run ("was it green this time")          -> time axis unopened
//            windowed — quantifies a window/trend ("more expensive than last")  -> time axis opened
//   scope    present  — applies to an unnamed/global set ("stop on red")        -> scope axis unopened
//            subset   — names the set it applies to ("per-suite", "该套件")       -> scope axis opened
//   layer    present  — covers only the layers in front of it                   -> layer axis unopened
//            layered  — names a complete/cross-layer set ("三层", "跨层")         -> layer axis opened
//   instance present  — assumes a single instance ("master is THE ref")          -> instance axis unopened
//            multi    — names multiple instances/roles ("distinct refs", "并发") -> instance axis opened
//   cost     present  — quantifies no cost ("pass/fail")                        -> cost axis unopened
//            costed   — quantifies cost/effort/resource ("per-test ms")         -> cost axis opened
//
// Usage:
//   node --experimental-strip-types plugin/scripts/axis-generator.ts --criteria
//       Enumerate the repo's standing criteria (gates from .quay/config.yml + static checkers from
//       scripts/test.sh's run_static_checks/CI) and print a per-criterion range report (JSON).
//   node --experimental-strip-types plugin/scripts/axis-generator.ts --fixture <json>
//       Classify an explicit fixture of criteria (used by the unit test and the control contract).
//   node --experimental-strip-types plugin/scripts/axis-generator.ts --selfcheck
//       Run the 5/5 regression control + the negative (opened-axis) fixtures + the not-keyword-scan
//       invariant control; exit 0 iff all pass.
//
// The runner is REPORT-ONLY: it never writes tasks/** — it finds axes; filing an unopened-axis task
// is the loop's job (systematic discovery, not friction-driven).

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AXES = ["time", "scope", "layer", "instance", "cost"];

export const AXIS_LABELS = {
  time: "time (window/trend vs point-in-time)",
  scope: "scope (named set vs global)",
  layer: "layer (complete/cross-layer vs present layers)",
  instance: "instance (multiple refs/nodes vs single)",
  cost: "cost (quantified vs none)",
};

// Range signals: evidence that a criterion quantifies a NON-present range on an axis. The absence
// of a signal on an axis means the criterion quantifies only "the present one" -> that axis is
// UNOPENED. Signals are RANGE signals (a window / a named subset / a complete layer set / a
// multiplicity / a quantified cost), deliberately NOT axis-name words — a text containing "time"
// or "instance" alone must not open those axes (generator_is_question invariant).
const SIGNALS = {
  time:
    /趋势|斜率|历史|比上次|上一次|每次|每晚|时段|随时间|回归|滚动|近 ?N ?次|24 ?小时|24h|trend|slope|history|rolling|since (?:last|the|that|a)|over time|than last|比.{0,6}(更|贵|快|慢)/,
  scope:
    /子集|集合|该套件|该任务|该批|窗口内|内新增|涉及的|按项目|按任务|每个项目|每个套件|per-project|per-suite|per-run|per-task|touched|subset|named set|specific set|which (?:project|suite|task)|哪些/,
  layer:
    /三层|全部层|所有层|跨层|层完整性|inner.{0,20}manager.{0,20}outer|outer.{0,20}manager.{0,20}inner|product.{0,20}engine.{0,20}governance|three-layer|all three layers|cross-layer|every layer|multi-layer|多层/,
  instance:
    /并发|多实例|多个 ?ref|多 ?ref|多个角色|distinct refs|separate.{0,12}ref|multiple (?:ref|instance|role|node|worker|replica)|concurrency|concurrent|多机|多节点|每实例|per-instance|多工作区/,
  cost:
    /成本|耗时|费用|预算|开销|每测试|per-test|per_test|per test|cost|budget|duration|latency|资源|毫秒|\d+(?:\.\d+)? ?(?:ms|s|秒|min|分钟|%|MB|GB|核|倍)/,
};

// A signal match preceded by a negation (within ~14 chars) is not evidence of a quantified range —
// "naming no set or window" must not open scope, "no named set" must not open scope. Conservative:
// erring toward "present" (unopened) is the generator's purpose (finding axes, not closing them).
const NEGATION_RE = /\b(?:no|not|none|without|never|neither|nor)\b|没有|无(?:名|法|从|人)?|缺(?:少|乏)?|未(?:被|曾)?/;

export function hasRangeSignal(text, axisRe) {
  const re = new RegExp(axisRe.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 14), m.index);
    if (NEGATION_RE.test(before)) continue;
    return true;
  }
  return false;
}

// The open (non-present) verdict per axis — what "quantifies a range beyond the present" means.
export const OPEN_VERDICTS = { time: "windowed", scope: "subset", layer: "layered", instance: "multi", cost: "costed" };

/**
 * Ask the generator's question of one criterion: "what range does it quantify?".
 * Returns { id, name, quantifies: {axis -> 'present'|openVerdict}, unopened_axes, opened_axes,
 * finding }. An axis whose answer is "the present one" is UNOPENED — the `finding` string is the
 * generated unopened-axis task candidate (AC1: "答案「眼前这一个」⇒ 生成未打开轴任务"): the loop can
 * file one task per unopened axis.
 */
export function classifyRange(criterion) {
  const text = `${criterion.name || ""}\n${criterion.description || ""}\n${criterion.contract || ""}`;
  const quantifies = {};
  for (const axis of AXES) {
    quantifies[axis] = hasRangeSignal(text, SIGNALS[axis]) ? OPEN_VERDICTS[axis] : "present";
  }
  const unopened_axes = AXES.filter((a) => quantifies[a] === "present");
  const opened_axes = AXES.filter((a) => quantifies[a] !== "present");
  const finding =
    unopened_axes.length > 0
      ? `unopened-axis task candidate: "${criterion.name || criterion.id}" quantifies only the present one on ${unopened_axes.join(", ")} — ask what non-present range (${unopened_axes.map((a) => AXIS_LABELS[a]).join("; ")}) it should quantify`
      : "no unopened axis";
  return { id: criterion.id, name: criterion.name, quantifies, unopened_axes, opened_axes, finding };
}

// ── Repository standing-criteria enumeration (AC1: systematic, not hand-listed) ────────────────────


function readFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** Read a script's leading comment block (the `//` or `#` header) as its prose description. */
export function readHeaderComment(filePath) {
  const text = readFile(filePath);
  if (!text) return "";
  const commentChars = filePath.endsWith(".sh") ? "#" : "//";
  const lines = text.split(/\r?\n/).slice(0, 60);
  const out = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^#!/.test(t)) continue; // shebang is not part of the header comment
    if (!started) {
      if (t.startsWith(commentChars)) {
        started = true;
        out.push(t.replace(/^\/\/\s?/, "").replace(/^#\s?/, ""));
      }
      continue;
    }
    if (t.startsWith(commentChars)) {
      out.push(t.replace(/^\/\/\s?/, "").replace(/^#\s?/, ""));
    } else if (t === "") {
      out.push("");
    } else {
      break;
    }
  }
  return out.join("\n").trim();
}

/** Extract the body of a `name() { ... }` function from a shell file (mirrors checker-mutation-check.sh's awk). */
export function extractFunctionBody(text, name) {
  const lines = text.split(/\r?\n/);
  let f = false;
  const out = [];
  for (const line of lines) {
    if (!f && new RegExp(`^${name}\\(\\).*`).test(line)) {
      f = true;
      continue;
    }
    if (f && /^\}/.test(line)) break;
    if (f) out.push(line);
  }
  return out.join("\n");
}

/** Gates from .quay/config.yml's `gates:` block (it0 / adr / fixed / testPass sections). */
export function enumerateGates(root) {
  const config = readFile(path.join(root, ".quay", "config.yml"));
  const gates = [];
  const lines = config.split(/\r?\n/);
  let inGates = false;
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^gates:\s*$/.test(line)) {
      inGates = true;
      continue;
    }
    if (inGates && /^\S/.test(line)) break; // dedent -> gates block ended
    if (!inGates) continue;
    const secM = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (secM) {
      section = secM[1];
      continue;
    }
    const nameM = line.match(/^    - name:\s*(.+)$/);
    if (nameM && section) {
      let script = null;
      for (let j = i + 1; j < lines.length && /^      /.test(lines[j]); j++) {
        const sm = lines[j].match(/^      (script|command):\s*(.+)$/);
        if (sm) {
          script = sm[2].replace(/^["']|["']$/g, "");
          break;
        }
      }
      gates.push({ id: `gate:${section}/${nameM[1].trim()}`, name: nameM[1].trim(), section, script, source: "gate" });
    }
  }
  return gates;
}

/** Static checkers from runner-static-gate.ts's run_static_checks + CI workflows (same mechanical source as checker-mutation-check.sh — run_static_checks moved OUT of scripts/test.sh, gap-ac128-hub-split-harness-concerns). */
export function enumerateStaticCheckers(root) {
  const staticGate = readFile(path.join(root, "plugin", "scripts", "runner-static-gate.ts"));
  const names = new Set();
  for (const m of extractFunctionBody(staticGate, "run_static_checks").matchAll(/\$\{repo_root\}\/plugin\/scripts\/([A-Za-z0-9_.-]+)\.(?:sh|ts)/g)) {
    names.add(m[1]);
  }
  const wfDir = path.join(root, ".github", "workflows");
  if (fs.existsSync(wfDir)) {
    for (const f of fs.readdirSync(wfDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
      for (const m of readFile(path.join(wfDir, f)).matchAll(/node (?:--[a-z-]+ )*scripts\/([A-Za-z0-9_.-]+)\.ts/g)) {
        names.add(m[1]);
      }
    }
  }
  return [...names]
    .sort()
    .map((n) => {
      const file = [path.join(root, "plugin", "scripts", `${n}.ts`), path.join(root, "plugin", "scripts", `${n}.sh`)].find((p) => fs.existsSync(p));
      const description = file ? readHeaderComment(file) : "";
      const script = file ? path.relative(root, file) : null;
      return { id: `checker:${n}`, name: n, source: "static-checker", script, description };
    });
}

/** All standing criteria: gates + static checkers. */
export function enumerateCriteria(root = repoRoot()) {
  const gates = enumerateGates(root).map((g) => {
    const scriptPath = g.script ? path.resolve(root, g.script.replace(/^\.\//, "")) : null;
    return { ...g, description: scriptPath ? readHeaderComment(scriptPath) : "" };
  });
  const checkers = enumerateStaticCheckers(root);
  return { gates, checkers, all: [...gates, ...checkers] };
}

// ── Regression / control fixtures (AC3) ─────────────────────────────────────────────────────────────

// The 5/5 reverse-derivation control (positive): the human's five known axes from
// SYNTHESIS-axis-generation — each fixture criterion must be classified with its known axis UNOPENED
// (and, since these are present-only criteria, no other axis may spuriously open).
export const REGRESSION_FIXTURES = [
  {
    id: "regr-time",
    name: "acceptance gate",
    description: "was it green this time — a point-in-time pass/fail verdict on the current run's conformance",
    expected_unopened: ["time"],
  },
  {
    id: "regr-scope",
    name: "red-window stop",
    description: "stop dispatch when the gate is red — the stop condition applies globally, one-size-fits-all, naming no set or window",
    expected_unopened: ["scope"],
  },
  {
    id: "regr-layer",
    name: "loop-doc coverage",
    description: "the loop documentation covers the inner and manager layers of the two-layer fast mode",
    expected_unopened: ["layer"],
  },
  {
    id: "regr-instance",
    name: "canonical ref",
    description: "the canonical ref master carries the divergence base, the merge point, and the canonical record on one ref",
    expected_unopened: ["instance"],
  },
  {
    id: "regr-scope-2",
    name: "needs-human stop",
    description: "stop dispatch when the needs-human backlog is at least 3 — a quantified threshold whose object set and time window are left unspecified",
    expected_unopened: ["scope"],
  },
];

// Negative fixtures: criteria that DO quantify a non-present range must open that axis (a window, a
// named set, a complete layer set, a multiplicity, a quantified cost). Without these the generator
// could not discriminate an opened axis from an unopened one.
export const NEGATIVE_FIXTURES = [
  {
    id: "neg-time",
    name: "cost trend",
    description: "trend criterion — flag when per-test cost grows more than 10% over the last 24-hour window",
    expected_opened: ["time", "cost"],
  },
  {
    id: "neg-scope",
    name: "per-suite gate",
    description: "per-suite gate — applies to the touched suite's test set, not the whole store",
    expected_opened: ["scope"],
  },
  {
    id: "neg-layer",
    name: "three-layer completeness",
    description: "three-layer completeness check — inner, manager, and outer layers each get a periodic anchor",
    expected_opened: ["layer"],
  },
  {
    id: "neg-instance",
    name: "ref-role separation",
    description: "concurrency check — separate the divergence base, the merge point, and the canonical record onto distinct refs",
    expected_opened: ["instance"],
  },
];

// The not-keyword-scan invariant control (generator_is_question = 1): axis-NAME words alone must
// NOT open an axis — only a quantified range does. "time axis" must not open time; "current
// instance" must not open instance.
export const INVARIANT_CONTROLS = [
  {
    id: "inv-axisname",
    name: "time axis gate",
    description: "the time axis gate reports the conformance verdict for the current instance",
    must_not_open: ["time", "instance"],
  },
];

/** Run all three control sets; returns a list of {name, ok, detail}. */
export function runSelfcheck() {
  const results = [];
  let ok = true;
  const record = (name, pass, detail) => {
    results.push({ name, ok: pass, detail });
    if (!pass) ok = false;
  };

  for (const fx of REGRESSION_FIXTURES) {
    const r = classifyRange(fx);
    // Positive control: the known axis must be unopened; and (these being present-only fixtures)
    // no OTHER axis may open either — an unexpected open is a false negative of the finding.
    const missing = fx.expected_unopened.filter((a) => r.opened_axes.includes(a));
    const unexpectedOpen = r.opened_axes;
    const pass = missing.length === 0 && unexpectedOpen.length === 0;
    record(
      `regression:${fx.id} (${fx.name})`,
      pass,
      `known axis ${fx.expected_unopened.join(",")} reproduced as unopened; opened=${r.opened_axes.join(",") || "none"}`,
    );
  }

  for (const fx of NEGATIVE_FIXTURES) {
    const r = classifyRange(fx);
    const pass = fx.expected_opened.every((a) => r.opened_axes.includes(a));
    record(
      `negative:${fx.id} (${fx.name})`,
      pass,
      `expected opened=${fx.expected_opened.join(",")}; got opened=${r.opened_axes.join(",") || "none"}`,
    );
  }

  for (const ctl of INVARIANT_CONTROLS) {
    const r = classifyRange(ctl);
    const pass = ctl.must_not_open.every((a) => r.opened_axes.includes(a) === false);
    record(
      `invariant:${ctl.id} (${ctl.name})`,
      pass,
      `must_not_open=${ctl.must_not_open.join(",")}; got opened=${r.opened_axes.join(",") || "none"} (axis-name words alone must not open an axis)`,
    );
  }

  return { ok, results };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage(out = process.stderr) {
  out.write(
    `axis-generator.ts — for every standing criterion ask "what range does it quantify — ` +
      `time/scope/layer/instance/cost? if the answer is the present one, there's an unopened axis".\n\n` +
      `Usage:\n` +
      `  node --experimental-strip-types plugin/scripts/axis-generator.ts --criteria\n` +
      `      enumerate the repo's standing criteria (gates + static checkers) and print the range report\n` +
      `  node --experimental-strip-types plugin/scripts/axis-generator.ts --fixture <json>\n` +
      `      classify an explicit fixture of criteria (JSON array of {id,name,description,[contract]})\n` +
      `  node --experimental-strip-types plugin/scripts/axis-generator.ts --selfcheck\n` +
      `      run the 5/5 regression + negative + invariant controls (AC3); exit 0 iff all pass\n`,
  );
}

function main(argv) {
  const flag = argv[0];
  if (flag === "--selfcheck") {
    const { ok, results } = runSelfcheck();
    for (const r of results) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`);
    }
    console.log(ok ? "selfcheck: ALL PASS (5/5 regression + negative + invariant)" : "selfcheck: FAILURES");
    process.exit(ok ? 0 : 1);
  }
  if (flag === "--criteria") {
    const { all } = enumerateCriteria();
    const report = all.map((c) => {
      const r = classifyRange(c);
      return { ...r, source: c.source, description: (c.description || "").slice(0, 300) };
    });
    const withUnopened = report.filter((r) => r.unopened_axes.length > 0);
    console.log(JSON.stringify({ total: all.length, with_unopened_axis: withUnopened.length, criteria: report }, null, 2));
    process.exit(0);
  }
  if (flag === "--fixture") {
    const file = argv[1];
    if (!file) {
      usage();
      process.exit(2);
    }
    const fixture = JSON.parse(readFile(path.resolve(file)));
    const report = fixture.map((c) => classifyRange(c));
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  usage();
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "axis-generator") {
  main(process.argv.slice(2));
}
