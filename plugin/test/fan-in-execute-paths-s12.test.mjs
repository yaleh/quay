// @test-group engine
// fan-in-execute-paths-s12.test.mjs — the ⑧⑩ **lock-wait / wait-primitive** cluster of
// fan-in-execute-paths-s07.test.mjs, split out by
// gap-suite-fan-in-execute-paths-s07-long-pole-split.
//
// Why this boundary: the two tests here are the ones whose subject is the fan-in **wait/single-flight
// machinery** — `waitForMarkerOrDeath` (the event-driven marker-or-liveness wait, gap-suite-not-robust-
// at-high-derived-concurrency) and the SUITE_LAUNCH block's lock discipline (no `FULL_SUITE_LOCK_TIMEOUT`
// double-value; slots busy ⇒ unbounded queue wait, never fail-closed). The two tests left in s07
// (`⑧` time-file guard family) are about the **cross-relaunch .time-file residue** — a different
// subject (cpu capture, not waiting). Same functional-boundary rule gap-ac281 used for s11.
//
// ⛔ Split by functional boundary, not "half a test": the tests here and those left in s07 share NO
//    mutable state beyond the read-only harness module (each makes its own mkdtemp fixtures and spawns
//    its own processes) ⇒ running the files CONCURRENTLY is equivalent to running them sequentially.
//    Shared fixtures stay single-source in ./helpers/fan-in-execute-paths-harness.mjs.
//
// ⚠️ This file is NOT the whole coverage of `plugin/workflows/fan-in-execute.js`; s07 + s11 + this file
//    together are. Same "只看本文件不再是完整覆盖" note s07/s11 carry.
//
// ➕ 2026-09-19 (gap-fan-in-marker-exists-before-write-reads-empty): this shard also owns the marker
//    **completion-granularity** cluster — AC1 (content, not existence: the wait primitive must not call a
//    created-but-unwritten marker "done") and AC3 (the REAL SUITE_LAUNCH block publishes its exit marker
//    atomically, so there is no observable exists-but-unwritten window). Same subject as the two ⑧⑩
//    waits above — "what counts as DONE for a marker" — hence the same file.
//
// Run:
//   scripts/test.sh plugin/test/fan-in-execute-paths-s12.test.mjs
//   node --test plugin/test/fan-in-execute-paths-s12.test.mjs

import { test } from "node:test";
import { REPO_ROOT, assert, cleanup, extractBlockFromPrompts, fs, os, path, promptContaining, readFinishedMarker, runBash, runWorkflow, runnerHermeticEnv, spawn, spawnSync, symlinkRuntimeTrees, waitForMarkerOrDeath } from "./helpers/fan-in-execute-paths-harness.mjs";

/** Is `pid` a live process? (kill -0 semantics; EPERM counts as alive — someone else's process.) */

/**
 * Wait until `markerPath` EXISTS or the detached suite (`pid`) is GONE — whichever comes first.
 *
 * Event-driven on purpose (gap-suite-not-robust-at-high-derived-concurrency): `fs.watch` on the
 * marker's directory is the completion source, and the suite's own pid is the failure detector. A
 * wall-clock budget takes NO part in the decision — a loaded host legitimately takes ~10x the idle
 * time, and reading that as "the lock is broken" was the defect this replaces.
 *
 * Returns "marker" | "dead" | "guard". `guardMs` is a HANG-GUARD only (explicitly overridable via
 * FANIN_TEST_MARKER_GUARD_MS) so a stuck suite reds this test instead of hanging the runner; it is
 * ~60x the measured idle cost of the fake suite below.
 */

// ── ⑧⑩ 锁等待负控制（gap-single-flight-lock-timeout-double-value AC1/AC2）────────────────────────
// THE DEFECT: test.sh 的 single-flight 锁有两套超时值（FULL_SUITE_LOCK_TIMEOUT 默认 600 + fan-in 的
// suiteLockTimeoutSecs 900 覆盖），且 600s 线已被常态化的 819-1619s full-bucket suite 跨越 ⇒ 活 suite
// 被 fail-closed「not starting」误杀 + 重试放大。
// FIX: test.sh 的锁等待改为【无界排队】（flock crash-autorelease 保证死持有者不泄漏槽），fan-in 不再经
// env 传 FULL_SUITE_LOCK_TIMEOUT（无双值、无 900 字面量）。
// ① 结构负控制（本缺陷的负控制）：launch/isolate 块不得携带 FULL_SUITE_LOCK_TIMEOUT / suite_lock_timeout
//    —— revert 本修复（重新经 env 传 / 重引入 suiteLockTimeoutSecs）⇒ 此断言红。
// ② REAL 机制（wait-and-acquire）：fake test.sh 忠实复现 test.sh 的【无界】锁等待语义（S=2 槽、非阻塞
//    try + 无界等待 + 永不 fail-closed）。两槽全忙时套件【等待】释放而【非】fail-closed。
// ── the event-driven wait's OWN falsification (AC1: it must be able to return non-"marker") ────────

