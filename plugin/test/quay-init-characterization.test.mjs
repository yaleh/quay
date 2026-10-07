// quay-init-characterization.test.mjs — pin the CLOSED-SET FILE SURFACE and exit code of the shipped
// init entry (`plugin/scripts/quay-init.sh`).
//
// (gap-arch-quay-init-sh-python-heredocs-to-native, AC2/AC3.) The port that moved the shell script's
// TWELVE embedded `python3` invocations into `packages/quay/src/init.ts` promised EQUIVALENCE, not
// improvement: same six-file surface, same exit code, same report lines. An equivalence claim with
// nothing pinning it is an assertion (硬规则 4), so the surface was pinned by hash.
//
// ⚠️ RE-SCOPED 2026-10-07 (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch).
// The entry is now a ≤40-line SHIM that execs `bin/quay init`, so this file no longer characterizes
// a second implementation — it characterizes THE implementation (the TS engine), reached through the
// same path a user's script would take. Three shell-era scenarios retired with their carriers:
//   · "loop VALUE change … PyYAML folds at 80" — the shell's `ensure_loop_config` re-serialiser.
//     The engine's upgrade path is the SAME comment-preserving, per-key pipeline; its byte-level
//     behaviour is pinned by `packages/quay/test/init.test.mjs` (GOAL-029①/③/④).
//   · "a CORRUPT config fails closed with rc=1" — GOAL-029 / AC-330 CHANGED this contract on
//     purpose: an unparseable config is now REBUILT with the broken bytes preserved beside it
//     (exit 0), not refused. The successor pin is `quay-init.test.mjs`'s "an UNPARSEABLE config is
//     NEVER reported as reconciled" + `packages/quay/test/init.test.mjs`.
//   · "an EXISTING legacy config: the migration DELETES the binding lines" — successor pin is
//     `quay-init.test.mjs` AC7 ("the migration is LINE-WISE: only the path/mcp_entry lines go,
//     every other line (comments included) is byte-identical").
//
// WHAT IS PINNED HERE. The FRESH install's closed-set surface, by SHA-256 of the path-normalised
// bytes, plus the run's exit code; and two behavioural arms (dry-run writes nothing; an upgrade
// preserves a user's own key and comment) that the hash alone cannot express.
// Normalisation replaces the two machine-specific roots (the temp workspace and this checkout's
// plugin dir) with placeholders; nothing else is normalised, so a one-byte change anywhere in the
// surface is a RED.
//
// WHY A HASH AND NOT A DIFF-AGAINST-EXPECTED-TEXT. Spelling the generated YAML here would be a
// second copy that drifts from the writer — the failure mode the repo's single-source-of-truth
// principle forbids. A hash is not a copy of the content; it is a claim that the content did not
// move. Re-anchoring after an INTENTIONAL change is a one-line, reviewable edit to the table below.
//
// FALSIFIABILITY. The table was taken from the unchanged script before the port and demonstrated to
// go red (perturbing the writer's output made a scenario fail; reverting made it pass). A
// characterization that cannot go red is a tautology.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const initScript = path.join(pluginDir, "scripts", "quay-init.sh");

const CLEANUPS = [];
after(() => {
  for (const d of CLEANUPS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

/** A fresh temp BASE. The workspace is `<BASE>/ws` — a FIXED basename, because the profile carrier
 *  derives its session names from it, so a random basename would make `profiles.yml` unpinnable. */
function makeBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "qinit-char-"));
  CLEANUPS.push(base);
  return base;
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/** A git workspace with one commit on `main` — the shape `ensureBranchModel` classifies as a normal
 *  fresh project (so the branch-model step runs its real path rather than the not-a-repo skip). */
function initWorkspace(base) {
  const ws = path.join(base, "ws");
  fs.mkdirSync(ws, { recursive: true });
  git(ws, "init", "-q", "-b", "main", ".");
  git(ws, "config", "user.email", "t@t");
  git(ws, "config", "user.name", "t");
  fs.writeFileSync(path.join(ws, "README.md"), "hi\n");
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "init");
  return ws;
}

