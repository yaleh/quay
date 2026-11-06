// @test-group engine
// refresh-worktree-quay.test.mjs — tasks/gap-fan-in-worktree-quay-provisioning (the script) and
// tasks/gap-worktree-quay-snapshot-copies-multi-gb-ledgers (the snapshot POLICY).
//
// The fan-in full suite runs DIRECTLY in a linked task worktree (`cd ${worktree} && bash
// scripts/test.sh`), where `.quay/` is gitignored ⇒ `git worktree add` copies NONE of it ⇒
// `<worktree>/.quay/config.yml` was absent/stale ⇒ the suite's repo-root resolution (_findRepoRoot)
// + config/gates tests (M63 ts-typecheck, blocked-signal, cap-from-gate, monitor-mount, run-identity
// — ruled-gap fan-in: 72 environmental REDs across 22 files, ALL green on the main checkout) failed
// environmentally. The OTHER half of gap-gitignored-carriers: the carriers fix (QUAY_MAIN_CHECKOUT)
// pointed CHECKERS at the main; THIS script snapshots the main's .quay/ into the worktree so the
// SUITE reads the same config/gates/runtime carriers.
//
// The snapshot then got out of hand: it copied the main checkout's append-only WRITE HISTORY too
// (measured 2026-11-06: 4.02 GB / 8,385 files per worktree; `meta-driver-round.jsonl` alone 1.99 GB)
// — 56 s and 8,129 `cp` + 8,130 `mkdir` execs per refresh, re-paid on every suite invocation. The
// exclusion set is now ONE data declaration in the script (`REFRESH_SNAPSHOT_EXCLUDE`) that also
// drives the git pathspec (so excluded paths are never enumerated) and the stale-copy prune.
//
// Coverage map:
//   ── provisioning (gap-fan-in-worktree-quay-provisioning) ──
//   AC1p — snapshot copy: main's `.quay/config.yml` (distinctive gate) + a CURRENT-STATE carrier
//          land in the worktree's .quay/, byte-identical content.
//   AC2p — heavy/wasteful excluded: node-compile-cache/ and per-run logs are NOT copied.
//   AC3p — no-op on the main checkout: the linked-worktree guard skips a main run (nothing to copy).
//   AC4p  — root auto-derived: without --root, the main checkout is resolved from the repo's shared
//          .git dir (git rev-parse --git-common-dir). Clears the leaked QUAY_MAIN_CHECKOUT so the
//          derive is genuinely exercised in ANY ambient env (one-shot verify round sets it).
//   AC4p-b — root auto-derive is ORDER-INDEPENDENT: a git whose `worktree list` lists a NON-main
//          entry first (constructed via a git shim) still resolves the MAIN checkout.
//   AC4p-c — root auto-derive resolves the main checkout from a DETACHED linked worktree.
//   AC5p — idempotent + dry-run: re-running overwrites (no error); --dry-run changes nothing.
//   ── snapshot policy (gap-worktree-quay-snapshot-copies-multi-gb-ledgers) ──
//   AC1 — a 500M append-only ledger is NOT in the snapshot and a large-but-current carrier IS
//         (two-state readings printed: ledger absent, negative control present, snapshot bytes).
//   AC2 — exec count decoupled from ledger BYTES: the same fixture with a 5M vs a 500M ledger
//         produces the same cp/mkdir invocation count (bound: difference ≤ 2, one per-shape probe).
//   AC3 — the exclusion set is data-driven and cross-checkable: adding a name to the declaration
//         makes it excluded; removing it makes it copied (both states run against a mutated copy of
//         the script, so the assertion is about the DECLARATION, not about a frozen behaviour).
//   AC4 — a snapshot size bound exists and can fail: within ⇒ pass line; artificially lowered bound
//         ⇒ exit 3 + loud line; unmeasurable (du fails) ⇒ `NOT-EVALUATED`, distinct from "pass".
//
// Run:
//   scripts/test.sh plugin/test/refresh-worktree-quay.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/refresh-worktree-quay.sh");