test("⑧⑩ wait AC1 — marker-or-liveness driven, NOT a clock: dead suite ⇒ 'dead' without burning the budget; a marker appearing mid-wait ⇒ 'marker' (fs.watch); alive+no marker ⇒ 'guard'", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-wait-"));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

  // A provably DEAD pid: spawn and reap a real child.
  const child = spawn("bash", ["-c", "exit 0"], { stdio: "ignore" });
  await new Promise((r) => child.on("exit", r));
  const deadPid = child.pid;

  // 1) dead pid + no marker ⇒ "dead" — and it must be detected as an EVENT, not by waiting out a
  //    budget (this is the whole point: no 15s/60s burn, and no false red on a slow host).
  const t0 = Date.now();
  assert.equal(await waitForMarkerOrDeath(path.join(dir, "never.exit"), deadPid, 60_000), "dead");
  assert.ok(Date.now() - t0 < 5_000, `a dead suite must be an event, not a timeout (took ${Date.now() - t0}ms)`);

  // 2) alive pid, marker arrives WHILE waiting ⇒ "marker" via fs.watch (not via the poll).
  const lateMarker = path.join(dir, "late.exit");
  const pending = waitForMarkerOrDeath(lateMarker, process.pid, 60_000);
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(lateMarker, "exit=0\n");
  assert.equal(await pending, "marker");

  // 3) alive pid + no marker ⇒ "guard" (the ONLY place a clock participates, and it is a hang-guard).
  assert.equal(await waitForMarkerOrDeath(path.join(dir, "never2.exit"), process.pid, 700), "guard");
});


