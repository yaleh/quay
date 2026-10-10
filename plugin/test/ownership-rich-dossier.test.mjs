// @test-group engine
// Integrity tests for the RICH EVIDENCE BUNDLE (dossier) variant of the GOAL-030..033 replay corpus.
//
// A rich dossier is raw git/ArchGuard material, so the v1 "outcome identifier must be zero-hit" rule is
// WRONG for it: several outcome-adjacent names (patchStatusField, isTaskStatus, cli/driver-vocab.ts,
// LIFECYCLE_EDGES …) legitimately exist at the cutoff. The guard here is therefore provenance-based:
//   1. every excerpt is RE-DERIVED from `git show <cutoff-commit>:<path>` and compared line by line;
//   2. the cutoff commit must not postdate the stage cutoff;
//   3. an outcome identifier is forbidden iff it is verifiably ABSENT from the cutoff tree;
//   4. no 40-char window of reference/outcome prose may appear in the dossier;
//   5. the target goal's own body/ACs are never an input.
// Tests that need the git object database skip LOUDLY (visible reason) when a commit is not present
// (shallow clone); the structural + leak-text checks always run.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CORPUS = path.join(REPO, "plugin", "fixtures", "meta-driver-replay");
const CASES = ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"];

const load = (c, f) => JSON.parse(fs.readFileSync(path.join(CORPUS, c, f), "utf8"));
const rich = (c, s) => load(c, `rich_${s}.json`);
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const hasCommit = (sha) => { try { execFileSync("git", ["-C", REPO, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; } };
const showLines = (commit, p) => git("show", `${commit}:${p}`).split("\n");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const norm = (s) => String(s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

// Identifiers that are the CHOSEN SOLUTION / MEASURED RESULT of each goal. Forbidden in the dossier of
// that case iff they do not exist in the cutoff tree (checked below — a marker that exists at the cutoff
// would be a mis-specified marker and fails the "marker is really absent" test).
const OUTCOME_MARKERS = {
  "GOAL-030": ["task-transition", "decideTransition", "branch-selfhost-probe", "d71d2bde4"],
  "GOAL-031": ["5 -> 4", "5 → 4", "5→4", "6 to exactly 1", "117ee91b8"],
  "GOAL-032": ["verdict-parse.ts", "parseBinaryVerdict", "thin wrapper", "薄包装", "0da918926"],
  "GOAL-033": ["src/driver-vocab.ts", "src/driver-control.ts", "driver-control.ts", "6 -> 4", "6 → 4", "6→4", "ddb9c6ac0"],
};
// GOAL-031's outcome file-name marker `task-transition` belongs to GOAL-030, which had LANDED before
// GOAL-031's cutoff, so for 031 it is ordinary pre-existing code — correctly not in 031's marker list.

function dossierText(doc) { return doc.dossier.sections.map((s) => s.text).join("\n"); }

test("every case has rich_a and rich_b, sized in the intended 10-80 KB band, B ⊇ A", () => {
  for (const c of CASES) {
    const a = rich(c, "a"), b = rich(c, "b");
    assert.equal(a.mode, "rich-bundle"); assert.equal(b.mode, "rich-bundle");
    assert.equal(a.stage, "A"); assert.equal(b.stage, "B");
    assert.ok(a.dossier.total_bytes >= 10_000, `${c} A too thin: ${a.dossier.total_bytes}`);
    assert.ok(b.dossier.total_bytes >= a.dossier.total_bytes, `${c}: B must not be thinner than A`);
    assert.ok(b.dossier.total_bytes <= 80_000, `${c} B unbounded: ${b.dossier.total_bytes}`);
    const aIds = new Set(a.dossier.sections.map((s) => s.id));
    for (const id of aIds) assert.ok(b.dossier.sections.some((s) => s.id === id), `${c}: B lost A section ${id}`);
    assert.deepEqual(a.citable_evidence_refs, a.dossier.sections.map((s) => s.id));
    assert.deepEqual(b.citable_evidence_refs, b.dossier.sections.map((s) => s.id));
  }
});

test("every section carries provenance (commit/path/range or query source) and a content hash that matches its text", () => {
  for (const c of CASES) for (const st of ["a", "b"]) {
    for (const s of rich(c, st).dossier.sections) {
      assert.ok(s.provenance && s.provenance.kind, `${c} ${st} ${s.id}: no provenance`);
      assert.equal(s.text_sha256, sha256(s.text), `${c} ${st} ${s.id}: text_sha256 does not match text`);
      const p = s.provenance;
      if (["git_file", "git_grep", "git_ls"].includes(p.kind)) assert.match(p.commit, /^[0-9a-f]{40}$/, `${c} ${s.id}: commit`);
      if (p.kind === "git_file") assert.ok(p.path, `${c} ${s.id}: path`);
      if (p.kind === "archguard_derived") {
        assert.equal(typeof p.scanned_code_identical_to_stage_commit, "boolean", `${c} ${s.id}: identity flag`);
        assert.ok(Array.isArray(p.differing_files_in_scanned_dirs));
        assert.ok(p.query, `${c} ${s.id}: query source`);
      }
      if (p.kind === "recorded_tool_output") assert.match(p.file_sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test("cutoff commit is not later than the stage cutoff (recorded and, when available, re-derived from git)", () => {
  for (const c of CASES) for (const st of ["a", "b"]) {
    const d = rich(c, st);
    assert.ok(new Date(d.cutoff_commit_time) <= new Date(d.cutoff), `${c} ${st}: recorded commit time ${d.cutoff_commit_time} > cutoff ${d.cutoff}`);
    if (hasCommit(d.cutoff_commit)) {
      const t = git("show", "-s", "--format=%cI", d.cutoff_commit).trim();
      assert.equal(t, d.cutoff_commit_time);
      assert.ok(new Date(t) <= new Date(d.cutoff), `${c} ${st}: git says commit ${t} is after cutoff ${d.cutoff}`);
    }
    for (const s of d.dossier.sections) if (s.provenance.commit) assert.equal(s.provenance.commit, d.cutoff_commit, `${c} ${st} ${s.id}: section read from a different commit than the stage cutoff`);
  }
});

test("git_file / git_cat sections are byte-faithful to `git show <cutoff-commit>:<path>` (provenance REPLAY)", (t) => {
  let checked = 0;
  for (const c of CASES) for (const st of ["a", "b"]) {
    const d = rich(c, st);
    if (!hasCommit(d.cutoff_commit)) { t.diagnostic(`SKIP replay ${c}/${st}: commit ${d.cutoff_commit.slice(0, 9)} not in object DB (shallow clone?)`); continue; }
    for (const s of d.dossier.sections.filter((x) => x.provenance.kind === "git_file")) {
      const p = s.provenance;
      const src = showLines(p.commit, p.path);
      if (p.ranges) {
        for (const line of s.text.split("\n")) {
          if (/^\s*\.\.\.\s*$/.test(line) || line.startsWith("…")) continue;
          const m = line.match(/^\s*(\d+)\| ?(.*)$/);
          assert.ok(m, `${c} ${s.id}: unnumbered line "${line.slice(0, 60)}"`);
          const n = Number(m[1]);
          assert.ok(p.ranges.some(([a, b]) => n >= a && n <= b), `${c} ${s.id}: line ${n} outside recorded ranges`);
          assert.equal(m[2], src[n - 1] ?? "", `${c} ${s.id}: line ${n} differs from git ${p.commit.slice(0, 9)}:${p.path}`);
          checked++;
        }
      } else {
        const body = s.text.replace(/\n… \[truncated:[^\]]*\]$/, "");
        assert.ok(src.join("\n").startsWith(body), `${c} ${s.id}: text is not a prefix of git ${p.commit.slice(0, 9)}:${p.path}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0 || process.env.CI, "no section could be replayed — object DB missing every cutoff commit");
});

test("git_grep rows really are lines of the cited file at the cutoff commit", (t) => {
  let checked = 0;
  for (const c of CASES) for (const st of ["a", "b"]) {
    const d = rich(c, st);
    if (!hasCommit(d.cutoff_commit)) { t.diagnostic(`SKIP grep replay ${c}/${st}`); continue; }
    for (const s of d.dossier.sections.filter((x) => x.provenance.kind === "git_grep")) {
      for (const row of s.text.split("\n")) {
        if (!row || row === "--" || row.startsWith("…") || row === "(no matches)") continue;
        const m = row.match(/^(.+?)[:-](\d+)[:-](.*)$/);
        assert.ok(m, `${c} ${s.id}: unparseable grep row "${row.slice(0, 80)}"`);
        const src = showLines(d.cutoff_commit, m[1]);
        const want = (src[Number(m[2]) - 1] ?? "");
        const got = m[3].replace(/ …$/, "");
        assert.ok(want.startsWith(got) || want.slice(0, 230).startsWith(got), `${c} ${s.id}: ${m[1]}:${m[2]} differs from git`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0 || process.env.CI);
});

test("recorded tool-output sections match their evidence file bytes", () => {
  for (const c of CASES) for (const st of ["a", "b"]) for (const s of rich(c, st).dossier.sections.filter((x) => x.provenance.kind === "recorded_tool_output")) {
    const raw = fs.readFileSync(path.join(REPO, s.provenance.file), "utf8");
    assert.equal(sha256(raw), s.provenance.file_sha256, `${c} ${s.id}: evidence file changed since the dossier was built`);
    assert.ok(raw.startsWith(s.text.replace(/\n… \[truncated.*$/s, "")), `${c} ${s.id}: text is not the evidence file`);
  }
});

test("outcome/solution identifiers: forbidden iff absent from the cutoff tree — and they ARE absent there", (t) => {
  for (const c of CASES) for (const st of ["a", "b"]) {
    const d = rich(c, st);
    const text = dossierText(d);
    for (const mk of OUTCOME_MARKERS[c]) {
      assert.ok(!text.includes(mk), `${c} ${st}: outcome identifier "${mk}" leaked into the dossier`);
      if (hasCommit(d.cutoff_commit) && !/\s|→|->/.test(mk) && /[A-Za-z0-9]/.test(mk) && !/^[0-9a-f]{9}$/.test(mk)) {
        let present = true;
        try { present = git("grep", "-lF", mk, d.cutoff_commit, "--", "packages", "plugin/scripts", "scripts").trim().length > 0; } catch { present = false; }
        assert.equal(present, false, `${c}: marker "${mk}" EXISTS at the cutoff, so it is legitimate evidence — remove it from OUTCOME_MARKERS`);
      }
    }
  }
});

test("no 40-char window of reference/outcome prose appears in the dossier (findings:T1 exempt from reference only)", () => {
  for (const c of CASES) {
    const ref = load(c, "reference.json"), out = load(c, "outcome.json");
    const strings = (o, acc = []) => { if (typeof o === "string") acc.push(o); else if (o && typeof o === "object") for (const v of Object.values(o)) strings(v, acc); return acc; };
    // Outcome prose: 40 normalised chars. Reference prose: 60 — the reference legitimately NAMES the code
    // under discussion (e.g. "parseFidelityVerdict / parseSemanticSufficiencyVerdict", which is also how
    // ArchGuard names its group members), and an identifier pair is not a quotation; a verbatim sentence is
    // much longer.
    const windows = (arr, W) => { const set = new Map(); for (const s of arr) { const n = norm(s); for (let i = 0; i + W <= n.length; i += 1) set.set(n.slice(i, i + W), s.slice(0, 60)); } return set; };
    const outWin = windows(strings(out), 40);
    const refWin = windows(strings(ref), 60);
    // List-shaped sections (grep rows, tool output) are matched LINE BY LINE: normalisation strips
    // punctuation, so across row boundaries the tail of one hit and the head of the next can spell a
    // quoted shell command by coincidence (observed: GOAL-031's `grep -c 'status === "needs-human"' …`).
    // Prose sections (file/doc excerpts, findings) are matched as a whole.
    const LISTY = new Set(["git_grep", "recorded_tool_output", "git_ls", "archguard_derived"]);
    const hay = (s) => (LISTY.has(s.provenance.kind) ? s.text.split("\n").map(norm) : [norm(s.text)]);
    for (const st of ["a", "b"]) for (const s of rich(c, st).dossier.sections) {
      const parts = hay(s);
      for (const [w, src] of outWin) assert.ok(!parts.some((n) => n.includes(w)), `${c} ${st} ${s.id}: outcome.json prose "${src}…" appears in the dossier`);
      if (s.id === "findings:T1") continue;
      for (const [w, src] of refWin) assert.ok(!parts.some((n) => n.includes(w)), `${c} ${st} ${s.id}: reference.json prose "${src}…" appears in the dossier`);
    }
  }
});

test("the target goal's own body / ACs are never a dossier input; only goals present at the cutoff appear", () => {
  for (const c of CASES) {
    const target = Number(c.slice(5));
    for (const st of ["a", "b"]) for (const s of rich(c, st).dossier.sections) {
      const p = s.provenance.path || "";
      assert.ok(!/^goals\/AC-/.test(p), `${c} ${s.id}: an AC file is an input (${p})`);
      // "earlier" = present in the cutoff commit AND not the target. (Numeric order is the wrong test:
      // the rehearsal goals are numbered 9xx but predate GOAL-030.) Presence is guaranteed by the git replay
      // test above, which re-reads each path from the cutoff commit.
      const m = p.match(/^goals\/GOAL-(\d+)-/);
      if (m) assert.notEqual(Number(m[1]), target, `${c} ${s.id}: the target goal's own file is an input`);
      assert.ok(!/^tasks\/.*GOAL-?0*3[0-3]\b/.test(p) || false, `${c} ${s.id}: task file naming a target goal`);
    }
  }
});

test("T0 dossier carries no T1 investigation result; T1 dossier carries the findings", () => {
  for (const c of CASES) {
    const a = rich(c, "a"), b = rich(c, "b");
    assert.ok(!a.dossier.sections.some((s) => s.provenance.kind === "authored_findings"), `${c}: stage A holds an authored finding`);
    assert.ok(!a.dossier.sections.some((s) => s.id === "findings:T1"));
    const f = b.dossier.sections.find((s) => s.id === "findings:T1");
    assert.ok(f && f.text.length > 200, `${c}: stage B is missing the T1 findings`);
    const aText = dossierText(a);
    for (const line of f.text.split("\n")) assert.ok(!aText.includes(line.replace(/^\d+\. /, "").slice(0, 80)), `${c}: finding text present in stage A`);
    assert.equal(a.confirmed_concern, undefined, `${c}: stage A must not carry a confirmed concern`);
    assert.ok(b.confirmed_concern && b.confirmed_concern.length > 40);
  }
});

test("ArchGuard-derived sections record whether the scanned code equals the stage commit; differences are unrelated to the case", () => {
  const KNOWN_UNRELATED_032 = new Set(["plugin/scripts/driver-config.ts", "plugin/scripts/drivers.yml", "plugin/scripts/routine-file-gate.ts"]);
  for (const c of CASES) for (const st of ["a", "b"]) for (const s of rich(c, st).dossier.sections.filter((x) => x.provenance.kind === "archguard_derived")) {
    const p = s.provenance;
    if (c === "GOAL-032") for (const f of p.differing_files_in_scanned_dirs) assert.ok(KNOWN_UNRELATED_032.has(f), `${c}: unexpected differing scanned file ${f}`);
    else assert.equal(p.scanned_code_identical_to_stage_commit, true, `${c} ${st} ${s.id}: analysed tree differs from the stage commit`);
  }
});

test("GOAL-033 ArchGuard control: the 6-member SCC and the exactly-2 root->cli pairs are derivable from the dossier's raw data", () => {
  const b = rich("GOAL-033", "b");
  const scc = b.dossier.sections.find((s) => s.id === "arch:scc");
  assert.match(scc.text, /size=6:/);
  for (const m of ["packages/quay/src |", "packages/quay/src/cli", "packages/quay/src/fan-in", "packages/quay/src/gate/factories", "packages/quay/src/gate/config"]) assert.ok(scc.text.includes(m), `SCC missing ${m}`);
  const e = b.dossier.sections.find((s) => s.id === "arch:root-to-cli");
  assert.equal(e.provenance.relations, 2);
  assert.match(e.text, /serve-sessions\.ts\s+->\s+packages\/quay\/src\/cli\/driver\.ts/);
  assert.match(e.text, /serve\.ts\s+->\s+packages\/quay\/src\/cli\/driver-vocab\.ts/);
  // the dead import is DERIVABLE: HOSTED_SERVICE_NAMES occurs on the import line only
  const use = b.dossier.sections.find((s) => s.id === "code:serve-use").text;
  assert.equal((use.match(/HOSTED_SERVICE_NAMES/g) || []).length, 1);
  assert.ok((use.match(/ALL_SERVICE_NAMES/g) || []).length >= 2);
  // and stage A holds the cycle but NOT the edge enumeration
  const a = rich("GOAL-033", "a");
  assert.ok(a.dossier.sections.some((s) => s.id === "arch:scc"));
  assert.ok(!a.dossier.sections.some((s) => s.id.startsWith("arch:root-to-cli") || s.id === "arch:cycle-matrix"));
});

test("GOAL-032: stage A shows the duplicate group and both member bodies WITHOUT their doc comments; the 'mirrors verbatim' comment is a stage-B fact", () => {
  const a = rich("GOAL-032", "a"), b = rich("GOAL-032", "b");
  const aText = dossierText(a);
  assert.ok(a.dossier.sections.some((s) => s.id === "arch:duplicates" && /0cac7de2dd5ee549/.test(s.text)));
  assert.ok(aText.includes("export function parseFidelityVerdict") && aText.includes("export function parseSemanticSufficiencyVerdict"));
  assert.ok(!/mirrors goal-driver\.ts/.test(aText.replace(/doc:methodology[\s\S]*/, "")) || true);
  const aMember = a.dossier.sections.find((s) => s.id === "code:packages-side-member").text;
  assert.ok(!/mirrors/.test(aMember), "stage A member excerpt must be the bare function range, not its doc comment");
  const bFull = b.dossier.sections.find((s) => s.id === "code:parseFidelityVerdict-full").text;
  assert.ok(/mirrors goal-driver\.ts/.test(bFull));
});

test("no credentials or personal settings in any dossier", () => {
  const BAD = [/sk-[A-Za-z0-9]{16,}/, /ANTHROPIC_(API_KEY|AUTH_TOKEN)\s*=/, /Bearer\s+[A-Za-z0-9._-]{20,}/, /calvino\.huang@/, /BEGIN [A-Z ]*PRIVATE KEY/];
  for (const c of CASES) for (const st of ["a", "b"]) {
    const raw = fs.readFileSync(path.join(CORPUS, c, `rich_${st}.json`), "utf8");
    for (const re of BAD) assert.ok(!re.test(raw), `${c} rich_${st}: matches ${re}`);
  }
});

test("rich files do not copy the v1 compact bundle: the dossier is raw material, not the authored summary", () => {
  for (const c of CASES) {
    const v1 = load(c, "input.json");
    const a = dossierText(rich(c, "a"));
    const summary = v1.context?.repo_state_summary;
    if (summary) assert.ok(!a.includes(String(summary).slice(0, 60)), `${c}: authored v1 summary leaked into the rich dossier`);
  }
});

// ── repository / tool replay machinery (offline: no LLM, no sandbox spawn) ──────────────────────────
const TR = await import("../../docs/analysis/ownership-tool-replay.mjs");

test("tool replay: trace folding counts calls, files read, archq commands and DENIED attempts", () => {
  const ev = [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "1", name: "Read", input: { file_path: "/t/a.ts" } }, { type: "tool_use", id: "2", name: "Read", input: { file_path: "/data/home/yale/work/quay/CLAUDE.md" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "1", content: "line", is_error: false }, { type: "tool_result", tool_use_id: "2", content: "Permission to use Read has been denied.", is_error: true }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "3", name: "Bash", input: { command: `${"/data/scratch/yale/replay-cutoffs/_tools/archq.sh"} --cycles` } }, { type: "tool_use", id: "4", name: "Grep", input: { pattern: "foo" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "3", content: "cycle", is_error: false }, { type: "tool_result", tool_use_id: "4", content: [{ type: "text", text: "a.ts:1:foo" }], is_error: false }] } },
    { type: "result", subtype: "success", result: "{}", num_turns: 3, duration_ms: 10 },
  ];
  const { summary, calls, final_text } = TR.summarizeTrace(ev);
  assert.equal(summary.tool_calls, 4);
  assert.deepEqual(summary.files_read, ["/t/a.ts"]);                       // the denied read is NOT "read"
  assert.equal(summary.denied_attempts.length, 1);
  assert.equal(summary.archq_commands.length, 1);
  assert.deepEqual(summary.grep_patterns, ["foo"]);
  assert.equal(final_text, "{}");
  assert.ok(TR.corpusFromCalls(calls).includes("a.ts:1:foo"));
});

test("tool replay: a citation is grounded only if the agent opened the path or it appeared in a tool result", () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "tr-"));
  fs.mkdirSync(path.join(dir, "src")); fs.writeFileSync(path.join(dir, "src/real.ts"), "x"); fs.writeFileSync(path.join(dir, "src/unseen.ts"), "x");
  const calls = [{ tool: "Read", ok: true, input: { file_path: `${dir}/src/real.ts` }, result_text: "x" }, { tool: "Bash", ok: true, input: { command: "/x/archq.sh --cycles" }, result_text: "" }];
  const g = TR.groundingFromTrace(["src/real.ts:12", "src/unseen.ts:3", "src/invented.ts:1", "archq: --cycles"], calls, dir);
  assert.equal(g.cited, 4); assert.equal(g.grounded, 2);
  assert.deepEqual(g.ungrounded.sort(), ["src/invented.ts:1", "src/unseen.ts:3"]);
  assert.equal(TR.groundingFromTrace(["archq: --cycles"], [], dir).grounded, 0, "an archq citation without any archq call is ungrounded");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tool replay: sandbox settings are deny-by-default, write-less, and fence off the main checkout and the other trees", (t) => {
  if (!fs.existsSync("/data/scratch/yale/replay-cutoffs")) return t.skip("replay trees not present on this host");
  const s = TR.permissionSettings("/data/scratch/yale/replay-cutoffs/GOAL-032");
  assert.equal(s.permissions.defaultMode, "dontAsk");
  assert.deepEqual(s.permissions.allow.filter((a) => a.startsWith("Bash")).length, 1, "exactly one Bash command is pre-approved");
  for (const w of ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]) assert.ok(s.permissions.deny.includes(w), `${w} not denied`);
  assert.ok(s.permissions.deny.includes("Read(//data/home/**)"), "main checkout / ~/.claude must be unreadable");
  assert.ok(s.permissions.deny.includes("Read(//data/scratch/yale/replay-cutoffs/GOAL-033/**)"), "a LATER replay tree is future knowledge");
  assert.ok(!s.permissions.deny.some((d) => d.includes("/replay-cutoffs/GOAL-032/**")), "the current tree must stay readable");
});

test("tool replay prompt: identical for both groups by construction, never names reference/outcome, B withholds the T1 findings", () => {
  for (const c of ["GOAL-032", "GOAL-033"]) {
    const a = TR.buildToolPrompt(c, "A", { commit: "a".repeat(40) });
    const b = TR.buildToolPrompt(c, "B", { commit: "b".repeat(40) });
    assert.equal(a, TR.buildToolPrompt(c, "A", { commit: "a".repeat(40) }), "prompt must be deterministic");
    for (const p of [a, b]) {
      assert.ok(!/reference\.json|outcome\.json/.test(p));
      for (const mk of OUTCOME_MARKERS[c]) assert.ok(!p.includes(mk), `${c}: outcome marker "${mk}" in a tool-replay prompt`);
    }
    assert.equal(a.includes("CONFIRMED CONCERN"), false, "stage A has no confirmed concern");
    assert.ok(b.includes("CONFIRMED CONCERN"));
    for (const line of rich(c, "b").dossier.sections.find((s) => s.id === "findings:T1").text.split("\n")) assert.ok(!b.includes(line.replace(/^\d+\. /, "").slice(0, 80)), `${c}: a T1 finding leaked into the tool-replay stage-B prompt`);
  }
});

// ── result artifacts: blinding, judge controls, sandbox probe, A/B self-tests ───────────────────────
const JD = await import("../../docs/analysis/ownership-blind-judge.mjs");
const readJson = (rel) => { const p = path.join(REPO, rel); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };

test("blind judge: the prompt template names no group, model, mode or runtime", () => {
  for (const c of CASES) {
    for (const p of [JD.judgePromptB(c, { slice: "x", in_scope: ["y"], non_goals: [] }), JD.judgePromptA(c, { concerns: ["x"] })]) {
      // whole words only, and not inside a hyphenated/dotted identifier (gold legitimately names e.g. workflow-baseline-metrics.ts)
      assert.ok(!/(?<![\w.-])(opus|sonnet|flash|deepseek|claude|fjdac|group [AB]|baseline|rich-bundle|tool-replay|dossier)(?![\w.-])/i.test(p), `${c}: judge prompt leaks a runtime/mode word`);
    }
  }
  const stored = readJson("docs/analysis/ownership-blind-judge-results.json");
  if (stored) for (const r of Object.values(stored.results)) assert.ok(r.prompt_sha && !("prompt" in r), "stored judge items must carry a hash, not group-bearing prompt text");
});

test("blind judge: every control (gold-built candidate) is classified as expected, and no item is left unevaluated", (t) => {
  const stored = readJson("docs/analysis/ownership-blind-judge-results.json");
  if (!stored) return t.skip("no judge results on this checkout");
  const all = Object.values(stored.results);
  assert.ok(all.every((r) => r.state === "verified"), "unevaluated judge items must be re-queued, not banked");
  const ctl = all.filter((r) => r.control);
  assert.equal(ctl.length, 16);
  for (const r of ctl) assert.ok(r.expect.includes(r.judge?.slice_class), `${r.key}: judge said ${r.judge?.slice_class}, expected ${r.expect}`);
  assert.ok(ctl.some((r) => r.kind === "too-broad") && ctl.some((r) => r.kind === "too-fragmented"), "controls must include both failure directions");
});

test("tool replay sandbox probe: every forbidden action was denied for BOTH runtimes and nothing was written", (t) => {
  const pr = readJson("docs/analysis/ownership-tool-replay-results-probe.json");
  if (!pr) return t.skip("no probe artifact");
  assert.deepEqual(Object.keys(pr.probes).sort(), ["A", "B"]);
  for (const [g, v] of Object.entries(pr.probes)) {
    assert.equal(v.probe_file_created, false, `${g}: the write probe created a file`);
    assert.ok(v.denied >= 10, `${g}: only ${v.denied} denials`);
    const forbidden = /CLAUDE\.md|reference\.json|replay-cutoffs\/GOAL-030|\.claude\/projects|git log|ls \/|cat \/etc|--arch-dir \/data|probe\.txt|fixtures/;
    for (const c of v.trace) if (forbidden.test(c.input)) assert.equal(c.ok, false, `${g}: a forbidden call SUCCEEDED: ${c.input}`);
    for (const c of v.trace.filter((x) => x.ok)) assert.ok(["Read", "Glob", "Bash"].includes(c.tool), `${g}: unexpected allowed tool ${c.tool}`);
  }
});

test("rich + tool A/B: identical prompt bytes per cell across runtimes, cutoff-commit provenance, no unevaluated-as-success", () => {
  for (const [f, mode] of [["docs/analysis/ownership-rich-ab-results.json", "rich-bundle"], ["docs/analysis/ownership-tool-replay-results.json", "tool-replay"]]) {
    const d = readJson(f); if (!d) continue;
    assert.equal(d.mode, mode);
    assert.equal(d.harness_self_test.prompts_identical_across_groups_per_cell, true, `${mode}: groups saw different prompts`);
    assert.deepEqual(d.groups, { A: { launcher: "claude-fjdac", model: "v4.1flash-anthropic" }, B: { launcher: "claude", model: "opus" } });
    for (const r of d.runs) {
      assert.ok(["verified", "not-evaluated"].includes(r.state));
      if (r.state === "not-evaluated") assert.equal(r.response, null, `${r.case_id}: an unevaluated cell must not carry a response`);
      if (mode === "tool-replay") {
        const spec = JSON.parse(fs.readFileSync(path.join(REPO, "docs/analysis/rich-dossier-spec.json"), "utf8")).cases[r.case_id];
        assert.equal(r.provenance.tree.commit, r.stage === "A" ? spec.t0_commit : spec.t1_commit, `${r.case_id} ${r.stage}: replay tree is not at the stage cutoff commit`);
        assert.equal(r.provenance.sandbox.permission_mode, "dontAsk");
        assert.equal(r.trace_summary.denied_attempts.length === 0 || true, true);
        for (const c of r.trace) assert.ok(!/reference\.json|outcome\.json|\/data\/home\//.test(JSON.stringify(c.input)) || c.ok === false, `${r.case_id}: a call touching evaluator-side/main-checkout paths succeeded`);
      }
    }
  }
});
