#!/usr/bin/env node
// HISTORICAL REPOSITORY / TOOL REPLAY — the agentic variant of the GOAL-03x benchmark.
//
// The rich-bundle benchmark is a CONTROLLED APPROXIMATION: the evidence is chosen for the model. Here the
// agent gets what a human investigator had — a read-only checkout of the repository AT the decision-cutoff
// commit plus the ArchGuard snapshot of that commit — and decides for itself what to look at.
//
//   A = claude-fjdac + v4.1flash-anthropic     B = claude + opus     (same fixture-profile separation as the
//                                                                    other runners; repo profiles.yml untouched)
//
// SANDBOX (verified by --probe, not assumed):
//   • cwd = a detached git worktree of the cutoff commit (stage A → T0 commit, stage B → T1 commit);
//     CLAUDE.md / .claude/ / archguard history are stripped so the agent's context is identical across runs;
//   • tools = Read, Grep, Glob + ONE Bash command (the archq.sh wrapper, which pins --arch-dir and forwards
//     query flags only). Write/Edit/NotebookEdit/Web*/git are not available or are denied;
//   • permission mode dontAsk (anything not pre-approved is denied, never prompted); explicit deny rules for
//     the main checkout (where reference/outcome live), ~/.claude (session transcripts), and every OTHER
//     replay tree (a later commit would be future knowledge);
//   • a tool-call cap enforced by this runner (the CLI in this build has no max-turns flag);
//   • --output-format stream-json → a TOOL TRACE (every call, every result head) is the primary record.
//
// Stage A: investigate, then report concerns (no confirmed concern given).
// Stage B: confirmed concern given, T1 findings NOT given — the agent must do the investigation itself
//          (harder than the dossier's stage B, which hands over the findings; reported separately).
//
// Usage: node docs/analysis/ownership-tool-replay.mjs --probe [--group A|B]
//        node docs/analysis/ownership-tool-replay.mjs [--case GOAL-032] [--stage A|B] [--group A|B] [--cap 45]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchArgv } from "../../plugin/scripts/driver-runtime.ts";
import { GROUPS, makeFixtureRoots } from "./ownership-shadow-ab-runtime-model.mjs";
import { parseJson } from "./ownership-two-stage-ab.mjs";
import { stageAInstructions, stageBInstructions, richInstructions, scoreStageA, scoreStageB } from "./ownership-two-stage-evaluator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CUT = "/data/scratch/yale/replay-cutoffs";
const TOOLS = path.join(CUT, "_tools");
const ARCHQ = path.join(TOOLS, "archq.sh");
const ARCHGUARD_CLI = "/data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js";
const OUT_JSON = path.join(HERE, "ownership-tool-replay-results.json");
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, "rich-dossier-spec.json"), "utf8"));
const CASES = ["GOAL-032", "GOAL-033"];
const sha16 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

const GATEWAY_ENV = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"];

// ── sandbox ────────────────────────────────────────────────────────────────────────────────────
export function writeArchq() {
  fs.mkdirSync(TOOLS, { recursive: true });
  fs.writeFileSync(ARCHQ, [
    "#!/bin/bash",
    "# archq — READ-ONLY ArchGuard query over the prebuilt snapshot of the CURRENT directory's commit.",
    "# Pins --arch-dir; refuses any attempt to redirect it. Forwards query flags only.",
    'ARCH="$PWD/.archguard"',
    '[ -d "$ARCH/query" ] || { echo "archq: no snapshot in $PWD" >&2; exit 2; }',
    'for a in "$@"; do case "$a" in --arch-dir|--arch-dir=*|--help|-h) echo "archq: $a is not available" >&2; exit 2;; esac; done',
    `exec node ${ARCHGUARD_CLI} query --arch-dir "$ARCH" "$@"`,
    "",
  ].join("\n"), { mode: 0o755 });
}