test("⑧⑩ 锁等待负控制 — suite-launch 不再携带 FULL_SUITE_LOCK_TIMEOUT (无双值); REAL 槽忙→释放后获取而非 fail-closed", async (t) => {
  // RED 序列驱动 vm 实执行：fix agent prompt 携带 ISOLATE_LAUNCH 块（SUITE_LAUNCH 在 phase-1 prompt）。
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-lockwait", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-lockwait", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                          // stage 2: RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },                       // Fix agent (carries ISOLATE_LAUNCH)
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched
    ],
  });

  // ── ① 结构负控制（无双值）──
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(!launch.includes("FULL_SUITE_LOCK_TIMEOUT"), "suite-launch must NOT pass FULL_SUITE_LOCK_TIMEOUT (single source = test.sh unbounded queue wait)");
  assert.ok(!launch.includes("suite_lock_timeout"), "suite-launch must NOT define a suite_lock_timeout override");
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");
  assert.ok(!isolate.includes("FULL_SUITE_LOCK_TIMEOUT"), "isolate-rerun launch must NOT pass FULL_SUITE_LOCK_TIMEOUT");
  assert.ok(!isolate.includes("suite_lock_timeout"), "isolate-rerun launch must NOT define a suite_lock_timeout override");

  // ── ② REAL wait-and-acquire ──
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-lockwait-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-lockwait-real";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);

  // Fake test.sh: faithful single-flight lock semantics (S=2 slots, non-blocking try, UNBOUNDED wait —
  // never fail-closed). The REAL scripts/test.sh is far too heavy for a unit test.
  const fakeTest = [
    "#!/usr/bin/env bash",
    "set -u",
    'lock_base="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)/full-suite.lock"',
    "fds=()",
    'for i in 0 1; do exec {fd}>"${lock_base}.${i}"; fds+=("$fd"); done',
    'held=""',
    "idx=0",
    'for fd in "${fds[@]}"; do if flock -n "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    'if [ -z "$held" ]; then',
    '  while [ -z "$held" ]; do',
    "    idx=0",
    '    for fd in "${fds[@]}"; do if flock -w 1 "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    "  done",
    "fi",
    'echo "acquired full-suite single-flight slot $held"',
    "sleep 1",
    "exit 0",
    "",
  ].join("\n");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), fakeTest);
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add fake test.sh"]);
  // The detached launch now runs full-suite-runner.ts — symlink the REAL plugin tree so it resolves.
  symlinkRuntimeTrees(dir, {});

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  const tmpFiles = [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, codeDeltaFile];
  t.after(() => { for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts: prompts2 } = await runWorkflow({
    args: { task, worktree: dir, root: dir, runId: "fm-lockwait-real", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts2, "# suite-launch-block-start", "# suite-launch-block-end");

  // Hold BOTH slots in a detached holder; killing it releases the flock (fd close auto-releases).
  //
  // ⛔ `exec sleep 30` IS LOAD-BEARING — do NOT drop the `exec`. `flock` locks belong to the open file
  // DESCRIPTION, and a file description survives in every process that inherited the fd. Without
  // `exec`, bash *may* fork the trailing `sleep 30` (observed on the self-hosted tokyo-alpha CI runner;
  // this dev box's bash 5.2 execs it instead), and the orphaned `sleep` keeps fds 8/9 open ⇒ SIGKILLing
  // the holder does NOT release the lock ⇒ the suite below stays blocked until the sleep exits at
  // holder_start+30s. Measured on a real task-branch run (35295064123): this one test was 31053ms —
  // 30.0s of that was the un-released lock, not suite launch cost (the sibling s11 test, which runs the
  // same SUITE_LAUNCH block with no holder, finishes the whole launch+marker in ~1s on the same runner).
  // With `exec`, the bash process IS the lock holder, so `holder.kill("SIGKILL")` provably closes the
  // fds and releases it — on every bash, on every host.
  const holder = spawn("bash", ["-c",
    `cd ${dir}; exec 8>"${dir}/.git/full-suite.lock.0"; flock -n 8 || exit 8; ` +
    `exec 9>"${dir}/.git/full-suite.lock.1"; flock -n 9 || exit 9; ` +
    `touch ${dir}/slots-held; exec sleep 30`], { stdio: "ignore" });
  t.after(() => { try { holder.kill("SIGKILL"); } catch (_) {} });
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, "slots-held")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(path.join(dir, "slots-held")), "holder must hold both slots before the suite launch");

  // Launch the REAL SUITE_LAUNCH block (no env seam — the unbounded wait lives in test.sh). Spawn
  // asynchronously (spawnSync would block until the detached suite's inherited stdout pipe closes), verify
  // the suite is STILL WAITING (no exit marker — it did NOT fail-closed), free a slot, then await the
  // block's ~1s confirm. The suite must acquire the freed slot and run to exit 0.
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const launchStartedMs = Date.now();
  const launchProc = spawn("bash", ["-c", launchBlock], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: runnerHermeticEnv() });
  let launchOut = "";
  launchProc.stdout.on("data", (d) => { launchOut += d; });
  launchProc.stderr.on("data", (d) => { launchOut += d; });
  await new Promise((r) => setTimeout(r, 1500)); // let the suite start waiting
  assert.ok(!fs.existsSync(marker), "the suite must WAIT while both slots are held — no exit marker (never fail-closed)");
  holder.kill("SIGKILL");                       // free a slot WHILE the suite is waiting
  const launchExit = await new Promise((resolve) => { launchProc.on("exit", (code, sig) => resolve({ code, sig })); });
  assert.equal(launchExit.code, 0, `launch block failed: ${launchOut}`);

  // ── THE WAIT IS EVENT-DRIVEN, NOT A WALL-CLOCK BUDGET ───────────────────────────────────────────
  // (gap-suite-not-robust-at-high-derived-concurrency, 2026-09-16 — this REPLACES the 15s literal
  // that the previous task bumped to 60s. A bump is the wrong shape: the quantity being waited on is
  // "a real suite, on a real host, under whatever load the host has", which has NO upper bound that
  // a literal can honestly claim. Measured on the self-hosted tokyo-alpha runner at suite concurrency
  // 128: the same healthy suite took 18.2s to reach the marker where an idle 16-core dev box takes
  // ~2s — so every literal is either a false failure on a loaded host or a liveness assumption
  // disguised as a timeout.)
  //
  // The decision variable is now an EVENT or a PROCESS STATE, never a duration:
  //   • the marker appears  ⇒ DONE (fs.watch on its directory is the event source);
  //   • the detached suite's pid is GONE and the marker is still absent ⇒ the suite died without
  //     acquiring — a REAL failure, reported as `dead` (not as a timeout).
  // `FANIN_TEST_MARKER_GUARD_MS` remains as a HANG-GUARD only: it exists so a genuinely stuck suite
  // fails this test rather than hanging the runner, is explicitly configurable, and is ~60x the idle
  // cost / ~6.6x the worst measured loaded cost. While the suite is ALIVE the wait does not stop.
  // The pidfile is a HINT, never a contract (the launch block itself falls back to a pure .exit poll
  // when it cannot be read — SUITE_LAUNCH leaves `suite_pid` empty). It is trusted here ONLY when it
  // is demonstrably FRESH, i.e. written after this launch began: a stale leftover in the same /tmp
  // (measured locally: an unremovable root-owned file made the launch block's own `rm -f` fail, so
  // it held a long-dead pid) would otherwise be read as "the suite died" and the wait would fail a
  // healthy run.
  const pidFile = `/tmp/fan-in-suite-${task}.pid`;
  let suitePid = NaN;
  try {
    if (fs.statSync(pidFile).mtimeMs >= launchStartedMs - 1000) {
      suitePid = Number((fs.readFileSync(pidFile, "utf8").match(/^(\d+)/) ?? [])[1]);
    }
  } catch { /* no pidfile ⇒ marker-only wait (documented fallback) */ }
  const waitOutcome = await waitForMarkerOrDeath(marker, suitePid);
  assert.equal(waitOutcome, "marker",
    `the waiting suite must acquire the freed slot and write its exit marker (wait outcome=${waitOutcome}; "dead" ⇒ the suite process vanished before acquiring, "guard" ⇒ it stayed alive past the hang-guard with no marker)`);
  const markerText = fs.readFileSync(marker, "utf8");
  const log = fs.readFileSync(`/tmp/fan-in-suite-${task}.log`, "utf8");
  assert.match(markerText, /exit=0/, `the suite must run to exit 0 after acquiring the freed slot, got: ${markerText.trim()}`);
  assert.match(log, /acquired full-suite single-flight slot/, "the suite must log its slot acquisition");
  assert.ok(!log.includes("not starting"), "the suite must NOT fail-closed (no 'not starting' lock refusal)");
});