function runInit(ws, args) {
  const r = spawnSync("bash", [initScript, "--root", ws, ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const CLOSED = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
];

/** The closed-set surface, path-normalised, as `<rel path>  <sha256|ABSENT|DIR:listing>`. */
function surface(ws, base) {
  const norm = (s) =>
    s.split(base).join("<BASE>").split(pluginDir).join("<PLUGIN>");
  const lines = [];
  for (const rel of CLOSED) {
    const p = path.join(ws, rel);
    if (!fs.existsSync(p)) { lines.push(`${rel}  ABSENT`); continue; }
    const sha = createHash("sha256").update(norm(fs.readFileSync(p, "utf8"))).digest("hex");
    lines.push(`${rel}  ${sha}`);
  }
  for (const rel of ["tasks", "goals"]) {
    const p = path.join(ws, rel);
    lines.push(`${rel}/  ${fs.existsSync(p) && fs.statSync(p).isDirectory() ? "DIR" : "ABSENT"}`);
  }
  return lines.join("\n");
}

function configText(ws, base) {
  const raw = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
  return raw.split(base).join("<BASE>").split(pluginDir).join("<PLUGIN>");
}

const FRESH_ARGS = [
  "--repo-root", "<BASE>/ws",
  "--test-command", "bash scripts/test.sh",
  "--worktree-root", "<BASE>/wt",
  "--auto-commit-skip",
];

function argsFor(base) {
  return FRESH_ARGS.map((a) => a.split("<BASE>").join(base));
}

// ── the pinned table ────────────────────────────────────────────────────────────────────────────
// One entry per scenario: the exit code and the sha256 of the normalised surface. Anchored
// 2026-09-20 on the PRE-PORT script (`git show HEAD:plugin/scripts/quay-init.sh`) run side by side
// with the ported one on these exact fixtures — see this file's header for the falsifiability
// record. A future RED here is a question, not a verdict: either the script's output moved (and
// this row must be re-anchored WITH the change that moved it), or it regressed.
// RE-ANCHORED 2026-09-24 (gap-fan-in-delta-classify-declared-doc-surfaces): the fresh-install heredoc
// gained the `loop.doc_surfaces` key (the doc/code declaration the mechanical fan-in reads), so
// `.quay/config.yml` legitimately moved. The block is ONE key line + SEVEN comment lines and the
// comments ship inside the emitted file (they are heredoc body, not script comments), so the moved
// text is 8 lines — the "only that one line changed" reading is wrong for a hash over the output.
// ⚠️ The first value recorded on this row (c2200494…) was STALE, not merely superseded: it matches no
// emission of this branch. Verified by re-running the laydown with the pin's OWN commit's quay-init.sh
// (`git show ce570e8bf:plugin/scripts/quay-init.sh` -> same c2740778…), and by the inverse control —
// stripping exactly this block from the live output reproduces develop's recorded 27caf439… byte for
// byte, which is what pins the method itself. The other six rows are untouched, which is what the
// row-per-file shape is for.
// RE-ANCHORED 2026-09-24 AGAIN, by this row's SECOND mover (gap-quay-init-config-heredoc-leaks-
// maintainer-comments) — and this one is the interesting kind of second move: the two changes are
// INDEPENDENT and OVERLAP IN THE SAME emitted region, so neither recorded value survives. That task
// lifted a block of MAINTAINER-addressed commentary out of the heredoc body (it was being shipped to
// every downstream project's config — a real install read quay's own incident log as its own
// history), and it also repaired a sentence that the block had been spliced across. develop's
// doc_surfaces block was added ON TOP of that same region. Measured relationship between develop's
// emission and this branch's, on identical fixtures: 48 → 36 lines, the difference being EXACTLY the
// 13-line maintainer block deleted and replaced by the one user-facing `fork_baseline` comment line;
// `doc_surfaces` and its seven consumer comment lines are present in BOTH, and the other 35 lines are
// byte-identical. (That is also why "take develop's recorded c2740778…" would be wrong, and why
// neither side's value could be kept: the emitted bytes are the union of develop's ADDITION and this
// task's DELETION.) The one-line `loop.doc_surfaces` row-pinning lesson above still holds.
const PINNED = {
  fresh: {
    rc: 0,
    surface: [
      // Re-anchored 2026-09-23 (gap-repo-shape-inferred-from-test-sh-existence / GOAL-027 / AC-316):
      // the fresh-install writer now emits the three fan-in contract keys (suite_runner: delegated /
      // scoped_command: null / doc_check_command: null) next to fork_baseline. This row moved WITH
      // that intentional change — the other five files are byte-identical, which is the cross-check
      // that only the loop: block was touched. Re-based 2026-09-24 after merging develop, which had itself
      // moved this row: the merged config MINUS the 14-line fan-in block hashes to develop's pin (ba6933df…).
      // RE-ANCHORED 2026-10-06 (gap-project-quay-pointer-is-init-plugin-root-and-version-records-
      // derive-from-it): the fresh writer's native provider NO LONGER emits `path`/`mcp_entry` at all
      // (Core resolves the native provider from its own plugin root — `plugin-root.ts`), so the two
      // lines left the block and the header comment was rewritten to explain the removal. The other
      // five files hash unchanged — the cross-check that only the provider block moved.
      // RE-ANCHORED 2026-10-06 (gap-release-gate-verify-plugin-channel-misses-config-validate-…):
      // the fresh writer's `loop:` block gained `board: "native"` + `gates: []`, because a config
      // without them is rejected by `quay config validate` AND by loop-params.ts — a fresh install
      // was born failing the documented verify command. Only the loop block moved; the other five
      // files hash unchanged (that cross-check is what makes this a targeted re-anchor).
      // RE-ANCHORED AGAIN 2026-10-06 (gap-fresh-quay-init-config-fails-validate-on-loop-board-and-
      // gates-that-init-never-writes), which was dispatched against the same defect and merged on top:
      // `board: native` (unquoted — matching LOOP_VERSION_DEFAULTS' own rendering, which the shell
      // mirror is pinned to) and `gates: ["acceptance"]` rather than `[]`. The empty list satisfied
      // the validator vacuously but handed the loop driver NO gate (`params.gates[0]` undefined);
      // `acceptance` is a built-in, always resolvable, and is the value the reconcile now fills into
      // existing configs too. The other five files hash unchanged again — the same targeted cross-check.
      // RE-ANCHORED 2026-10-07 (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch):
      // the shipped entry is a shim over `bin/quay init`, so this row now pins the TS engine's fresh
      // config instead of the shell heredoc's. The other FOUR files hash UNCHANGED — including
      // `.claude/launch.settings.json`, which is the cross-check that matters here: the engine's
      // inline launch template had DRIFTED from the shipped `plugin/.claude/launch.settings.json`
      // (missing the two `CLAUDE_CODE_DISABLE_*` keys the shipped file gained 2026-08-11), so making
      // the engine the sole writer surfaced the drift and it was fixed in the same change —
      // `packages/quay/test/init.test.mjs` now binds the two byte-for-byte. If this row moves again,
      // check whether it is the launch carrier that moved; that invariant is the reason it did not.
      ".quay/config.yml  3eaaf7aa1fc453cb7b5df0ae6f525384e225ff542d9603d567a95d2c48aa67ff",
      ".quay/profiles.yml  0f781fbcc8140fd1b4732d877f8484f2c6f14856e2419167281976678b748bb0",
      ".gitignore  f9e6655aa4762432b178420cf9c9d773fc88a67822c6e44fcbdf5f51a8e6ec7a",
      ".claude/launch.settings.json  25e4ace2586d593da41a0b0f7380c2d77aed03d404b7a0f3414329f6df30baec",
      ".claude/settings.json  98ec2eef468478b3f6bf878a3629e9b51bb5a9e8a7317bab4871cc8eee10eb93",
      "tasks/  DIR",
      "goals/  DIR",
    ].join("\n"),
  },
};

test("AC2 — a FRESH install pins the closed-set surface and exit code", () => {
  const base = makeBase();
  const ws = initWorkspace(base);
  const r = runInit(ws, argsFor(base));
  assert.equal(r.status, 0, `fresh init must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const actual = surface(ws, base);
  // The pinned value is stored as a hash line per file so a mismatch NAMES the file that moved.
  const names = CLOSED.concat(["tasks/", "goals/"]);
  const pinned = PINNED.fresh.surface.split("\n");
  const actualLines = actual.split("\n");
  assert.equal(actualLines.length, pinned.length, "surface shape changed (a closed-set item appeared or vanished)");
  for (let i = 0; i < names.length; i++) {
    assert.equal(
      actualLines[i], pinned[i],
      `${names[i]} moved.\n  actual:   ${actualLines[i]}\n  expected: ${pinned[i]}\nfull surface:\n${actual}`,
    );
  }
});

test("AC2 — the fresh-install config carries the provider map + the loop params the driver reads", () => {
  // A structural cross-check ON TOP of the hash: the hash says "nothing moved", this says "the
  // thing that is there is still the thing it must be". A hash alone would happily pin a config
  // whose provider block was deleted by a compensating change elsewhere.
  const base = makeBase();
  const ws = initWorkspace(base);
  assert.equal(runInit(ws, argsFor(base)).status, 0);
  const cfg = configText(ws, base);
  assert.match(cfg, /^providers:\n  native:\n    enabled: true$/m);
  // The native provider carries NO path/mcp_entry (Core resolves it from its own plugin root), and
  // names no `.quay/plugin` link — gap-project-quay-pointer-is-init-plugin-root-and-version-records-
  // derive-from-it (D).
  assert.doesNotMatch(cfg, /^ {4}path:/m, "the native provider must not carry a path:");
  assert.doesNotMatch(cfg, /^ {4}mcp_entry:/m, "the native provider must not carry an mcp_entry:");
  assert.doesNotMatch(cfg, /\.quay\/plugin/, "the config must not name the .quay/plugin link");
  for (const key of ["QUAY_NATIVE_TASKS_DIR", "QUAY_NATIVE_GOAL_DIR", "QUAY_NATIVE_ADR_DIR", "QUAY_NATIVE_META_DIR"]) {
    assert.match(cfg, new RegExp(`^ {6}${key}: "<BASE>\/ws\/(tasks|goals|adr|meta)"$`, "m"), `${key} pin missing`);
  }
  assert.match(cfg, /^ {2}test_command: bash scripts\/test\.sh$/m);
  assert.match(cfg, /^ {2}tmux_session: null$/m);
  assert.match(cfg, /^ {2}worktree_root: <BASE>\/wt$/m);
  assert.match(cfg, /^ {2}fork_baseline: develop$/m);
  // .claude/settings.json: project-level enable + MCP pre-approval, in python-json.dump shape.
  const settings = fs.readFileSync(path.join(ws, ".claude", "settings.json"), "utf8");
  assert.equal(
    settings,
    JSON.stringify({ enabledPlugins: { "quay@quay": true }, permissions: { allow: ["mcp__plugin_quay_quay__*"] } }, null, 2) + "\n",
  );
});

test("AC3 — an EXISTING config carrying a user's own key and comment is UPGRADED, and both survive", () => {
  // The engine's upgrade path is comment-preserving and per-key. This pins the two properties a hash
  // over the fresh surface cannot express: a user's own top-level key and their own comment are still
  // there after a re-run, and the run EXITS 0 rather than refusing — "already exists" is gone
  // (GOAL-029: the state of the target decides, and a parseable config is upgraded in place).
  const base = makeBase();
  const ws = initWorkspace(base);
  assert.equal(runInit(ws, argsFor(base)).status, 0, "baseline install");
  const p = path.join(ws, ".quay", "config.yml");
  const cfg = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, "# a user comment the upgrade must preserve verbatim\n" + cfg + "\nmy_own_key: 7\n");

  const r = runInit(ws, argsFor(base));
  assert.equal(
    r.status, 0,
    `re-running over a user's own config must UPGRADE, not refuse\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
  );
  const after = configText(ws, base);
  assert.ok(after.includes("# a user comment the upgrade must preserve verbatim"), "a user comment must survive");
  assert.match(after, /^my_own_key: 7$/m, "an unrecognized top-level key is KEPT, never deleted");
  // …and the run SAYS it kept it rather than keeping it silently (硬规则 3b, the "kept" direction).
  assert.match(r.stdout + r.stderr, /unrecognized top-level config key "my_own_key"/);
});

test("AC3 — --dry-run plans and writes NOTHING", () => {
  const base = makeBase();
  const ws = initWorkspace(base);
  const r = runInit(ws, [...argsFor(base), "--dry-run"]);
  assert.equal(r.status, 0, `a dry run must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const actual = surface(ws, base);
  assert.match(actual, /^\.quay\/config\.yml {2}ABSENT$/m, "a dry run must not write the config");
  assert.match(actual, /^\.claude\/settings\.json {2}ABSENT$/m, "…nor any other closed-set file");
  assert.match(r.stdout, /# Dry run — nothing written to disk\./, "…and must SAY it wrote nothing");
});