/** Prepare (idempotently) the replay tree for a (case, stage). Returns {dir, commit, ...provenance}. */
export function prepareTree(caseId, stage) {
  const c = SPEC.cases[caseId];
  const commit = stage === "A" ? c.t0_commit : c.t1_commit;
  const t1dir = path.join(CUT, caseId);
  const dir = commit === c.t1_commit ? t1dir : path.join(CUT, `${caseId}-T0`);
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== commit) throw new Error(`${dir} is at ${head.slice(0, 9)}, expected ${commit.slice(0, 9)}`);
  const removed = [];
  for (const rel of ["CLAUDE.md", ".claude", ".archguard/output", ".archguard/cache", ".archguard/metrics-history.jsonl"]) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(rel); }
  }
  let snapshot = "built-on-this-commit";
  if (dir !== t1dir) {
    // The T0 commit's ArchGuard snapshot is the T1 tree's snapshot; legitimate only if the scanned code is identical.
    const differing = execFileSync("git", ["-C", REPO, "diff", "--name-only", c.analysis_commit, commit, "--", ...SPEC.scanned_dirs], { encoding: "utf8" }).split("\n").filter(Boolean);
    fs.rmSync(path.join(dir, ".archguard"), { recursive: true, force: true });
    fs.cpSync(path.join(t1dir, ".archguard"), path.join(dir, ".archguard"), { recursive: true });
    for (const rel of [".archguard/output", ".archguard/cache", ".archguard/metrics-history.jsonl"]) fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
    snapshot = `copied from the T1 tree; scanned code differs in ${differing.length} file(s): ${differing.join(", ") || "none"}`;
  }
  if (!fs.existsSync(path.join(dir, ".archguard", "query"))) throw new Error(`no ArchGuard snapshot in ${dir}`);
  return { dir, commit, removed_from_tree: removed, archguard_snapshot: snapshot };
}

export function permissionSettings(currentDir) {
  const others = fs.readdirSync(CUT, { withFileTypes: true }).filter((e) => e.isDirectory() && path.join(CUT, e.name) !== currentDir).map((e) => `//${path.join(CUT, e.name).slice(1)}/**`);
  const deny = [];
  for (const t of ["Read", "Grep", "Glob"]) for (const g of ["//data/home/**", ...others]) deny.push(`${t}(${g})`);
  deny.push("Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Bash(git:*)", "Bash(rm:*)", "Bash(cp:*)", "Bash(mv:*)");
  return {
    permissions: { defaultMode: "dontAsk", allow: ["Read", "Grep", "Glob", `Bash(${ARCHQ}:*)`], deny },
    hooks: {},
  };
}

// ── trace ──────────────────────────────────────────────────────────────────────────────────────
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : x?.text || "")).join("\n") : "");

/** Fold stream-json events into a per-call trace + a summary. Exported so it can be unit-tested on canned events. */
export function summarizeTrace(events) {
  const calls = []; const byId = new Map();
  let final = null; let turns = 0;
  for (const e of events) {
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      turns++;
      for (const b of e.message.content) if (b.type === "tool_use") { const c = { id: b.id, tool: b.name, input: b.input || {}, ok: null, denied: false, result_chars: 0, result_head: "" }; calls.push(c); byId.set(b.id, c); }
    } else if (e.type === "user" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) if (b.type === "tool_result" && byId.has(b.tool_use_id)) {
        const c = byId.get(b.tool_use_id); const txt = textOf(b.content);
        c.ok = !b.is_error; c.result_chars = txt.length; c.result_head = txt.slice(0, 240);
        c.denied = !!b.is_error && /permission|denied|not allowed|requested permissions|don't have permission|not available|disallowed/i.test(txt);
        c.result_text = txt;
      }
    } else if (e.type === "result") final = e;
  }
  const by = (t) => calls.filter((c) => c.tool === t);
  const filesRead = [...new Set(by("Read").filter((c) => c.ok).map((c) => c.input.file_path))];
  const archq = calls.filter((c) => c.tool === "Bash" && String(c.input.command || "").includes("archq.sh"));
  const summary = {
    tool_calls: calls.length, assistant_turns: turns,
    by_tool: Object.fromEntries([...new Set(calls.map((c) => c.tool))].map((t) => [t, by(t).length])),
    files_read: filesRead, distinct_files_read: filesRead.length,
    grep_patterns: by("Grep").map((c) => c.input.pattern),
    glob_patterns: by("Glob").map((c) => c.input.pattern),
    archq_commands: archq.map((c) => String(c.input.command).replace(ARCHQ, "archq")),
    denied_attempts: calls.filter((c) => c.denied).map((c) => ({ tool: c.tool, input: JSON.stringify(c.input).slice(0, 160), why: c.result_head.slice(0, 120) })),
    errors: calls.filter((c) => c.ok === false && !c.denied).length,
    result_subtype: final?.subtype || null, cli_num_turns: final?.num_turns ?? null,
    cli_duration_ms: final?.duration_ms ?? null, cost_usd_reported: final?.total_cost_usd ?? null,
    usage: final?.usage ? { input_tokens: final.usage.input_tokens, output_tokens: final.usage.output_tokens, cache_read: final.usage.cache_read_input_tokens, cache_create: final.usage.cache_creation_input_tokens } : null,
  };
  return { calls, summary, final_text: typeof final?.result === "string" ? final.result : "" };
}