// ── gap-fan-in-marker-exists-before-write-reads-empty ──────────────────────────────────────────────
// THE DEFECT (the cluster above is its subject, which is why these live here): the fan-in producers
// published the exit marker with `printf ... > "$suite_exit_marker"` (fan-in-execute.js SUITE_LAUNCH /
// ISOLATE_LAUNCH) — open(O_TRUNC) FIRST, write() SECOND — while the wait primitive decided completion by
// `fs.existsSync(markerPath)`. Whichever reader opened the path inside that scheduling gap resolved
// "marker" and then read the EMPTY string, so the ⑧⑩ lock-wait test above failed with
// `actual: '' expected: /exit=0/` under full-suite load (1/56 fan-in suite logs overall, 3/18 in the
// 09-12 window). The driver exempts that red as flaky ⇒ the task never exhausted its retries ⇒ a full
// ~19min suite burned per hit without advancing. The completion event of a marker is "the file has been
// WRITTEN", never "the file exists".

test("AC1 (能取假, 负控制) — content, not existence: a created-but-unwritten marker must NOT read as 'marker' (gap-fan-in-marker-exists-before-write-reads-empty)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-marker-empty-"));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });
  const marker = path.join(dir, "suite.exit");

  // The pre-fix producer's `printf ... > "$marker"` really is two steps: create the file (0 bytes) NOW,
  // write the content LATER. Reconstruct that sequence literally.
  fs.writeFileSync(marker, ""); // ── the open(O_TRUNC) half
  // The pre-fix consumer predicate, transcribed in shape from the old harness line
  // `if (fs.existsSync(markerPath)) return "marker";`
  const legacyPredicate = (p) => (fs.existsSync(p) ? "marker" : "wait");
  assert.equal(legacyPredicate(marker), "marker", "negative control: an existence-only predicate IS fooled by the created-but-unwritten marker");
  assert.equal(fs.readFileSync(marker, "utf8"), "", "...and the text its caller then reads is the EMPTY string — exactly the reported flake");
  assert.equal(readFinishedMarker(marker), null, "the content predicate must not call a 0-byte marker finished (hard rule 3b: no 'satisfied' value for an incomplete read)");

  // The fix's own negative control: the SAME sequence must NOT resolve before the write lands.
  // ⛔ If this still returns "marker" (and the caller still reads ""), the AC is FALSE and this must red.
  let outcome = null;
  const pending = waitForMarkerOrDeath(marker, process.pid, 30_000).then((o) => { outcome = o; return o; });
  await new Promise((r) => setTimeout(r, 900)); // ≫ several 250ms ticks + the fs.watch event the create fires
  assert.equal(outcome, null, "the wait must NOT report 'marker' while the marker is created-but-unwritten");
  fs.writeFileSync(marker, "exit=0\nend_ms=1\n"); // ── the write() half
  assert.equal(await pending, "marker", "once the content lands, completion is still an event (no budget burned)");
  assert.match(fs.readFileSync(marker, "utf8"), /exit=0/);
});

