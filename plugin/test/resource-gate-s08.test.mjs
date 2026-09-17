// @test-group engine
// resource-gate.test.mjs — gap-no-resource-awareness-heavy-ops-run-blind. Pins the shared resource
// gate (plugin/scripts/resource-gate.sh) + the derived concurrency default (scripts/test.sh
// default_test_concurrency) as a MECHANICAL mechanism, not prose:
//
//   AC2 — the gate reads /proc/pressure/cpu `some avg10` (structural), never load average (proxy)
//   AC4 — it counts node procs via CMDLINE (host-independent — the `node-MainThread` comm literal
//         is host/Node-version-dependent, boheidc comm=`MainThread` ⇒ 恒 0), never `pgrep -f` /
//         `grep -x node`; the comm literal survives only as the dual-read self-check cross-count
//   AC3 — GO ↔ WAIT both directions, deterministically via the env test seams (no busy-loop flake)
//   AC6 — mem_avail < 2048MB → WAIT + prints RSS top-5
//   AC10 — orphaned node procs printed on their own line, excluded from the GO/WAIT verdict
//   AC7 — test.sh consults the gate on the full-suite default path; skips it for scoped runs
//   AC5 — default concurrency = max(1, floor(nproc × oversub / S)); explicit --test-concurrency=N wins
//         (gap-suite-budget-oversubscribe pure computation — nproc read-host, oversub 旋钮③, S 旋钮②)
//
// The gate's own AC3 (raise cpu pressure with real busy loops, watch WAIT, stop, watch GO) is a
// live-system control — recorded in the task body, not here (a unit test cannot hold /proc/pressure
// hostage). The env seams below pin the SAME verdict logic deterministically.
//
// Run:
//   scripts/test.sh plugin/test/resource-gate.test.mjs
//   node --test plugin/test/resource-gate.test.mjs

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 8/8 (8 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { GATE, PROCESS_BUDGET, REPO_ROOT, assert, defaultLaneCount, fs, os, path, runGate, spawn, spawnSync, withSeams } from "./helpers/resource-gate-harness.mjs";

test("AC99 — resource-gate.sh --json emits ONE valid JSON document carrying verdict + nproc-derived load_threshold (AC3)", () => {
  const env = {
    ...process.env,
    RESOURCE_GATE_TEST_CPU_AVG10: "30",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_LOAD_OVERRIDE: "3",
    RESOURCE_GATE_TEST_NPROC: "4",
  };
  const res = spawnSync("bash", [GATE, "--json"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `report mode --json exits 0; got ${res.status}: ${res.stderr}`);
  const out = res.stdout.trim();
  const nl = out.indexOf("\n");
  const first = nl === -1 ? out : out.slice(0, nl);
  let j;
  assert.doesNotThrow(() => { j = JSON.parse(first); }, "stdout's first line must be one JSON document");
  assert.equal(j.verdict, "GO");
  // AC3 — load_threshold is nproc × load_over_factor computed INSIDE the mechanism (nproc=4 ⇒ 8),
  // never a host-derived literal the UI would have to hardcode.
  assert.equal(j.load_threshold, 8);
  assert.equal(j.load_over_factor, 2);
  assert.equal(j.nproc, 4);
  assert.equal(j.cpu_stall_avg10, 30);
  assert.equal(j.loadavg, 3);
  assert.equal(typeof j.reason, "string");
  assert.match(j.reason, /^=> GO/);
});


test("AC99 — resource-gate.sh --json carries the WAIT verdict + reason for a full-suite overload window", () => {
  const env = {
    ...process.env,
    RESOURCE_GATE_TEST_CPU_AVG10: "30",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    RESOURCE_GATE_TEST_NPROC: "4",
  };
  const res = spawnSync("bash", [GATE, "--for", "full-suite", "--json"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 1, "full-suite --json must keep the WAIT exit code (1)");
  const j = JSON.parse(res.stdout.trim());
  assert.equal(j.verdict, "WAIT");
  assert.equal(j.load_wait, 1);
  assert.equal(j.load_threshold, 8);
  assert.match(j.reason, /过载窗口/);
});


test("AC99 — process-budget.sh --json emits ONE valid JSON document carrying the budget numbers", () => {
  const env = {
    ...process.env,
    RESOURCE_GATE_TEST_NPROC: "4",
    RESOURCE_GATE_TEST_NODE_PROCS: "2",
  };
  const res = spawnSync("bash", [PROCESS_BUDGET, "--json"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `process-budget --json exits 0; got ${res.status}: ${res.stderr}`);
  const j = JSON.parse(res.stdout.trim());
  assert.equal(j.total_budget, 4);
  assert.equal(j.in_use, 2);
  assert.equal(j.available, 2);
  assert.equal(j.verdict, "GO");
});


test("AC99 — no --json ⇒ report text output is byte-identical (cap-from-gate back-compat)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "30", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" });
  assert.match(r.stdout, /cpu_stall\(some avg10\)=30\.00  \[limit 60\]   ok/, "text cpu_stall line unchanged");
  assert.match(r.stdout, /=> GO/, "text verdict line unchanged");
  assert.doesNotMatch(r.stdout, /^\s*\{/m, "text mode must not emit a JSON object on its own");
});

// ── gap-process-budget-counts-hung-test-processes-as-in-use: the LIVENESS axis ──────────────────────
// THE DEFECT: `in_use` classified by CMDLINE ALONE counts a HUNG suite tree — a process whose cmdline
// still says `node --test …` but whose parent already died (reparented orphan, PPID=1), alive for days
// and burning ~0 CPU. Measured 2026-09-11 on the live host: `in_use=12` of which 10 were hung (6 dead
// suite trees, oldest 85 h; 2 CPU-seconds over a 30 s window against 17,666 s of historical CPU). The
// consumer (`defaultLaneCount` = max(1, floor((nproc − in_use) × oversub / S))) was pinned to its FLOOR
// of 1 lane for the whole run — `--test-concurrency` is spliced into the command at spawn and never
// recomputed, so a 570-file suite ran strictly serially (~3 h instead of ~20 min).
// THE FIX: count a candidate only if it CONSUMED CPU during a sampling window. The discriminant is the
// process's /proc/<pid>/stat CPU-time delta (utime+stime, fields 14+15) — a DIRECT host-observable
// quantity (硬规则 4b), never the process's own self-report; never an age threshold; never a
// process-count literal (硬规则 4 推论二 — a literal whose plausibility depends on this host's specs
// silently becomes a wrong limit on another host). Measured separation: a blocked node --test-shaped
// process = 0 ticks/s, a running one = 104 ticks/s.


test("AC2 — the LIVENESS axis is pinned independently of the CLASSIFICATION axis (`liveness_source` names which one was evaluated)", () => {
  const cmds = ["node --test a.test.mjs", "node --test b.test.mjs", "node --test c.test.mjs", "node --test d.test.mjs"];
  // A provided cmdline list carries no pid, so the liveness axis CANNOT be sampled from it.
  const run = (extra) =>
    spawnSync("bash", [PROCESS_BUDGET, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: cmds.join(";"), ...extra },
    });

  // Classification-only (the PRE-FIX semantics): every cmdline-matching entry counts, AND the output
  // says so — 硬规则 3b: "无法评估" must not share the shape of "合格", so an un-sampled liveness axis
  // gets its own value in `liveness_source` instead of silently defaulting to "all live".
  const cls = run({});
  assert.equal(cls.status, 0, cls.stderr);
  const cj = JSON.parse(cls.stdout.trim());
  assert.equal(cj.in_use, 4, "classification-only seam counts every cmdline-matching entry");
  assert.equal(cj.excluded_count, 0, "nothing is dropped on the classification axis");
  assert.deepEqual(cj.excluded, []);
  assert.equal(cj.liveness_source, "classification-only-seam", "the output must name the axis it actually exercised");

  // Both axes pinned: the aligned `hung|live` tokens decide in_use and the excluded set enumerates
  // exactly WHICH entries were dropped.
  const both = run({ RESOURCE_GATE_TEST_PROC_LIVENESS: "hung;live;hung;live" });
  assert.equal(both.status, 0, both.stderr);
  const bj = JSON.parse(both.stdout.trim());
  assert.equal(bj.in_use, 2, "only the `live` tokens count");
  assert.equal(bj.excluded_count, 2, "the two `hung` tokens are excluded");
  assert.deepEqual(bj.excluded.map((e) => e.cmdline), [cmds[0], cmds[2]], "the excluded set enumerates WHICH entries were dropped");
  assert.ok(bj.excluded.every((e) => e.reason === "seam:hung" && e.cpu_delta_ticks === 0));
  assert.equal(bj.liveness_source, "seam", "a pinned liveness axis reports its own source");
});


test("AC2 — the sampling window is a read-host KNOB (ms), clamped; never a caller literal and never an age threshold", () => {
  const runWindow = (ms) =>
    JSON.parse(
      spawnSync("bash", [PROCESS_BUDGET, "--json"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          RESOURCE_GATE_TEST_NPROC: "4",
          RESOURCE_GATE_TEST_PROC_CMDLINES: "node --test a.test.mjs",
          RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS: ms,
        },
      }).stdout.trim(),
    );
  assert.equal(runWindow("2000").sample_window_ms, 2000, "the knob is honoured");
  assert.equal(runWindow("1").sample_window_ms, 200, "clamped UP — a 1 ms window has no tick resolution");
  assert.equal(runWindow("999999").sample_window_ms, 2000, "clamped DOWN so the read stays inside testProcessesInUse()'s 5 s child timeout (measured: 3000 ms ran 4.47 s end-to-end)");
  assert.equal(runWindow("abc").sample_window_ms, 1000, "a non-numeric knob degrades to the default, never wedges the budget");
});


