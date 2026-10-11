#!/usr/bin/env node
// ARCHITECTURE-DISCOVERY — TIME instrument (failure recurrence over REAL runtime carriers).
// Lands `expB.mjs` from the 2026-10-11 scratch experiment so its readings are reproducible from the repo.
//
// It separates "one root cause recurring" from "independent errors that merely look alike" by GROUPING
// suite-red events on file + normalised signature, then testing six pre-registered readings:
//   B1  a recurrent group on a named file exists BEFORE a cut; the tool LOCATES (git log, by itself) the
//       first develop commit touching that file after the group's last pre-cut event and PREDICTS 0 reds
//       after it. Refuted iff any red on the file after that commit.
//   B2  `plugin/test/task-granularity-advice.test.mjs` yields ≥2 groups (a file-only key would merge them).
//   B3  no group spans more than one file (structural).
//   B4  suite reds within 30 min after a host oom-kill, vs the same OOM times shifted ±6h/±12h. A green-suite
//       control is REQUIRED: if green completions are equally enriched, the link is "a suite was running".
//   B5  orphan finalisations within 15 min after a worker-loop start (restart-induced burst?).
//   B6  each needs-human→todo retreat LINKED (not classified) to the task's suite reds in the prior 7 days.
//
// ⛔ STRUCTURAL SANDBOX: read-only. ⛔ It writes NO cause enumeration to any task (human ruling 2026-09-20,
// driver-filters.ts:871-883) — outputs are groups + hypotheses + counterexamples on the caller's `--out`
// carrier only. Objects are never merged by literal similarity: a merge needs shared-intervention evidence.
//
// Every record is validated by the PRODUCTION evidence-store validator; the tally is reported. Records use
// the store's discovery verdicts, its `counterexample` kind, and its runtime-`carrier` provenance form.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { sha256, subjectKey, validateRecord } from "./architecture-evidence-store.mjs";
import { Sink, carrierEvidence, PROVENANCE_TASK_DEFAULT } from "./arch-discovery-space.mjs";

export const TOOL = "arch-discovery-time";
export const W48 = 48 * 3600e3;
export const DEFAULT_CUT = "2026-10-09T11:31:00Z";
export const DEFAULT_B1_FILE = "plugin/test/worktree-process-reaper.test.mjs";
export const B2_FILE = "plugin/test/task-granularity-advice.test.mjs";
export const ORPHAN_RE = /^(adopted orphan worker exited|orphaned worker finalized by reconcile)/;
export const JOURNAL_FLOOR = "2026-09-18T06:12:38Z";   // journalctl --list-boots first entry

/** The grouping key. MUTATION CONTROL (AC): flip this to "file-only" — B2 must then read `merged(refuted)`. */
export const GROUP_KEY_BY = "file+signature";

// ── pure logic (unit-tested by plugin/test/arch-discovery-time.test.mjs) ─────────────────────────────
export function groupKey(event, keyBy = GROUP_KEY_BY) {
  if (keyBy === "file-only") return subjectKey("suite-red", [event.file]);
  return `${subjectKey("suite-red", [event.file])}#${event.sigKey}`;
}

/** Max DISTINCT tasks inside any one W48 window — the pre-registered recurrence reading. */
export function recurrentWindows(events, windowMs = W48) {
  const ev = [...events].sort((a, b) => a.ts - b.ts); let best = 0;
  for (let i = 0; i < ev.length; i++) { const s = new Set(); for (let j = i; j < ev.length && ev[j].ts - ev[i].ts <= windowMs; j++) s.add(ev[j].task); best = Math.max(best, s.size); }
  return best;
}

export function groupsOf(events, { keyBy = GROUP_KEY_BY } = {}) {
  const groups = new Map();
  for (const e of events) {
    const key = groupKey(e, keyBy);
    if (!groups.has(key)) groups.set(key, { key, file: e.file, sigKey: e.sigKey, sigs: e.sigs, events: [] });
    groups.get(key).events.push(e);
  }
  return [...groups.values()].map((g) => {
    const ev = [...g.events].sort((a, b) => a.ts - b.ts);
    return {
      key: g.key, file: g.file, sigKey: g.sigKey, sig0: (g.sigs?.[0] || "").slice(0, 90),
      events: ev.length, tasks: new Set(ev.map((e) => e.task)).size, max48hTasks: recurrentWindows(ev),
      first: new Date(ev[0].ts).toISOString(), last: new Date(ev[ev.length - 1].ts).toISOString(),
      files_in_group: new Set(ev.map((e) => e.file)).size,
      first3: ev.slice(0, 3).map((e) => `${new Date(e.ts).toISOString()} ${e.task} L${e.line}`),
    };
  });
}