/** Everything the tools returned, as one string: the corpus an answer's file mentions are checked against. */
export const corpusFromCalls = (calls) => calls.map((c) => `${JSON.stringify(c.input)}\n${c.result_text || ""}`).join("\n");

/** A cited ref is GROUNDED if it points at a path the agent actually opened or that appeared in a tool result. */
export function groundingFromTrace(refs, calls, treeDir) {
  const opened = new Set(calls.filter((c) => c.tool === "Read" && c.ok).map((c) => String(c.input.file_path).replace(treeDir + "/", "")));
  const corpus = corpusFromCalls(calls);
  const rows = (refs || []).map((r) => {
    const s = String(r);
    if (/^archq\b/i.test(s)) return { ref: s, kind: "archq", grounded: calls.some((c) => c.tool === "Bash" && String(c.input.command).includes("archq.sh")) };
    const m = s.match(/^(?:\.\/)?([^\s:#]+?)(?::\d+(?:-\d+)?)?(?:\s|$|:)/) || s.match(/^(?:\.\/)?([^\s:#]+)/);
    const p = m ? m[1].replace(treeDir + "/", "") : s;
    const exists = fs.existsSync(path.join(treeDir, p));
    return { ref: s, kind: "path", path: p, exists_in_tree: exists, opened: opened.has(p), seen_in_tool_output: corpus.includes(p), grounded: exists && (opened.has(p) || corpus.includes(p)) };
  });
  return { cited: rows.length, grounded: rows.filter((r) => r.grounded).length, ungrounded: rows.filter((r) => !r.grounded).map((r) => r.ref).slice(0, 8) };
}

// ── prompts ────────────────────────────────────────────────────────────────────────────────────
export function buildToolPrompt(caseId, stage, tree) {
  const base = stage === "A" ? stageAInstructions(caseId) : stageBInstructions(caseId);
  const rich = richInstructions(caseId, stage);                 // for the response schema (B asks for evidence_refs)
  const schema = stage === "A" ? base.task.response_schema : rich.task.response_schema;
  const instr = base.task.instructions
    .replace("the state below", "the repository you can inspect")
    .replace(/Cite only the listed evidence refs; do not invent readings\./, "Cite only things you actually looked at; do not invent readings.");
  const lines = [
    `# ${caseId} — stage ${stage} (${base.stage_name}) — REPOSITORY / TOOL REPLAY`,
    `cutoff: ${base.cutoff}  (${base.cutoff_label});  commit: ${tree.commit.slice(0, 12)}`,
    "",
    "You are investigating a repository exactly as it stood at the commit above. Your working directory is a READ-ONLY checkout of that commit; nothing later than it exists for you.",
    "Tools: Read, Grep, Glob, and ONE shell command — the ArchGuard query wrapper:",
    `    ${ARCHQ} <flags>        e.g. --list-scopes | --scope <key> --cycles --output-scope package | --scope <key> --file <path> | --scope <key> --deps-of <Entity> | --scope <key> --used-by <Entity> | --scope <key> --package-stats 3 | --scope <key> --high-coupling`,
    "It reads a prebuilt architecture snapshot of exactly this commit. You cannot write files, run code, use git, or reach the network.",
    "Budget: aim for roughly 25-40 tool calls; stop investigating once you can answer, then answer.",
    "",
    instr,
    "",
  ];
  if (stage === "B") lines.push("## CONFIRMED CONCERN", base.confirmed_concern, "", "(The investigation findings are NOT given to you here — establish what you need from the repository.)", "");
  lines.push(
    "## How to cite evidence",
    'evidence_refs entries must be things you actually looked at: "relative/path.ts:line" for code, or "archq: <flags you ran>".',
    "",
    "## Questions", ...base.task.questions.map((q) => `- ${q}`), "",
    "## Required response JSON schema", JSON.stringify(schema, null, 2), "",
    "Your final message must be the JSON object only.",
  );
  return lines.join("\n");
}

// ── run one cell ───────────────────────────────────────────────────────────────────────────────
function runStreaming({ argv, cwd, env, prompt, timeoutMs, cap }) {
  return new Promise((resolve) => {
    const events = []; let buf = ""; let stderr = ""; let toolUses = 0; let capHit = false; let timedOut = false;
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d.toString("utf8"); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line); events.push(e);
          if (e.type === "assistant") for (const b of e.message?.content || []) if (b.type === "tool_use") toolUses++;
          if (toolUses > cap && !capHit) { capHit = true; try { child.kill("SIGTERM"); } catch { /* gone */ } }
        } catch { /* non-JSON line */ }
      }
    });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.stdin.on("error", () => {}); child.stdin.end(prompt);
    child.on("close", (code) => { clearTimeout(timer); resolve({ events, code, stderr, capHit, timedOut }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ events, code: null, stderr: String(err), capHit, timedOut }); });
  });
}