/** Observe a marker path while a real producer writes it, recording every moment the path EXISTED but its
 * content carried no `exit=` line yet — precisely the state the pre-fix predicate called "marker".
 * Two channels, so neither inotify coalescing nor poll granularity decides the answer: fs.watch on the
 * marker's directory (fires on CREATE, then on MODIFY / MOVED_TO) plus a 1ms poll. */
function observeHalfWrittenMarker(markerPath) {
  const hits = [];
  const sample = (via) => {
    let text;
    try { text = fs.readFileSync(markerPath, "utf8"); } catch { return; } // ENOENT ⇒ not an observable window
    if (!/^exit=[0-9]+/m.test(text)) hits.push({ via, bytes: text.length });
  };
  let watcher = null;
  try { watcher = fs.watch(path.dirname(markerPath), () => sample("watch")); } catch { /* poll-only */ }
  const tick = setInterval(() => sample("poll"), 1);
  return { hits, stop() { clearInterval(tick); try { watcher?.close(); } catch { /* best-effort */ } } };
}

test("AC3 (真实载体) — the REAL SUITE_LAUNCH block publishes its exit marker atomically: no observable exists-but-unwritten window (gap-fan-in-marker-exists-before-write-reads-empty)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-atomic-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-atomic-marker";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  // A fast fake suite (exit 0). The single-flight lock is NOT this test's subject — the marker's
  // publication is (the ⑧⑩ lock-wait test above covers the lock's own semantics).
  const fakeTest = ["#!/usr/bin/env bash", "set -u", 'echo "fake suite ok"', "exit 0", ""].join("\n");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), fakeTest);
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add fake test.sh"]);
  symlinkRuntimeTrees(dir, {});

  const ids = [task, `${task}2`];
  const codeDeltaFiles = ids.map((id) => `/tmp/fan-in-code-delta-${id}.txt`);
  const tmpFiles = ids.flatMap((id) => ["env", "exit", "exit.tmp", "time", "log", "pid"].map((ext) => `/tmp/fan-in-suite-${id}.${ext}`)).concat(codeDeltaFiles);
  const rmTmp = () => { for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } };
  rmTmp(); // start clean too — a stale capture would trip the block's pre-verified branch
  t.after(rmTmp);
  for (const f of codeDeltaFiles) fs.writeFileSync(f, "plugin/workflows/fan-in-execute.js\n");

  const launchBlockFor = async (runId, id) => {
    const { prompts } = await runWorkflow({ args: { task: id, worktree: dir, root: dir, runId, mergeTarget: "develop" } });
    return extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  };
  const launchBlock = await launchBlockFor("fm-atomic", task);

  const runLaunch = async (block, markerPath) => {
    const obs = observeHalfWrittenMarker(markerPath);
    const proc = spawn("bash", ["-c", block], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: runnerHermeticEnv() });
    let out = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { out += d; });
    const exit = await new Promise((r) => proc.on("exit", (code, sig) => r({ code, sig })));
    // The suite is DETACHED: the launch block returns after its own ~3s confirm, and the marker lands
    // whenever the suite actually finishes — so keep observing until the marker is COMPLETE, then stop.
    // (The guard is a hang-guard only, same contract as the ⑧⑩ wait test: the decision is the event.)
    const outcome = await waitForMarkerOrDeath(markerPath, process.pid, 60_000);
    obs.stop();
    return { exit, out, hits: obs.hits, outcome };
  };

  // ── structural falsifier, on the real carrier: the marker is PUBLISHED by rename ──────────────────
  // A marker's completion must be a rename onto its final path (content complete at the instant the path
  // becomes visible). Revert the producer to the single-redirect shape and these three lines red.
  assert.match(launchBlock, />\s*"\$4\.tmp"\s*&&\s*mv -f\s*"\$4\.tmp"\s*"\$4"/,
    "SUITE_LAUNCH must publish the exit marker with an atomic rename, not a bare > redirect");
  assert.ok(!/T%3NZ\)" > "\$4"'/.test(launchBlock),
    "the pre-fix single-redirect publication of the exit marker must be gone (a bare `> \"$4\"` is open(O_TRUNC)-then-write)");
  assert.ok(!/date \+%s%3N\)" > "\$5"; cd/.test(launchBlock),
    "the pidfile has the same created-before-written shape (硬规则 5b sibling) and must be published atomically too");

  // ── "after" reading: the real, fixed launch block ─────────────────────────────────────────────────
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const after = await runLaunch(launchBlock, marker);
  assert.equal(after.exit.code, 0, `launch block failed: ${after.out}`);
  assert.match(after.out, /SUITE_OUTCOME=started/, `the full-suite branch must fire (code_delta non-empty), got: ${after.out}`);
  assert.equal(after.outcome, "marker", `the detached suite must publish its exit marker (wait outcome=${after.outcome})`);
  const afterText = fs.readFileSync(marker, "utf8");
  assert.match(afterText, /^exit=0/m, `the real launch block must publish exit=0, got: ${JSON.stringify(afterText)}`);
  console.log(`[AC3] real SUITE_LAUNCH (atomic publication): exists-but-unwritten observations = ${after.hits.length} ${JSON.stringify(after.hits.slice(0, 3))}; marker bytes=${afterText.length}`);
  assert.equal(after.hits.length, 0, `the real launch block must never expose an exists-but-unwritten marker, saw: ${JSON.stringify(after.hits)}`);

  // ── "before" reading / instrument calibration: the same observer against the pre-fix SHAPE ─────────
  // The production window is a scheduling gap — microseconds on an idle box, milliseconds under the load
  // that produced the 3/18 rate — and no test can conjure that load on demand. So the control does the
  // only honest thing: take the SAME real block, revert the publication to the pre-fix shape, and widen
  // that same internal gap (create the file now, write it 500ms later). It MUST be caught — a zero-hit
  // result from an observer that cannot even catch a 500ms window would be a blind spot, not a
  // measurement (hard rule 4: a reading that cannot take false carries no information).
  const legacyBlock = (await launchBlockFor("fm-atomic-legacy", `${task}2`))
    .replace('> "$4.tmp" && mv -f "$4.tmp" "$4"', '> "$4"')
    .replace('rc=$?; printf "exit=', 'rc=$?; printf "" > "$4"; sleep 0.5; printf "exit=');
  assert.ok(!legacyBlock.includes('> "$4.tmp"') && legacyBlock.includes('sleep 0.5; printf "exit='),
    "the control must actually have reverted the publication shape — otherwise the comparison below is a no-op");
  const marker2 = `/tmp/fan-in-suite-${task}2.exit`;
  const before = await runLaunch(legacyBlock, marker2);
  assert.equal(before.exit.code, 0, `control launch block failed: ${before.out}`);
  assert.equal(before.outcome, "marker", `the control suite must still publish (wait outcome=${before.outcome})`);
  assert.match(fs.readFileSync(marker2, "utf8"), /^exit=0/m, "the control must still finish its publication — its hits must come from a real write, not a broken run");
  console.log(`[AC3] pre-fix shape (open → 0.5s gap → write): exists-but-unwritten observations = ${before.hits.length} ${JSON.stringify(before.hits.slice(0, 3))}`);
  assert.ok(before.hits.length > 0, `negative control for the observer: the pre-fix shape MUST be caught, saw ${before.hits.length} observations`);
});