export const recurrentGroups = (groups) => groups.filter((g) => g.max48hTasks >= 2 && g.file !== "<files-not-evaluated>");

/** Enrichment of `targets` inside a window after each `trigger`, vs the SAME triggers shifted ±6h/±12h. */
export function enrichment({ targets, triggers, winMs, lo }) {
  const inWin = (shift) => targets.filter((t) => t.ts >= lo && triggers.some((g) => t.ts >= g.ts + shift && t.ts <= g.ts + shift + winMs)).length;
  const real = inWin(0); const ctrls = [-12, -6, 6, 12].map((h) => inWin(h * 3600e3));
  const ctrlMean = ctrls.reduce((a, b) => a + b, 0) / ctrls.length;
  return { eligible_targets: targets.filter((t) => t.ts >= lo).length, real, shifted_controls: ctrls, control_mean: +ctrlMean.toFixed(2), enrichment: ctrlMean ? +(real / ctrlMean).toFixed(2) : (real ? "inf" : "0/0") };
}

export function b1Verdict({ recurrentPre, change, observedAfter }) {
  if (!recurrentPre || !change) return "not-evaluated";
  return observedAfter === 0 ? "prediction-held" : "refuted";
}
export function b2Verdict(groups) {
  return groups.length >= 2 ? "split" : groups.length === 1 ? "merged(refuted)" : "not-evaluated";
}

/** B4 needs the GREEN control: an oom-kill often means "a suite was running" (fixtures OOM on purpose). */
export function b4Verdict({ enrichment: enr, greenControl }) {
  const out = { enrichment_verdict: typeof enr.enrichment === "number" && enr.enrichment >= 2 ? "OOM-associated" : "association-refuted" };
  if (greenControl && typeof enr.enrichment === "number" && typeof greenControl.enrichment === "number" && greenControl.enrichment) {
    const ratio = +(enr.enrichment / greenControl.enrichment).toFixed(2);
    out.red_over_green = ratio;
    out.verdict = ratio >= 2 ? "red-specific-OOM-association" : "not-red-specific (suite-running confound)";
  } else out.verdict = out.enrichment_verdict;
  return out;
}
export function b5Verdict(enr) {
  return (typeof enr.enrichment === "number" && enr.enrichment >= 2) || enr.enrichment === "inf" ? "restart-induced-burst" : "not-restart-associated";
}

// ── carriers ────────────────────────────────────────────────────────────────────────────────────────
function readJsonl(file, pred = () => true) {
  let malformed = 0; const rows = [];
  let lines; try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch { return { rows, malformed: 0, missing: true }; }
  lines.forEach((line, i) => { if (!line.trim()) return; let r; try { r = JSON.parse(line); } catch { malformed++; return; } if (pred(r)) rows.push({ line: i + 1, raw: line, r }); });
  return { rows, malformed, missing: false };
}

export function parseArgs(argv) {
  const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  return {
    root: path.resolve(val("--root", process.cwd())),
    cut: val("--cut", DEFAULT_CUT),
    file: val("--file", DEFAULT_B1_FILE),
    b2File: val("--b2-file", B2_FILE),
    out: val("--out", null),
    provenanceTask: val("--provenance-task", PROVENANCE_TASK_DEFAULT),
    gitRev: val("--rev", "develop"),
    json: argv.includes("--json"),
  };
}

