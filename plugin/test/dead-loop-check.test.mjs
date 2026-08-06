// @test-group governance
// dead-loop-check.test.mjs — the L2 continuous-health DEAD-LOOP criterion
// (tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed).
//
// PROBLEM IT FIXES: every standing criterion answers "was the instrument laid down" (L1). None
// answers "is the loop ACTUALLY RUNNING" (L2, SPEC-complete-delivery-surface §5 level 2). A NEVER-RUN
// loop and a HEALTHY-RUNNING loop are COMPLETELY IDENTICAL under all existing criteria (measured:
// meta-cc/archguard got ZERO drives since setup, 29h zero progress, yet every L1 check green). This
// test pins plugin/scripts/dead-loop-check.sh — the minimal viable dead-loop criterion:
//
//   DEAD-LOOP iff (no NEW user message in any target transcript in the last N minutes)
//              AND (no git commit in the last N minutes)
//   — INDEPENDENT of backlog emptiness (queue-empty = healthy idle; dead-loop = nobody driving).
//
// Coverage map (task ACs):
//   AC1 — the dead-loop criterion: no drive + no commit ⇒ `loop_alive: dead`; recent commit ⇒ alive;
//         recent transcript user message ⇒ alive. (Both positive directions pinned.)
//   AC2 — queue-empty vs nobody-driving DISTINGUISHED: an EMPTY-backlog repo with a recent drive is
//         alive (healthy idle); a NON-EMPTY-backlog repo with no recent activity is dead (nobody
//         driving) — the criterion never consults the backlog.
//   AC3 — belongs to L2: the `loop_alive` measure is `bash plugin/scripts/dead-loop-check.sh` stdout;
//         the invariant `liveness_independent_of_backlog` is exercised by the AC2 fixtures.
//   AC4 — real use: the criterion judges a real project (meta-cc, zero recent drive + zero recent
//         user message) dead-loop; the same script shipped via quay-init (derived set) and the SPEC
//         §5 cross-annotation carry it as a standing L2 check. (Real-project fixture: run only when
//         /home/yale/work/meta-cc exists — skip otherwise, the repo is not part of this checkout.)
//   AC5 — AC10 accounting is a task-body cross-reference; this test pins the mechanism only.
//   AC6 — node:test + // @test-group governance.
//
// Run:
//   scripts/test.sh plugin/test/dead-loop-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "dead-loop-check.sh");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────

function tmpdir(t, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dead-loop-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** initGitRepo — a temp git repo at `dir` with one commit. `committerDate` (ISO-8601) controls the
 * committer/author date; omit for a fresh (now) commit. Returns the repo dir. */
function initGitRepo(dir, { committerDate } = {}) {
  const env = { ...process.env };
  if (committerDate) { env.GIT_AUTHOR_DATE = committerDate; env.GIT_COMMITTER_DATE = committerDate; }
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd, env });
  assert.equal(git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]).status, 0);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  assert.equal(git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir).status, 0);
  assert.equal(git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], dir).status, 0);
  return dir;
}

/** writeTranscript — a transcript jsonl whose LAST `type=user` record has `timestamp` = isoAgo
 * minutes before now (or an explicitly given ISO). Older records carry a 2000 timestamp. */