test("AC1/AC3/AC4/AC6 — REAL host, ONE run: hung (0-CPU) test-shaped processes are EXCLUDED, a running one is COUNTED, and the excluded set is enumerable", () => {
  // K = 3 REAL hung processes: the cmdline carries `--test-concurrency` (so is_test_cmdline matches ⇒
  // the CLASSIFICATION axis counts them — the pre-fix semantics), while the body blocks on a stdin read
  // it never receives ⇒ ~0 CPU forever (the field shape: a reparented orphan burning no CPU). The
  // parent holds the write end, so when this test exits the pipe closes and every child exits on its
  // own — no orphan is left behind on disk.
  const HUNG_BODY = "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))";
  const BUSY_BODY = "const t=Date.now();while(Date.now()-t<120000){Math.sqrt(Math.random())}";
  const kids = [];
  const hungPids = [];
  try {
    for (let i = 0; i < 3; i++) {
      const c = spawn(process.execPath, ["--test-concurrency=1", "-e", HUNG_BODY], {
        stdio: ["pipe", "ignore", "ignore"],
        detached: true,
      });
      c.unref();
      kids.push(c);
      hungPids.push(c.pid);
    }
    // The AC4 positive control: a genuinely RUNNING test-shaped process (burns a core the whole run).
    const busy = spawn(process.execPath, ["--test-concurrency=1", "-e", BUSY_BODY], {
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    busy.unref();
    kids.push(busy);
    // Let every child exec and settle into its steady state before the snapshot (a not-yet-exec'd
    // child still carries its parent's cmdline and would otherwise race the classifier).
    spawnSync("sleep", ["1.5"]);

    const r = spawnSync("bash", [PROCESS_BUDGET, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "64" },
    });
    assert.equal(r.status, 0, `process-budget --json must exit 0\n${r.stderr}`);
    const j = JSON.parse(r.stdout.trim());
    const excludedPids = j.excluded.map((e) => e.pid);

    assert.equal(j.liveness_source, "sampled", "the real-host path must report the SAMPLED axis");
    // AC6 — the exclusion is VISIBLE and enumerable (硬规则 3b: "excluded N" and "excluded none" must
    // be distinguishable in the output).
    assert.ok(Array.isArray(j.excluded), "--json must carry an enumerable `excluded` array");
    assert.equal(j.excluded_count, j.excluded.length, "excluded_count must equal the enumerable `excluded` length");
    // AC1 + AC3 — every hung pid was CLASSIFIED (that is the ONLY way it can appear in `excluded`,
    // which is built strictly from classified candidates) and is now EXCLUDED with a zero CPU delta.
    // `excluded ⊆ classified candidates` by construction, so their presence here IS the pre-fix
    // classification axis having counted them — the pre-fix script (whose only axis was
    // classification) reported in_use=30 on this same host with these same 3 processes alive.
    for (const pid of hungPids) {
      assert.ok(excludedPids.includes(pid), `hung pid ${pid} must be listed in \`excluded\` (age + cpu delta enumerable)`);
      const rec = j.excluded.find((x) => x.pid === pid);
      assert.equal(rec.cpu_delta_ticks, 0, `hung pid ${pid} must carry a ZERO CPU delta over the window`);
      assert.equal(rec.reason, "no_cpu_delta", `hung pid ${pid} exclusion reason`);
      assert.ok(Number.isInteger(rec.age_s), `hung pid ${pid} record must carry the process age in seconds`);
      assert.ok(rec.cmdline.includes("--test"), "the excluded record keeps enough cmdline to identify the process");
    }
    // AC4 — the bidirectional control in the SAME run and the SAME environment: the running process is
    // NOT excluded ⇒ it is counted. A fix that dropped live processes too would fail this line.
    assert.ok(!excludedPids.includes(busy.pid), `the RUNNING pid ${busy.pid} must NOT be excluded (AC4: live processes stay counted)`);
    assert.ok(j.in_use >= 1, `a running test process must keep in_use ≥ 1 (got ${j.in_use})`);
  } finally {
    for (const c of kids) {
      try {
        if (c.stdin) c.stdin.destroy();
      } catch {
        /* best-effort cleanup */
      }
      try {
        process.kill(c.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
});


test("AC5 — the CONSUMER lane count leaves its FLOOR once the hung candidates stop counting (enumerated, not a boolean)", () => {
  // The SAME environment — nproc=4, S=2, oversub=1, and a pinned full-suite lock base so S cannot be
  // shadowed by a live `<base>.concurrency` file (the 判据4 pattern) — with the ONLY difference being
  // whether the liveness axis drops the 3 hung candidates. `RESOURCE_GATE_TEST_NODE_PROCS` is left as
  // the EMPTY STRING (read as unset) so the lane count really goes through the CONSUMER path
  // defaultLaneCount() → testProcessesInUse() → the real process-budget.sh, not a pinned shortcut.
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-hung-lane-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  fs.writeFileSync(`${pinBase}.concurrency`, "2", "utf8");
  try {
    const nproc = 4;
    const slots = 2;
    const oversub = 1;
    const hungCmds = ["node --test h1.test.mjs", "node --test h2.test.mjs", "node --test h3.test.mjs"];
    const seamEnv = {
      RESOURCE_GATE_NPROC: String(nproc),
      QUAY_MAX_CONCURRENT_SUITES: String(slots),
      QUAY_MAX_OVERSUBSCRIPTION: String(oversub),
      FULL_SUITE_LOCK_FILE: pinBase,
      RESOURCE_GATE_TEST_NODE_PROCS: "",
      RESOURCE_GATE_TEST_PROC_CMDLINES: hungCmds.join(";"),
    };
    // Pre-fix axis (classification only): all 3 hung candidates count ⇒ in_use=3 ⇒ floor((4−3)×1/2)=0
    // ⇒ clamped to the floor 1.
    const before = withSeams(seamEnv, () => defaultLaneCount());
    // Post-fix axis (liveness pinned): all 3 dropped ⇒ in_use=0 ⇒ floor((4−0)×1/2) = 2.
    const after = withSeams({ ...seamEnv, RESOURCE_GATE_TEST_PROC_LIVENESS: "hung;hung;hung" }, () => defaultLaneCount());
    const enumeration =
      `nproc=${nproc} S=${slots} oversub=${oversub} | in_use=3 ⇒ laneCount=${before} | in_use=0 ⇒ laneCount=${after}`;
    assert.equal(before, Math.max(1, Math.floor(((nproc - 3) * oversub) / slots)), `pre-fix lane count = the formula on in_use=3 — ${enumeration}`);
    assert.equal(after, Math.max(1, Math.floor(((nproc - 0) * oversub) / slots)), `post-fix lane count = the formula on in_use=0 — ${enumeration}`);
    assert.equal(before, 1, `the pre-fix reading sits ON the floor — ${enumeration}`);
    assert.equal(after, 2, `the post-fix reading is the host-derived value — ${enumeration}`);
    assert.ok(after > before, `the consumer must move off the floor — ${enumeration}`);
  } finally {
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});