function bash(args, opts = {}) {
  return spawnSync("bash", args, { encoding: "utf8", ...opts });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/** Real throwaway git repo (main) with a registered linked worktree + gitignored .quay/. */
function makeRepo() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-quay-main-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: main, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@test");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(main, ".gitignore"), "/.quay/\n");
  fs.writeFileSync(path.join(main, "README.md"), "# repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  // gitignored .quay/ (config + current-state carriers + heavy/wasteful)
  fs.mkdirSync(path.join(main, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(main, ".quay", "config.yml"), "providers: {}\ngates:\n  probe:\n    - name: zz-refresh-probe-gate\n      command: \"true\"\n", "utf8");
  // CURRENT STATE (must be copied): driver/worker control state is what a suite run reads.
  fs.writeFileSync(path.join(main, ".quay", "worker-control.json"), "{\"halted\":false}\n", "utf8");
  // append-only history (must NOT be copied since the snapshot policy)
  fs.writeFileSync(path.join(main, ".quay", "gate-events.jsonl"), "{\"gate\":\"probe\"}\n", "utf8");
  fs.mkdirSync(path.join(main, ".quay", "node-compile-cache", "deep"), { recursive: true });
  fs.writeFileSync(path.join(main, ".quay", "node-compile-cache", "deep", "c.js"), "x", "utf8");
  fs.writeFileSync(path.join(main, ".quay", "full-suite-2026-08-15T00-00-00-000Z.log"), "historical", "utf8");
  const wt = path.join(main, "wt");
  git("worktree", "add", "-q", "-b", "task/fixture", wt, "HEAD");
  return { main, wt, git };
}

/** Sparse `bytes`-sized append-only ledger at `<main>/.quay/<name>` (truncate ⇒ no real I/O). */
function makeSparseLedger(main, name, bytes) {
  const p = path.join(main, ".quay", name);
  const r = spawnSync("truncate", ["-s", String(bytes), p], { encoding: "utf8" });
  assert.equal(r.status, 0, `truncate failed: ${r.stderr ?? ""}`);
  return p;
}

/**
 * PATH shim that counts how many times the script INVOKES `cp` / `mkdir` (the two per-file execs the
 * old snapshot paid 8,000+ times each). This is the fixture-side counterpart of the production
 * `strace -e trace=execve` reading recorded on the task — same quantity, no tracing privileges.
 */
function makeExecCounter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-quay-counter-"));
  const log = path.join(dir, "calls.log");
  fs.writeFileSync(log, "");
  for (const bin of ["cp", "mkdir"]) {
    const real = spawnSync("bash", ["-c", `PATH=/usr/bin:/bin command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
    assert.ok(real, `real ${bin} must resolve`);
    fs.writeFileSync(
      path.join(dir, bin),
      `#!/usr/bin/env bash\n` +
        `printf '%s\\n' "${bin}" >> "\${REFRESH_EXEC_LOG:?}"\n` +
        `exec "${real}" "$@"\n`,
      { mode: 0o755 },
    );
  }
  const count = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0);
  const reset = () => fs.writeFileSync(log, "");
  const env = (base = process.env) => ({ ...base, PATH: `${dir}${path.delimiter}${base.PATH ?? ""}`, REFRESH_EXEC_LOG: log });
  return { dir, log, count, reset, env };
}

/** Copy of the script with extra lines injected into the REFRESH_SNAPSHOT_EXCLUDE declaration. */
function scriptWithDeclaration(extraLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-quay-script-"));
  const src = fs.readFileSync(SCRIPT, "utf8");
  const anchor = "REFRESH_SNAPSHOT_EXCLUDE=(\n";
  assert.ok(src.includes(anchor), "the declaration anchor must exist in the script (AC3)");
  const mutated = src.replace(anchor, anchor + extraLines.map((l) => `  "${l}"\n`).join(""));
  const p = path.join(dir, "refresh-worktree-quay.sh");
  fs.writeFileSync(p, mutated, { mode: 0o755 });
  return { dir, script: p };
}

// ── provisioning (gap-fan-in-worktree-quay-provisioning) ─────────────────────────────────────

test("AC1p — snapshot copy: main's .quay/config.yml + a current-state carrier land in the worktree, byte-identical", () => {
  const { main, wt } = makeRepo();
  try {
    const r = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);

    const cfg = path.join(wt, ".quay", "config.yml");
    assert.ok(fs.existsSync(cfg), "worktree must now have .quay/config.yml (absent before: git worktree add copies no gitignored files)");
    assert.ok(fs.readFileSync(cfg, "utf8").includes("zz-refresh-probe-gate"), "copied config must carry the main's current gates (the M63 ts-typecheck class)");
    const carrier = path.join(wt, ".quay", "worker-control.json");
    assert.ok(fs.existsSync(carrier), "current-state carrier worker-control.json must be copied");
    assert.equal(fs.readFileSync(carrier, "utf8"), fs.readFileSync(path.join(main, ".quay", "worker-control.json"), "utf8"), "carrier content byte-identical");
    assert.match(r.stderr, /copied [1-9]/);
  } finally {
    rmrf(main);
  }
});