export async function runCell({ caseId, stage, group, roots, cap = 45, timeoutMs = 1_200_000, promptOverride = null }) {
  const tree = prepareTree(caseId, stage);
  const prompt = promptOverride || buildToolPrompt(caseId, stage, tree);
  const argv = launchArgv(group.role, prompt, roots[group.id], { promptViaStdin: true });
  const settings = JSON.stringify(permissionSettings(tree.dir));
  const extra = ["--output-format", "stream-json", "--verbose", "--tools", "Read,Grep,Glob,Bash", "--settings", settings, "--setting-sources", "project", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"];
  argv.splice(argv.length - 1, 0, ...extra);                                 // flags precede the trailing -p
  const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  if (group.dropsGatewayEnv) for (const k of GATEWAY_ENV) delete env[k];
  const t0 = Date.now();
  const r = await runStreaming({ argv, cwd: tree.dir, env, prompt, timeoutMs, cap });
  const ms = Date.now() - t0;
  const { calls, summary, final_text } = summarizeTrace(r.events);
  const mi = argv.indexOf("--model");
  const response = parseJson(final_text);
  const rec = {
    case_id: caseId, stage, group: group.id, mode: "tool-replay",
    provenance: {
      role: group.role, launcher: argv[0], model_from_profile: group.model, model_flag_in_argv: mi >= 0 ? argv[mi + 1] : null,
      gateway_env_dropped: group.dropsGatewayEnv, prompt_sha256_16: sha16(prompt), prompt_bytes: Buffer.byteLength(prompt, "utf8"),
      tree: { dir: tree.dir, commit: tree.commit, removed_from_tree: tree.removed_from_tree, archguard_snapshot: tree.archguard_snapshot },
      sandbox: { tools: "Read,Grep,Glob,Bash(archq only)", permission_mode: "dontAsk", tool_call_cap: cap, setting_sources: "project (stripped)", claude_md: "disabled" },
      claude_cli_version: (() => { try { return execFileSync("claude", ["--version"], { encoding: "utf8", env }).trim(); } catch { return null; } })(),
      started_at: new Date(t0).toISOString(), duration_ms: ms,
    },
    state: response ? "verified" : "not-evaluated",
    exit_status: r.code, cap_hit: r.capHit, timed_out: r.timedOut, stderr_tail: r.stderr.slice(-400),
    trace_summary: summary,
    trace: calls.map(({ result_text, ...c }) => c),
    response,
  };
  if (response) {
    const corpusText = corpusFromCalls(calls);
    const o = { variant: "tool", corpusText, cutoffCommit: tree.commit };
    rec.scores = stage === "A" ? scoreStageA(caseId, response, undefined, o) : scoreStageB(caseId, response, undefined, { ...o, sliceBasis: "union" });
    if (stage === "B") rec.scores_first_basis = scoreStageB(caseId, response, undefined, { ...o, sliceBasis: "first" });
    const refs = stage === "A" ? (response.concerns || []).flatMap((c) => c?.evidence_refs || []) : response.evidence_refs || [];
    rec.trace_grounding = groundingFromTrace(refs, calls, tree.dir);
  }
  return rec;
}

// ── probe: PROVE the sandbox, don't assume it ──────────────────────────────────────────────────
const PROBE = (tree) => [
  "This is a sandbox self-test. Perform EVERY numbered step below by actually calling the tool; do not skip a step because you expect it to fail. After each step continue with the next. Finish with the single word DONE.",
  "1. Read the file /data/home/yale/work/quay/CLAUDE.md",
  "2. Read the file /data/home/yale/work/quay/plugin/fixtures/meta-driver-replay/GOAL-033/reference.json",
  "3. Grep for the pattern  selected_slice  in the directory /data/home/yale/work/quay/plugin/fixtures",
  `4. Read the file ${CUT}/GOAL-030/plugin/scripts/ready-pool-check.ts (a different replay tree)`,
  "5. Write a file named probe.txt in the current directory containing the word hi",
  "6. Run the shell command:  ls /",
  "7. Run the shell command:  git log --oneline -3",
  `8. Run the shell command:  ${ARCHQ} --list-scopes`,
  `9. Run the shell command:  ${ARCHQ} --list-scopes ; cat /etc/hostname`,
  `10. Run the shell command:  ${ARCHQ} --arch-dir /data/home/yale/work/quay/.archguard --list-scopes`,
  "11. Use Glob with pattern  packages/quay/src/kernel/*.ts",
  "12. Read the first file Glob returned.",
  "13. Read the file /data/home/yale/.claude/projects/-data-home-yale-work-quay/6a148da5-d846-4e61-ad6c-96377b8bc7d5.jsonl",
].join("\n");

async function probe(groupId) {
  writeArchq();
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-probe-"));
  const roots = makeFixtureRoots(baseDir);
  const tree = prepareTree("GOAL-032", "B");
  const rec = await runCell({ caseId: "GOAL-032", stage: "B", group: GROUPS[groupId], roots, cap: 30, timeoutMs: 600_000, promptOverride: PROBE(tree) });
  fs.rmSync(baseDir, { recursive: true, force: true });
  const rows = rec.trace.map((c, i) => `${String(i + 1).padStart(2)} ${c.tool.padEnd(5)} ${(c.ok ? "OK    " : c.denied ? "DENIED" : "ERROR ")} ${JSON.stringify(c.input).slice(0, 110)}  ⇒ ${c.result_head.replace(/\n/g, " ").slice(0, 90)}`);
  const PROBE_JSON = OUT_JSON.replace(/\.json$/, "-probe.json");
  const prior = fs.existsSync(PROBE_JSON) ? JSON.parse(fs.readFileSync(PROBE_JSON, "utf8")) : { probes: {} };
  prior.probes[groupId] = { launcher: rec.provenance.launcher, model_flag: rec.provenance.model_flag_in_argv, calls: rec.trace_summary.tool_calls, denied: rec.trace_summary.denied_attempts.length, probe_file_created: fs.existsSync(path.join(rec.provenance.tree.dir, "probe.txt")), trace: rec.trace.map((c) => ({ tool: c.tool, input: JSON.stringify(c.input).slice(0, 200), ok: c.ok, denied: c.denied, result_head: c.result_head.slice(0, 120) })) };
  fs.writeFileSync(PROBE_JSON, JSON.stringify(prior, null, 2) + "\n", "utf8");
  process.stdout.write(`probe group ${groupId}: ${rec.trace_summary.tool_calls} calls, denied=${rec.trace_summary.denied_attempts.length}, probe.txt exists in tree: ${fs.existsSync(path.join(rec.provenance.tree.dir, "probe.txt"))}\n${rows.join("\n")}\n`);
  return rec;
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  if (process.argv.includes("--probe")) { await probe(arg("--group", "A")); return; }
  writeArchq();
  const cap = Number(arg("--cap", 45));
  const cases = arg("--case", null) ? [arg("--case")] : CASES;
  const stages = arg("--stage", null) ? [arg("--stage")] : ["A", "B"];
  const groups = arg("--group", null) ? [GROUPS[arg("--group")]] : Object.values(GROUPS);
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-replay-"));
  const roots = makeFixtureRoots(baseDir);
  const runs = [];
  if (process.argv.includes("--resume") && fs.existsSync(OUT_JSON + ".partial")) {
    runs.push(...JSON.parse(fs.readFileSync(OUT_JSON + ".partial", "utf8")).runs.filter((r) => r.state === "verified" || r.cap_hit === true));   // a cap-hit is a REAL outcome (no convergence within budget), not an infra failure — never silently re-rolled
    process.stderr.write(`  resumed ${runs.length} banked cells\n`);
  }
  for (const caseId of cases) for (const stage of stages) for (const g of groups) {
    const want = sha16(buildToolPrompt(caseId, stage, prepareTree(caseId, stage)));
    if (runs.some((r) => r.case_id === caseId && r.stage === stage && r.group === g.id && r.provenance.prompt_sha256_16 === want)) continue;
    process.stderr.write(`  ${caseId} stage${stage} ${g.id} ... `);
    const rec = await runCell({ caseId, stage, group: g, roots, cap });
    runs.push(rec);
    try { fs.writeFileSync(OUT_JSON + ".partial", JSON.stringify({ partial: true, runs }, null, 2)); } catch { /* ignore */ }
    process.stderr.write(`${rec.state} ${rec.provenance.duration_ms}ms calls=${rec.trace_summary.tool_calls} files=${rec.trace_summary.distinct_files_read}${rec.cap_hit ? " CAP-HIT" : ""}${rec.timed_out ? " TIMEOUT" : ""}\n`);
  }
  const cells = {};
  for (const caseId of cases) for (const stage of stages) {
    const hs = [...new Set(runs.filter((r) => r.case_id === caseId && r.stage === stage).map((r) => r.provenance.prompt_sha256_16))];
    cells[`${caseId}:${stage}`] = { prompt_shas: hs, identical_across_groups: hs.length === 1 };
  }
  const out = {
    experiment: "ownership benchmark — HISTORICAL REPOSITORY / TOOL REPLAY — runtime+model A/B",
    mode: "tool-replay", groups: { A: { launcher: GROUPS.A.launcher, model: GROUPS.A.model }, B: { launcher: GROUPS.B.launcher, model: GROUPS.B.model } },
    controls: { profiles_carrier: "fixture .quay/profiles.yml under a temp root; repo carrier untouched", sandbox: "see header of ownership-tool-replay.mjs; verified by --probe", scoring: "no single total; trace + per-dimension" },
    harness_self_test: { prompts_identical_across_groups_per_cell: Object.values(cells).every((v) => v.identical_across_groups), cells },
    tool_call_cap: cap, runs,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");
  process.stderr.write(`\nwrote ${OUT_JSON}\nself-test (identical prompts per cell): ${out.harness_self_test.prompts_identical_across_groups_per_cell}\n`);
  fs.rmSync(baseDir, { recursive: true, force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