export function runTime(opts) {
  const { root, cut, file, b2File } = opts;
  const t0 = Date.now();
  const CUT = Date.parse(cut);
  const sink = new Sink();
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  const rev = git(["rev-parse", opts.gitRev]).trim();

  // ── capture ──
  const FR = readJsonl(path.join(root, ".quay/worker-outcome.jsonl"), (r) => r.mechanical_fan_in?.step === "suite" && r.mechanical_fan_in?.outcome === "red");
  const fr = [];
  for (const { r, line, raw } of FR.rows) {
    const ft = r.mechanical_fan_in.failedTestFiles;
    const files = ft?.evaluated && Array.isArray(ft.files) && ft.files.length ? ft.files : ["<files-not-evaluated>"];
    const sigs = [...new Set(r.mechanical_fan_in.suiteSignatures || [])].sort();
    for (const f of files) fr.push({ ts: Date.parse(r.ts), iso: r.ts, task: r.task, file: f, sigs, sigKey: sigs.length ? sha256(sigs.join("\n")).slice(0, 12) : "nosig", line, lineSha: sha256(raw), wall_h: r.started_at && r.ended_at ? (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 3.6e6 : null });
  }
  const NHr = readJsonl(path.join(root, ".quay/gate-events.jsonl"), (r) => r.gate === "retreat" && r.payload?.from === "needs-human");
  const nh = NHr.rows.map(({ r, line, raw }) => ({ ts: Date.parse(r.timestamp), task: r.item_id, to: r.payload.to, line, lineSha: sha256(raw) }));

  let oom = [], oomErr = null;
  try {
    oom = execFileSync("bash", ["-c", `journalctl --utc -o short-iso-precise --since 2026-09-18 --no-pager -q | grep "Failed with result 'oom-kill'" | grep -E 'run-[ru][0-9a-z]+\\.scope'`], { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\n").filter(Boolean).map((l) => ({ ts: Date.parse(l.split(" ")[0]), unit: /(run-[ru][0-9a-z]+\.scope)/.exec(l)[1] }));
  } catch (e) { oomErr = String(e.message).slice(0, 200); }

  const anchorLines = (() => { try { return fs.readFileSync(path.join(root, ".quay/anchor.log"), "utf8").split("\n"); } catch { return []; } })();
  const dr = []; anchorLines.forEach((l, i) => { const m = /^(\d{4}-\d\d-\d\dT[\d:]+Z) anchor: kind=worker loop started/.exec(l); if (m) dr.push({ ts: Date.parse(m[1]), line: i + 1 }); });
  const orph = readJsonl(path.join(root, ".quay/worker-outcome.jsonl"), (r) => ORPHAN_RE.test(String(r.failure_reason || ""))).rows.map(({ r, line }) => ({ ts: Date.parse(r.ts), task: r.task, line }));

  // ── identity + grouping ──
  const G = groupsOf(fr);
  const recurrent = recurrentGroups(G);

  for (const g of recurrent) {
    const evRefs = g.first3.map((s) => `.quay/worker-outcome.jsonl:${/L(\d+)$/.exec(s)[1]}`);
    const firstRow = FR.rows.find((x) => x.line === Number(/L(\d+)$/.exec(g.first3[0])[1]));
    const ev = sink.add("evidence", firstRow
      ? carrierEvidence("worker-outcome suite-red grouping", ".quay/worker-outcome.jsonl", firstRow.line, firstRow.raw, { scope: g.file, flags: [g.sigKey], subject_key: g.key, provenance_task: opts.provenanceTask, reading: g })
      : { tool: "worker-outcome suite-red grouping", ref: rev, ts: new Date().toISOString(), sha256: sha256(JSON.stringify(g)), confidence: { level: "low", basis: "carrier line not resolvable" }, scope: g.file, flags: [g.sigKey], subject_key: g.key, provenance_task: opts.provenanceTask, reading: g });
    sink.add("hypothesis", { statement: `one recurring root cause behind ${g.events} suite reds on ${g.file} (${g.tasks} tasks)`, source_evidence: [ev.ref, ...evRefs], ts: new Date().toISOString(), subject_key: g.key, provenance_task: opts.provenanceTask });
  }

  // counterexamples: a file-only key would merge distinct signature groups on the same file
  const byFile = {}; for (const g of G) (byFile[g.file] ||= []).push(g);
  const fileOnlyMerges = Object.entries(byFile).filter(([f, gs]) => f !== "<files-not-evaluated>" && gs.length >= 2).map(([f, gs]) => ({ file: f, groups: gs.length, sigs: gs.map((g) => `${g.sigKey}:${g.events}`) }));
  for (const m of fileOnlyMerges) sink.add("counterexample", { counterexample_of: `one recurring root cause behind reds on ${m.file}`, source_evidence: [`scope:${m.file}`], ts: new Date().toISOString(), subject_key: subjectKey("suite-red", [m.file]), provenance_task: opts.provenanceTask, why: `a file-only key would merge ${m.groups} distinct signature groups on ${m.file}` });
  const bySig = {}; for (const g of G) if (g.sigKey !== "nosig") (bySig[g.sigKey] ||= new Set()).add(g.file);
  const crossFileSigs = Object.entries(bySig).filter(([, s]) => s.size >= 2).map(([k, s]) => ({ sigKey: k, files: s.size, sig0: G.find((g) => g.sigKey === k).sig0 }));
  for (const c of crossFileSigs) sink.add("counterexample", { counterexample_of: "same signature ⇒ same root cause", source_evidence: [`sig:${c.sigKey}`], ts: new Date().toISOString(), subject_key: `suite-red-sig#${c.sigKey}`, provenance_task: opts.provenanceTask, why: `signature ${c.sigKey} ("${c.sig0}") appears on ${c.files} different files — a signature-only key would merge unrelated failures` });

  // ── B1 (blind to any fix: only pre-cut events decide; the tool locates the change itself) ──
  const reaperPre = fr.filter((e) => e.file === file && e.ts < CUT);
  const reaperPreGroups = [...new Set(reaperPre.map((e) => e.sigKey))].map((k) => ({ sigKey: k, tasks: new Set(reaperPre.filter((e) => e.sigKey === k).map((e) => e.task)).size, max48hTasks: recurrentWindows(reaperPre.filter((e) => e.sigKey === k)) }));
  const lastPre = reaperPre.length ? Math.max(...reaperPre.map((e) => e.ts)) : null;
  let change = null;
  if (lastPre) {
    const log = git(["log", rev, "--reverse", "--format=%H %cI %s", `--since=${new Date(lastPre).toISOString()}`, "--", file]).split("\n").filter(Boolean);
    if (log.length) { const [h, ci, ...s] = log[0].split(" "); change = { commit: h.slice(0, 10), ci, subject: s.join(" ").slice(0, 100) }; }
  }
  const reaperAfter = change ? fr.filter((e) => e.file === file && e.ts > Date.parse(change.ci)) : null;
  const B1 = { file, pre_events: reaperPre.length, pre_tasks: new Set(reaperPre.map((e) => e.task)).size, pre_groups: reaperPreGroups, recurrent_pre: reaperPreGroups.some((g) => g.max48hTasks >= 2), located_change: change, prediction: "0 reds on the file after the located change", observed_after: reaperAfter ? reaperAfter.length : "not-evaluated", observation_window_h: change ? +((Date.now() - Date.parse(change.ci)) / 3.6e6).toFixed(1) : null };
  B1.verdict = b1Verdict({ recurrentPre: B1.recurrent_pre, change, observedAfter: B1.observed_after });

  // ── B2 / B3 ──
  const B2 = { file: b2File, groups: (byFile[b2File] || []).map((g) => ({ sigKey: g.sigKey, events: g.events, first: g.first, last: g.last, sig0: g.sig0 })) };
  B2.verdict = b2Verdict(B2.groups);
  const B3 = { groups_spanning_files: G.filter((g) => g.files_in_group > 1).length };

  // ── B4 / B5 ──
  const GREEN = readJsonl(path.join(root, ".quay/worker-outcome.jsonl"), (r) => r.mechanical_fan_in?.outcome === "landed").rows.map(({ r }) => ({ ts: Date.parse(r.ts) }));
  const B4 = oomErr ? { verdict: "not-evaluated", error: oomErr } : { oom_kills: oom.length, journal_from: JOURNAL_FLOOR, ...enrichment({ targets: fr.filter((e, i, a) => a.findIndex((x) => x.line === e.line) === i), triggers: oom, winMs: 30 * 60e3, lo: Date.parse(JOURNAL_FLOOR) }) };
  if (!B4.error) {
    B4.green_control = enrichment({ targets: GREEN, triggers: oom, winMs: 30 * 60e3, lo: Date.parse(JOURNAL_FLOOR) });
    Object.assign(B4, b4Verdict({ enrichment: B4, greenControl: B4.green_control }));
  }
  const B5 = { worker_loop_starts: dr.length, orphan_finalisations: orph.length, ...enrichment({ targets: orph, triggers: dr, winMs: 15 * 60e3, lo: dr.length ? dr[0].ts : 0 }) };
  B5.verdict = b5Verdict(B5);
  B5.orphan_tasks = new Set(orph.map((o) => o.task)).size;

  // ── B6 linkage ──
  const recurrentKeys = new Set(recurrent.map((g) => g.key));
  const keyOf = (e) => groupKey(e, "file+signature");
  const link = { preceded_by_recurrent_multi_task_group: 0, preceded_by_single_task_reds_only: 0, no_suite_red_in_7d: 0 };
  const linkSamples = { preceded_by_recurrent_multi_task_group: [], preceded_by_single_task_reds_only: [], no_suite_red_in_7d: [] };
  for (const r of nh) {
    const prior = fr.filter((e) => e.task === r.task && e.ts <= r.ts && e.ts >= r.ts - 7 * 86400e3);
    const cls = !prior.length ? "no_suite_red_in_7d" : prior.some((e) => recurrentKeys.has(keyOf(e))) ? "preceded_by_recurrent_multi_task_group" : "preceded_by_single_task_reds_only";
    link[cls]++; if (linkSamples[cls].length < 3) linkSamples[cls].push(`${new Date(r.ts).toISOString()} ${r.task} L${r.line}`);
  }
  const perTask = {}; for (const r of nh) perTask[r.task] = (perTask[r.task] || 0) + 1;
  const B6 = { retreats: nh.length, distinct_tasks: Object.keys(perTask).length, tasks_with_repeat_cycles: Object.values(perTask).filter((n) => n >= 2).length, max_cycles: Math.max(0, ...Object.values(perTask)), link, linkSamples };

  // ── B1..B6 outcome records (every one validated by the store) ──
  const b1H = sink.add("hypothesis", { statement: `the located change ${change ? change.commit : "(none)"} fixed the recurrent suite reds on ${file}`, source_evidence: [rev], ts: new Date().toISOString(), subject_key: subjectKey("suite-red", [file]), provenance_task: opts.provenanceTask });
  sink.add("outcome", { experiment_ref: b1H.statement, verdict: B1.verdict === "prediction-held" ? "supported" : B1.verdict === "refuted" ? "refuted" : "not-evaluated", rule_verdict: `B1:${B1.verdict}`, ts: new Date().toISOString(), subject_key: subjectKey("suite-red", [file]), provenance_task: opts.provenanceTask });
  const b2H = sink.add("hypothesis", { statement: `a file-only grouping key is sufficient for ${b2File}`, source_evidence: [rev], ts: new Date().toISOString(), subject_key: subjectKey("suite-red", [b2File]), provenance_task: opts.provenanceTask });
  if (B2.verdict === "split") sink.add("counterexample", { counterexample_of: b2H.statement, source_evidence: [`scope:${b2File}`], ts: new Date().toISOString(), subject_key: subjectKey("suite-red", [b2File]), provenance_task: opts.provenanceTask, why: `${B2.groups.length} distinct signature groups on the same file` });
  sink.add("outcome", { experiment_ref: b2H.statement, verdict: B2.verdict === "split" ? "refuted" : B2.verdict === "merged(refuted)" ? "supported" : "not-evaluated", rule_verdict: `B2:${B2.verdict}`, ts: new Date().toISOString(), subject_key: subjectKey("suite-red", [b2File]), provenance_task: opts.provenanceTask });
  const b4H = (B4.error || !B4.verdict) ? null : sink.add("hypothesis", { statement: "a host oom-kill causes suite reds", source_evidence: [rev], ts: new Date().toISOString(), subject_key: "time-semantics:oom-red", provenance_task: opts.provenanceTask });
  if (b4H) sink.add("outcome", { experiment_ref: b4H.statement, verdict: B4.verdict.startsWith("not-red-specific") ? "refuted" : B4.verdict === "red-specific-OOM-association" ? "supported" : "undetermined", rule_verdict: `B4:${B4.verdict}`, ts: new Date().toISOString(), subject_key: "time-semantics:oom-red", provenance_task: opts.provenanceTask });
  const b5H = sink.add("hypothesis", { statement: "orphan finalisations are a per-task recurring defect", source_evidence: [rev], ts: new Date().toISOString(), subject_key: "time-semantics:orphan-burst", provenance_task: opts.provenanceTask });
  sink.add("outcome", { experiment_ref: b5H.statement, verdict: B5.verdict === "restart-induced-burst" ? "refuted" : "undetermined", rule_verdict: `B5:${B5.verdict}`, ts: new Date().toISOString(), subject_key: "time-semantics:orphan-burst", provenance_task: opts.provenanceTask });

  const cost = { wall_ms: Date.now() - t0 };
  const capture = { suite_red_rows: FR.rows.length, suite_red_events_by_file: fr.length, malformed: FR.malformed, nh: nh.length, oom: oom.length, worker_loop_starts: dr.length, orphan_finalisations: orph.length };
  const grouping = { key_by: GROUP_KEY_BY, groups: G.length, recurrent: recurrent.length, file_only_merge_counterexamples: fileOnlyMerges.length, cross_file_signature_counterexamples: crossFileSigs.length, top_recurrent: [...recurrent].sort((a, b) => b.tasks - a.tasks).slice(0, 8) };
  return { tool: TOOL, head: rev, cut, cost, capture, grouping, B1, B2, B3, B4, B5, B6, fileOnlyMerges: fileOnlyMerges.slice(0, 8), crossFileSigs: crossFileSigs.slice(0, 5), validator: sink.validator, sink };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
export function cli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const out = runTime(opts);
  const outFile = opts.out ?? path.join(opts.root, ".quay/arch-discovery-shadow/time-records.jsonl");
  out.sink.write(outFile);
  const { sink, ...rest } = out;
  if (opts.json) { console.log(JSON.stringify({ ...rest, out: outFile }, null, 1)); return 0; }
  console.log(`arch-discovery-time: head=${out.head.slice(0, 9)} cut=${out.cut} groups=${out.grouping.groups} recurrent=${out.grouping.recurrent} wall_ms=${out.cost.wall_ms}`);
  console.log(`capture: ${JSON.stringify(out.capture)}`);
  console.log(`B1 ${out.B1.verdict}: file=${out.B1.file} pre_events=${out.B1.pre_events} pre_tasks=${out.B1.pre_tasks} change=${out.B1.located_change ? out.B1.located_change.commit + " " + out.B1.located_change.ci : "none"} observed_after=${out.B1.observed_after} window_h=${out.B1.observation_window_h}`);
  console.log(`B2 ${out.B2.verdict}: ${JSON.stringify(out.B2.groups.map((g) => ({ sigKey: g.sigKey, events: g.events, first: g.first })))}`);
  console.log(`B3 groups_spanning_files=${out.B3.groups_spanning_files}`);
  if (out.B4.error) console.log(`B4 not-evaluated: ${out.B4.error}`);
  else console.log(`B4 ${out.B4.verdict}: oom_kills=${out.B4.oom_kills} eligible=${out.B4.eligible_targets} real=${out.B4.real} control_mean=${out.B4.control_mean} enrichment=${out.B4.enrichment} green_enrichment=${out.B4.green_control.enrichment} red_over_green=${out.B4.red_over_green}`);
  console.log(`B5 ${out.B5.verdict}: worker_loop_starts=${out.B5.worker_loop_starts} orphan_finalisations=${out.B5.orphan_finalisations} real=${out.B5.real} control_mean=${out.B5.control_mean} enrichment=${out.B5.enrichment} orphan_tasks=${out.B5.orphan_tasks}`);
  console.log(`B6: retreats=${out.B6.retreats} distinct_tasks=${out.B6.distinct_tasks} repeat_cycles=${out.B6.tasks_with_repeat_cycles} max_cycles=${out.B6.max_cycles} link=${JSON.stringify(out.B6.link)}`);
  console.log(`records → ${outFile}  validator: accepted=${sink.validator.accepted} refused=${sink.validator.refused} ${JSON.stringify(sink.validator.reasons)}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(cli());
}