test("AC2p — heavy/wasteful excluded: node-compile-cache/ and per-run logs are NOT copied", () => {
  const { main, wt } = makeRepo();
  try {
    const r = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(wt, ".quay", "node-compile-cache")), "node-compile-cache must NOT be copied (3.2G; test.sh points NODE_COMPILE_CACHE at its own copy)");
    assert.ok(!fs.existsSync(path.join(wt, ".quay", "full-suite-2026-08-15T00-00-00-000Z.log")), "per-run log must NOT be copied (historical)");
    assert.match(r.stderr, /[0-9]+ excluded by snapshot policy/, "the exclusions must be counted");
  } finally {
    rmrf(main);
  }
});

test("AC1b — the cache class is never pruned AND never counted toward the bound (the worktree owns its NODE_COMPILE_CACHE)", () => {
  const { main, wt } = makeRepo();
  try {
    // A worktree that has already run a suite holds its own multi-GB compile cache
    // (scripts/test.sh:339 points NODE_COMPILE_CACHE at <repo_root>/.quay/node-compile-cache).
    const ownCache = path.join(wt, ".quay", "node-compile-cache", "deep");
    fs.mkdirSync(ownCache, { recursive: true });
    fs.writeFileSync(path.join(ownCache, "keep.js"), "// the worktree's own warm cache\n", "utf8");
    // Sparse 700M > the declared 512 MiB bound: if the cache were counted, the run would exit 3.
    const heavy = path.join(ownCache, "heavy.bin");
    const t = spawnSync("truncate", ["-s", String(700 * 1024 * 1024), heavy], { encoding: "utf8" });
    assert.equal(t.status, 0, `truncate failed: ${t.stderr ?? ""}`);

    const r = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r.status, 0, `the worktree's own cache must not trip the bound (exit ${r.status}): ${r.stdout} ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ownCache, "keep.js")), "the prune pass must NOT delete the worktree's own compile cache");
    assert.match(r.stderr, /within bound/);
  } finally {
    rmrf(main);
  }
});

test("AC1c — the prune pass removes stale GITIGNORED copies but never a TRACKED .quay carrier", () => {
  const { main, wt } = makeRepo();
  const gitWt = (...args) => {
    const r = spawnSync("git", args, { cwd: wt, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  try {
    // A TRACKED carrier that matches the policy's `*-round.jsonl` — it belongs to the CHECKOUT, not
    // to the snapshot. Deleting it would dirty the worktree (caught for real on
    // .quay/ac-devci-ac4-carrier-written-by-round.jsonl, which is tracked in quay itself).
    fs.mkdirSync(path.join(wt, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".quay", "tracked-round.jsonl"), "{\"tracked\":true}\n", "utf8");
    gitWt("add", "-f", ".quay/tracked-round.jsonl");
    gitWt("-c", "user.email=t@test", "-c", "user.name=t", "commit", "-q", "-m", "tracked carrier");
    // A stale IGNORED copy, i.e. what a snapshot made before the policy left behind.
    fs.writeFileSync(path.join(wt, ".quay", "meta-driver-round.jsonl"), "stale\n", "utf8");

    const r = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(wt, ".quay", "tracked-round.jsonl")), "a TRACKED carrier must survive the prune (it is not snapshot input)");
    assert.ok(!fs.existsSync(path.join(wt, ".quay", "meta-driver-round.jsonl")), "a stale GITIGNORED copy must be pruned");
    assert.match(r.stderr, /1 stale pruned/);
  } finally {
    rmrf(main);
  }
});

test("AC3p — no-op on the main checkout: the linked-worktree guard skips a main run", () => {
  const { main } = makeRepo();
  try {
    const before = fs.readFileSync(path.join(main, ".quay", "config.yml"), "utf8");
    const r = bash([SCRIPT, main, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /no-op/, "a main-checkout run must be a no-op");
    assert.equal(fs.readFileSync(path.join(main, ".quay", "config.yml"), "utf8"), before, "main's .quay untouched");
  } finally {
    rmrf(main);
  }
});

test("AC4p — root auto-derived: without --root, the main checkout is resolved from the repo's shared .git dir", () => {
  const { main, wt } = makeRepo();
  try {
    // gap-refresh-worktree-quay-main-derive (round197): the one-shot verify round runs the suite with
    // QUAY_MAIN_CHECKOUT set (full-suite-runner.ts) and this spawn INHERITS it ⇒ root was overridden to
    // the REAL quay main ⇒ the copied config lacked the fixture gate ⇒ AC4 failed. Clear it so this
    // test genuinely exercises the git-derived path — the derive must win in ANY ambient env.
    const env = { ...process.env };
    delete env.QUAY_MAIN_CHECKOUT;
    const r = bash([SCRIPT, wt], { env }); // no --root, no QUAY_MAIN_CHECKOUT
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(wt, ".quay", "config.yml")), "config copied with git-derived root");
    assert.ok(fs.readFileSync(path.join(wt, ".quay", "config.yml"), "utf8").includes("zz-refresh-probe-gate"));
  } finally {
    rmrf(main);
  }
});

test("AC4p-b — root auto-derive is ORDER-INDEPENDENT: a git whose `worktree list` lists a non-main entry first still resolves the MAIN", () => {
  const { main, wt } = makeRepo();
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-quay-shim-"));
  // Resolve the real git BEFORE prepending the shim dir to PATH (else command -v finds the shim).
  const realGit = spawnSync("bash", ["-c", "PATH=/usr/bin:/bin command -v git"], { encoding: "utf8" }).stdout.trim();
  assert.ok(realGit, "real git binary must resolve");
  try {
    // git 2.43's get_worktrees() always forces the main working tree first, so a REAL repo cannot
    // naturally exhibit a non-main first entry on this git — construct it honestly with a git shim
    // that reverses the `git worktree list --porcelain` entry order (everything else passes through).
    // The OLD first-entry derive resolves the linked wt as "root" ⇒ the wt==root guard no-ops ⇒ the
    // fixture config is NOT copied ⇒ AC4's assertion fails. The NEW git-common-dir derive is unaffected
    // by list order ⇒ the MAIN's .quay/ is copied. This is the "首项非 main 构造样本" for AC2.
    const shim = `#!/usr/bin/env bash\n` +
      `real_git="\${REAL_GIT:?}"\n` +
      `reorder=0\n` +
      `for a in "$@"; do\n` +
      `  [ "$a" = "worktree" ] && reorder=1\n` +
      `  if [ "$reorder" = "1" ] && [ "$a" = "list" ]; then\n` +
      `    tmp="$(mktemp)"\n` +
      `    "$real_git" "$@" > "$tmp"\n` +
      `    awk -v RS='' '{ e[NR]=$0 } END { for (i=NR; i>=1; i--) printf "%s\\n\\n", e[i] }' "$tmp"\n` +
      `    rc=$?\n` +
      `    rm -f "$tmp"\n` +
      `    exit $rc\n` +
      `  fi\n` +
      `done\n` +
      `exec "$real_git" "$@"\n`;
    fs.writeFileSync(path.join(shimDir, "git"), shim, { mode: 0o755 });

    const env = { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`, REAL_GIT: realGit };
    delete env.QUAY_MAIN_CHECKOUT;
    const r = bash([SCRIPT, wt], { env }); // no --root: derive, with `worktree list` reversed
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(wt, ".quay", "config.yml")), "config copied from the MAIN checkout even though `git worktree list` lists the linked wt first");
    assert.ok(fs.readFileSync(path.join(wt, ".quay", "config.yml"), "utf8").includes("zz-refresh-probe-gate"));
  } finally {
    rmrf(main);
    rmrf(shimDir);
  }
});

test("AC4p-c — root auto-derive resolves the MAIN checkout from a DETACHED linked worktree (one-shot verify shape)", () => {
  const { main, wt, git } = makeRepo();
  const detach = path.join(main, "detached-verify");
  try {
    git("worktree", "add", "-q", "--detach", detach, "HEAD");
    const env = { ...process.env };
    delete env.QUAY_MAIN_CHECKOUT;
    const r = bash([SCRIPT, detach], { env }); // derive from a detached verify worktree
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(detach, ".quay", "config.yml")), "config copied into the detached verify worktree from the MAIN checkout");
    assert.ok(fs.readFileSync(path.join(detach, ".quay", "config.yml"), "utf8").includes("zz-refresh-probe-gate"));
  } finally {
    rmrf(main);
  }
});

test("AC5p — idempotent + --dry-run changes nothing", () => {
  const { main, wt } = makeRepo();
  try {
    const r1 = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r1.status, 0);
    const r2 = bash([SCRIPT, wt, "--root", main]); // re-run: overwrite stale copy, no error
    assert.equal(r2.status, 0, `re-run exited ${r2.status}: ${r2.stdout} ${r2.stderr}`);
    assert.match(r2.stderr, /copied [1-9]/, "re-run still copies (overwrites) — idempotent");

    const dry = bash([SCRIPT, wt, "--root", main, "--dry-run"]);
    assert.equal(dry.status, 0);
    assert.match(dry.stderr, /\[dry-run\]/);
  } finally {
    rmrf(main);
  }
});

// ── snapshot policy (gap-worktree-quay-snapshot-copies-multi-gb-ledgers) ─────────────────────

test("AC1 — a 500M append-only ledger stays out of the snapshot; a current carrier still lands (negative control)", () => {
  const { main, wt } = makeRepo();
  try {
    const ledger = makeSparseLedger(main, "meta-driver-round.jsonl", 500 * 1024 * 1024);
    const control = path.join(main, ".quay", "zz-not-excluded-carrier.json");
    fs.writeFileSync(control, "{\"snapshotPolicy\":\"negative-control\"}\n", "utf8");

    const r = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);

    const copiedLedger = path.join(wt, ".quay", "meta-driver-round.jsonl");
    assert.ok(!fs.existsSync(copiedLedger), `the 500M append-only ledger must NOT be in the snapshot (${ledger})`);
    // NEGATIVE CONTROL: the exclusion is policy-driven, not "copy nothing big".
    assert.ok(fs.existsSync(path.join(wt, ".quay", "zz-not-excluded-carrier.json")), "a carrier NOT in the declaration must still be copied");
    assert.equal(fs.readFileSync(path.join(wt, ".quay", "zz-not-excluded-carrier.json"), "utf8"), fs.readFileSync(control, "utf8"));

    const snapBytes = Number(
      (spawnSync("du", ["-sb", path.join(wt, ".quay")], { encoding: "utf8" }).stdout ?? "").split(/\s+/)[0],
    );
    assert.ok(Number.isFinite(snapBytes) && snapBytes > 0, "snapshot size must be readable");
    assert.ok(snapBytes < 500 * 1024 * 1024, `snapshot (${snapBytes} bytes) must be smaller than the excluded ledger (${500 * 1024 * 1024}) — it did not carry the ledger`);
    assert.match(r.stderr, /snapshot-size \d+ bytes \(bound \d+\) — within bound/, "the snapshot size must be REPORTED (a bound nobody prints is not a reading)");
    console.log(`# AC1 two-state: excluded ledger present=${fs.existsSync(copiedLedger)} · negative-control carrier present=true · snapshot=${snapBytes} bytes`);
  } finally {
    rmrf(main);
  }
});

test("AC2 — exec count decoupled from ledger BYTES: 5M vs 500M ledger ⇒ same cp/mkdir invocation count", () => {
  const counter = makeExecCounter();
  const run = (bytes) => {
    const { main, wt } = makeRepo();
    try {
      makeSparseLedger(main, "meta-driver-round.jsonl", bytes);
      counter.reset();
      const r = bash([SCRIPT, wt, "--root", main], { env: counter.env() });
      assert.equal(r.status, 0, `script exited ${r.status} (${bytes} bytes ledger): ${r.stdout} ${r.stderr}`);
      return counter.count();
    } finally {
      rmrf(main);
    }
  };
  try {
    const small = run(5 * 1024 * 1024);
    const big = run(500 * 1024 * 1024);
    // Bound = 2, and the reason is structural: the copy loop is per ENUMERATED PATH, so the only thing
    // that can move the count between two runs of the same fixture is one path appearing/disappearing.
    // A ledger that grew 100× in BYTES contributes ZERO extra execs once it is excluded.
    const bound = 2;
    assert.ok(Math.abs(big - small) <= bound, `exec count must not track ledger bytes: 5M ⇒ ${small}, 500M ⇒ ${big}, |Δ| must be ≤ ${bound}`);
    assert.ok(small > 0, "the measurement must actually observe cp/mkdir invocations (a zero here means the shim never fired)");
    console.log(`# AC2 two-state: exec invocations 5M-ledger=${small} · 500M-ledger=${big} · |Δ|=${Math.abs(big - small)} ≤ ${bound}`);
  } finally {
    rmrf(counter.dir);
  }
});

test("AC3 — the exclusion set is one data declaration: add a name ⇒ excluded, remove it ⇒ copied", () => {
  const { main, wt } = makeRepo();
  const mutated = scriptWithDeclaration(["zz-policy-probe-carrier.json"]);
  try {
    const probe = path.join(main, ".quay", "zz-policy-probe-carrier.json");
    fs.writeFileSync(probe, "{\"carrier\":\"zz-policy-probe\"}\n", "utf8");

    // state A — the shipped declaration does not name it ⇒ copied
    const a = bash([SCRIPT, wt, "--root", main]);
    assert.equal(a.status, 0, `script exited ${a.status}: ${a.stdout} ${a.stderr}`);
    assert.ok(fs.existsSync(path.join(wt, ".quay", "zz-policy-probe-carrier.json")), "before adding the name, the carrier must be copied");

    // state B — the SAME script with one line added to the declaration ⇒ excluded
    rmrf(path.join(wt, ".quay"));
    const b = bash([mutated.script, wt, "--root", main]);
    assert.equal(b.status, 0, `mutated script exited ${b.status}: ${b.stdout} ${b.stderr}`);
    assert.ok(!fs.existsSync(path.join(wt, ".quay", "zz-policy-probe-carrier.json")), "after adding the name to REFRESH_SNAPSHOT_EXCLUDE, the carrier must NOT be copied");
    assert.ok(fs.existsSync(path.join(wt, ".quay", "config.yml")), "…and the rest of the snapshot still lands");
    console.log(`# AC3 two-state: declared=absent · undeclared=present (declaration drives both the copy loop and the git pathspec)`);
  } finally {
    rmrf(main);
    rmrf(mutated.dir);
  }
});

test("AC4 — snapshot size bound: within ⇒ pass line, artificially lowered ⇒ exit 3, unmeasurable ⇒ NOT-EVALUATED", () => {
  const { main, wt } = makeRepo();
  const tight = scriptWithDeclaration([]);
  try {
    // state 1 — within bound
    const ok = bash([SCRIPT, wt, "--root", main]);
    assert.equal(ok.status, 0, `within-bound run exited ${ok.status}: ${ok.stdout} ${ok.stderr}`);
    assert.match(ok.stderr, /snapshot-size \d+ bytes \(bound \d+\) — within bound/);

    // state 2 — artificially over bound (the fixture is small, so lower the declared bound instead of
    // writing a multi-GB fixture: the AC asks for a two-state reading of the CHECK, not of the disk)
    const src = fs.readFileSync(SCRIPT, "utf8");
    const mutated = src.replace(/^REFRESH_SNAPSHOT_MAX_BYTES=.*$/m, "REFRESH_SNAPSHOT_MAX_BYTES=1");
    assert.notEqual(mutated, src, "REFRESH_SNAPSHOT_MAX_BYTES must be a single declaration line");
    fs.writeFileSync(tight.script, mutated, { mode: 0o755 });
    const over = bash([tight.script, wt, "--root", main]);
    assert.equal(over.status, 3, `over-bound run must exit 3, got ${over.status}: ${over.stdout} ${over.stderr}`);
    assert.match(over.stderr, /SNAPSHOT OVER BOUND/);

    // state 3 — cannot measure ⇒ NOT-EVALUATED, a value distinct from "within bound" (hard rule 3b)
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-quay-dushim-"));
    fs.writeFileSync(path.join(shimDir, "du"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
    const unmeasurable = bash([SCRIPT, wt, "--root", main], {
      env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    assert.equal(unmeasurable.status, 0, "an unmeasurable snapshot must not be reported as a failure of the refresh");
    assert.match(unmeasurable.stderr, /snapshot-size NOT-EVALUATED/);
    assert.doesNotMatch(unmeasurable.stderr, /within bound/, "NOT-EVALUATED must NOT share the passing shape");
    console.log(`# AC4 three-state: within=${ok.status} · over=${over.status} · unmeasurable=NOT-EVALUATED(${unmeasurable.status})`);
    rmrf(shimDir);
  } finally {
    rmrf(tight.dir);
    rmrf(main);
  }
});