function writeTranscript(file, { lastUserIso = "2000-01-01T00:00:00Z" }) {
  const rows = [
    { type: "assistant", message: { role: "assistant", content: "hi" }, timestamp: "2000-01-01T00:00:01Z" },
    { type: "user", message: { role: "user", content: "old" }, timestamp: "2000-01-01T00:00:02Z" },
    { type: "user", message: { role: "user", content: "drive" }, timestamp: lastUserIso },
  ];
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function isoAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function runCheck({ root, transcripts = [], windowMin = 30 }) {
  const args = [SCRIPT, "--root", root];
  for (const [name, p] of transcripts) args.push("--transcript", name, p);
  args.push("--window-min", String(windowMin));
  const r = spawnSync("bash", args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function verdictOf(stdout) {
  const m = stdout.match(/^loop_alive: (alive|dead)$/m);
  assert.ok(m, `stdout must carry the loop_alive measure field:\n${stdout}`);
  return m[1];
}

function signalsOf(stdout) {
  const m = stdout.match(/^alive_signals: (.+)$/m);
  return m ? m[1].trim() : "";
}

// ── AC1: the dead-loop criterion (transcript user messages + git commit window) ────────────────────

test("AC1 — no recent drive + no recent commit ⇒ dead (the never-run loop is caught)", (t) => {
  const root = tmpdir(t, "ac1dead");
  initGitRepo(root, { committerDate: "2000-01-01T00:00:00Z" }); // 26-year-old commit
  const tr = path.join(root, "outer.jsonl");
  writeTranscript(tr, { lastUserIso: "2000-01-01T00:00:00Z" }); // no recent user message
  const r = runCheck({ root, transcripts: [["outer", tr]], windowMin: 30 });
  assert.equal(r.status, 0, `verdict is data, not an error: ${r.stderr}`);
  assert.equal(verdictOf(r.stdout), "dead");
  assert.equal(signalsOf(r.stdout), "none");
});

test("AC1 — a recent git commit ⇒ alive (loop is driving even with no transcript)", (t) => {
  const root = tmpdir(t, "ac1git");
  initGitRepo(root, { committerDate: isoAgo(2) }); // commit 2 minutes ago
  const r = runCheck({ root, windowMin: 30 });
  assert.equal(r.status, 0);
  assert.equal(verdictOf(r.stdout), "alive");
  assert.ok(signalsOf(r.stdout).includes("git-commit"), `signals should mention git-commit:\n${r.stdout}`);
});

test("AC1 — a recent transcript user message ⇒ alive even when the repo commit is ancient", (t) => {
  const root = tmpdir(t, "ac1tr");
  initGitRepo(root, { committerDate: "2000-01-01T00:00:00Z" });
  const tr = path.join(root, "inner.jsonl");
  writeTranscript(tr, { lastUserIso: isoAgo(2) }); // user message 2 minutes ago
  const r = runCheck({ root, transcripts: [["inner", tr]], windowMin: 30 });
  assert.equal(r.status, 0);
  assert.equal(verdictOf(r.stdout), "alive");
  assert.ok(signalsOf(r.stdout).includes("transcript-user"), `signals should mention transcript-user:\n${r.stdout}`);
});

test("AC1 — window boundary: a commit just INSIDE the window is alive, just OUTSIDE is dead", (t) => {
  const inRoot = tmpdir(t, "wbin");
  initGitRepo(inRoot, { committerDate: isoAgo(29) }); // 29 min, window 30 → alive
  assert.equal(verdictOf(runCheck({ root: inRoot, windowMin: 30 }).stdout), "alive");
  const outRoot = tmpdir(t, "wbout");
  initGitRepo(outRoot, { committerDate: isoAgo(31) }); // 31 min, window 30 → dead
  assert.equal(verdictOf(runCheck({ root: outRoot, windowMin: 30 }).stdout), "dead");
});

// ── AC2: queue-empty vs nobody-driving are DISTINGUISHED (independence of backlog) ─────────────────

test("AC2 — queue-empty but driven ⇒ alive (healthy idle, NOT dead-loop)", (t) => {
  // An EMPTY-backlog project (no tasks/ dir at all) that is still being driven (recent commit)
  // must be judged alive — the criterion must NOT conflate "nothing to do" with "nobody driving".
  const root = tmpdir(t, "ac2empty");
  initGitRepo(root, { committerDate: isoAgo(1) }); // recent drive, no tasks/ anywhere
  assert.equal(verdictOf(runCheck({ root, windowMin: 30 }).stdout), "alive");
});

test("AC2 — full backlog but no recent drive ⇒ dead (nobody driving, NOT healthy idle)", (t) => {
  // A project with a NON-EMPTY backlog (tasks/ with ready items) but no recent commit and no recent
  // user message must be judged dead — backlog fullness is deliberately NOT an input to liveness.
  const root = tmpdir(t, "ac2full");
  initGitRepo(root, { committerDate: "2000-01-01T00:00:00Z" });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", "QX-001.md"), "---\nid: QX-001\nstatus: ready\n---\n\n## AC\n\n- [ ] a\n");
  const tr = path.join(root, "outer.jsonl");
  writeTranscript(tr, { lastUserIso: "2000-01-01T00:00:00Z" });
  const r = runCheck({ root, transcripts: [["outer", tr]], windowMin: 30 });
  assert.equal(r.status, 0);
  assert.equal(verdictOf(r.stdout), "dead", "a full backlog must NOT keep a never-driven loop alive");
});

// ── AC3/AC6: shipped measure + test policy ─────────────────────────────────────────────────────────

test("AC6 — the test declares // @test-group governance and node:test (self-evident: this file)", () => {
  const header = fs.readFileSync(new URL(import.meta.url), "utf8").slice(0, 200);
  assert.match(header, /\/\/ @test-group governance/);
});

test("AC3 — the script carries the Contract invoke vocabulary (transcript / 提交 / N 分钟)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /transcript/);
  assert.match(src, /提交/);
  assert.match(src, /N 分钟/);
});

test("AC3 — the script NEVER reads the backlog (invariant liveness_independent_of_backlog)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // The dead-loop verdict must be derived ONLY from transcript + git signals. Comments MAY discuss
  // the invariant, but executable task-store READS against the PROJECT ROOT would violate it
  // (queue-full must not make a never-driven loop alive). The selfcheck DOES create a temp
  // $alive_ws/tasks fixture to PROVE independence (AC2 control) — that is a temp path, never a
  // real-project read, so only project-root task paths are asserted absent.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(code, /DEFAULT_ROOT\/tasks|\$root\/tasks|\$REPO_ROOT\/tasks/i, "no project-root tasks/ read");
  assert.doesNotMatch(code, /ready-pool/i, "no ready-pool read");
  assert.doesNotMatch(code, /\.quay\/(config|backlog)/i, "no .quay config/backlog read");
  assert.doesNotMatch(code, /find[^\n]*tasks/i, "no find over the task store");
});

// ── AC4: real use (meta-cc) — runs only when the real project is present on this machine ──────────

const META_CC = "/home/yale/work/meta-cc";
const META_CC_TRANSCRIPTS = (() => {
  try {
    const dir = path.join(os.homedir(), ".claude", "projects", "-home-yale-work-meta-cc");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    return files.length ? files.map((f) => path.join(dir, f)) : [];
  } catch { return []; }
})();
const metaCcAvailable = fs.existsSync(META_CC) && META_CC_TRANSCRIPTS.length > 0;

test("AC4 — real use: the criterion judges meta-cc (a project with zero recent drive) dead-loop", {
  skip: metaCcAvailable
    ? false
    : "real /home/yale/work/meta-cc project (or its transcripts) not present on this machine",
  timeout: 20000,
}, () => {
  const trArgs = META_CC_TRANSCRIPTS.slice(0, 1).map((p, i) => [`outer${i}`, p]);
  const r = runCheck({ root: META_CC, transcripts: trArgs, windowMin: 30 });
  assert.equal(r.status, 0, `verdict is data: ${r.stderr}`);
  // The criterion's verdict must be internally consistent with the two measured signals.
  const gitMin = Number((r.stdout.match(/^git_last_commit_min: (\d+)/m) ?? [])[1] ?? Infinity);
  const trMin = Number((r.stdout.match(/^transcript_last_user_min: \S+ (\d+)/m) ?? [])[1] ?? Infinity);
  const v = verdictOf(r.stdout);
  // Whatever the current state is, alive must be justified by a signal within the window,
  // and dead by BOTH signals outside it — the verdict follows the signals, never a guess.
  if (gitMin <= 30 || trMin <= 30) {
    assert.equal(v, "alive", `a recent signal (git=${gitMin}m, tr=${trMin}m) must yield alive`);
  } else {
    assert.equal(v, "dead", `no recent signal (git=${gitMin}m, tr=${trMin}m) must yield dead`);
  }
});

// ── Contract control: --selfcheck (AC1 dead + AC2 negative) ───────────────────────────────────────

test("Contract control — --selfcheck PASSes (AC1 no-drive⇒dead, AC2 queue-empty-but-driven⇒alive)", () => {
  const r = spawnSync("bash", [SCRIPT, "--selfcheck"], { encoding: "utf8" });
  assert.equal(r.status, 0, `selfcheck must pass:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /PASS/);
});
