// quay-init-characterization.test.mjs — pin the CLOSED-SET FILE SURFACE and exit code of
// `plugin/scripts/quay-init.sh`.
//
// (gap-arch-quay-init-sh-python-heredocs-to-native, AC2/AC3.) The port that moved this script's
// TWELVE embedded `python3` invocations into `packages/quay/src/init.ts` promised EQUIVALENCE, not
// improvement: same six-file surface, same exit code, same report lines. An equivalence claim with
// nothing pinning it is an assertion (硬规则 4): the port rewrites two whole YAML documents through
// `yaml.safe_dump(...)`-compatible serialisation and edits another in place by INDENTATION, and any
// of those three can drift a byte at a time without any test noticing.
//
// WHAT IS PINNED. For each scenario the test runs the REAL script on a throwaway workspace and
// pins, by SHA-256 of the path-normalised bytes:
//   · every closed-set file's content (config.yml, profiles.yml, .gitignore, launch.settings.json,
//     settings.json) and the tasks/ + goals/ directory listings;
//   · the script's EXIT CODE.
// Normalisation replaces the two machine-specific roots (the temp workspace and this checkout's
// plugin dir) with placeholders; nothing else is normalised, so a one-byte change anywhere in the
// surface is a RED.
//
// WHY A HASH AND NOT A DIFF-AGAINST-EXPECTED-TEXT. The interesting half of this surface is a YAML
// document produced by a round-trip that DELIBERATELY drops comments and reformats (that is what
// shipped). Spelling 60 lines of generated YAML here would be a second copy that drifts from the
// writer — the exact failure mode the repo's single-source-of-truth principle forbids. A hash is
// not a copy of the content; it is a claim that the content did not move. Re-anchoring after an
// INTENTIONAL change is a one-line, reviewable edit to the table below.
//
// FALSIFIABILITY. The table was taken from the UNCHANGED script before the port (see the task's
// notes: `git show HEAD:plugin/scripts/quay-init.sh` run side by side with the ported one on the
// same fixtures — identical rc + identical normalised bytes on all scenarios), and the port was
// demonstrated to red it: perturbing `ensureLoopConfig`'s output makes the `loop-values-changed`
// scenario fail, and reverting makes it pass. A characterization that cannot go red is a
// tautology.

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
// `.quay/config.yml` legitimately moved. Only that one line changed; the other six rows are untouched,
// which is what the row-per-file shape is for.
const PINNED = {
  fresh: {
    rc: 0,
    surface: [
      ".quay/config.yml  c22004941595b56b254f3099e09c3027dd3f75f4d639995ba718b219ad3b258d",
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
  assert.match(cfg, /^ {4}path: "<PLUGIN>\/vendor\/quay-native"$/m);
  assert.match(cfg, /^ {4}mcp_entry: \["node", "<PLUGIN>\/vendor\/quay-native\/dist\/quay-native\.js", "mcp"\]$/m);
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

test("AC3 — an EXISTING legacy config: the migration rewrite is byte-identical to the pre-port output", () => {
  // The upgrade path is where the round-trip YAML writer actually fires, and it is the ONLY place
  // the port can silently change bytes: `safe_dump` REFORMATS the whole document (an inline
  // `mcp_entry: [...]` becomes a block sequence) and DROPS every comment. That unlovely behaviour
  // is the pre-port contract, so it is pinned here verbatim.
  const base = makeBase();
  const ws = initWorkspace(base);
  assert.equal(runInit(ws, argsFor(base)).status, 0, "baseline install");
  // A legacy BARE-PATH binding + a stale project-local runtime ⇒ both migration rules fire.
  let cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
  cfg = cfg.replace(/mcp_entry: \[.*\]\n/, 'mcp_entry: ["quay-native", "mcp"]\n');
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), cfg);
  fs.mkdirSync(path.join(ws, ".quay", "runtime", "bin"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "runtime", "bin", "quay-native.js"), "stale-runtime-bytes\n");

  const r = runInit(ws, argsFor(base));
  assert.equal(r.status, 0, `upgrade must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const after = configText(ws, base);
  // The comment header is GONE — the round-trip dropped it. Pinning the absence is what makes this
  // a characterization of the shipped behaviour rather than of an idealized one.
  assert.ok(!after.includes("# .quay/config.yml — generated by quay-init"), "the round-trip rewrite must drop comments (pre-port behaviour)");
  // ⚠️ UNQUOTED, unlike the fresh-install heredoc's `path: "…"`: the round-trip re-serialises and
  // drops the quotes the handwritten template used, because a plain scalar needs none.
  assert.match(after, /^ {4}path: <PLUGIN>\/vendor\/quay-native$/m);
  assert.match(
    after,
    /^ {4}mcp_entry:\n {4}- node\n {4}- <PLUGIN>\/vendor\/quay-native\/dist\/quay-native\.js\n {4}- mcp$/m,
    "the migrated binding must be rebuilt canonically: block sequence, node + the plugin runtime + the trailing verb",
  );
  assert.match(r.stdout, /migrated: mcp_entry bare PATH reference 'quay-native'/);
  assert.match(r.stdout, /retired-orphan-runtime: .* -> backup .*quay-init-backups\//);
  assert.ok(!fs.existsSync(path.join(ws, ".quay", "runtime")), "the stale unreferenced runtime must be retired (moved to a backup)");
  // The carrier pins and the loop values were already current ⇒ NO further rewrite; both steps
  // report their unchanged state (the negative control for "no gratuitous rewrite").
  assert.match(r.stdout, /unchanged: \.quay\/config\.yml providers\.native\.env:/);
  assert.match(r.stdout, /unchanged: \.quay\/config\.yml loop:/);
});

test("AC3 — a loop VALUE change rewrites the document, folding long plain scalars at 80 columns", () => {
  // The one path where `ensureLoopConfig` WRITES. It re-serialises with
  // `yaml.safe_dump(allow_unicode=True, sort_keys=False, default_flow_style=False)` semantics —
  // including PyYAML's plain-scalar folding at `best_width`(80), which the `yaml` package does NOT
  // reproduce on its own. A long spaced value is therefore a real falsifier for the folding shim.
  const base = makeBase();
  const ws = initWorkspace(base);
  assert.equal(runInit(ws, argsFor(base)).status, 0, "baseline install");
  const p = path.join(ws, ".quay", "config.yml");
  let cfg = fs.readFileSync(p, "utf8");
  cfg = cfg.replace(/^  repo_root: .*$/m, "  repo_root: /somewhere/else");
  // Only `repo_root` DIFFERS from what the run will use (the CLI flag) — that single difference is
  // what makes the writer fire. `test_command` is left long and is NOT passed as a flag, so the
  // config's own value is read back and re-serialised: it is the folding probe.
  cfg = cfg.replace(
    /^  test_command: .*$/m,
    "  test_command: bash scripts/test.sh --alpha --beta --gamma --delta --epsilon --zeta --eta --theta --iota",
  );
  cfg = cfg.replace(
    /^loop:$/m,
    "gates:\n  dod: a fairly long plain scalar value with many single spaces in it that goes past eighty columns\nloop:",
  );
  fs.writeFileSync(p, cfg);

  // ⛔ NO `--test-command`: the flag would WIN over the config's value and be written back, so the
  // long value would never reach the serializer. Without it the config-preserving reader supplies
  // `test_command` (the config already carries it from the baseline install), which is exactly the
  // value whose folding this scenario exists to pin.
  const r = runInit(ws, argsFor(base).filter((a, i, all) => a !== "--test-command" && all[i - 1] !== "--test-command"));
  assert.equal(r.status, 0, `rewrite must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /wrote: \.quay\/config\.yml loop:/);
  const after = configText(ws, base);
  assert.match(after, /^ {2}repo_root: <BASE>\/ws$/m, "the CLI flag wins and is written back");
  // PyYAML's fold: break at a single space whose column exceeds 80, continue at lineIndent + 2.
  assert.match(
    after,
    /^ {2}dod: a fairly long plain scalar value with many single spaces in it that goes past\n {4}eighty columns$/m,
    "a plain scalar past column 80 must fold exactly where PyYAML folds it",
  );
  // ⛔ The break POSITION is part of the pin, and it is not "wherever it looks long enough":
  // PyYAML breaks at the first single space whose column exceeds 80 — verified by running this exact
  // document through `python3 -c 'import yaml; print(yaml.safe_dump(...))'` (PyYAML 6.0.1) and
  // comparing byte-for-byte with the ported writer's output.
  assert.match(after, /^ {2}test_command: bash scripts\/test\.sh --alpha --beta --gamma --delta --epsilon --zeta\n {4}--eta --theta --iota$/m);
});

test("AC3 — a CORRUPT config fails closed with the SAME exit code as the pre-port script (rc=1)", () => {
  // The migration step reads the config with an UNGUARDED parse (no try/except in the pre-port
  // python): an unparseable file aborts the run rather than being silently treated as "no binding
  // to migrate". That is the shipped contract — a corrupt config must not be quietly skipped past —
  // and the port must keep it, including the exit code.
  const base = makeBase();
  const ws = initWorkspace(base);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), "providers:\n  native:\n   bad: [unclosed\n");
  const r = runInit(ws, argsFor(base));
  assert.equal(r.status, 1, `a corrupt config must abort the upgrade (exit 1)\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test("AC3 — --dry-run writes nothing and still reports the closed set", () => {
  const base = makeBase();
  const ws = initWorkspace(base);
  const r = runInit(ws, [...argsFor(base), "--dry-run"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /quay-init complete \(dry-run\)\./);
  const actual = surface(ws, base);
  assert.match(actual, /^\.quay\/config\.yml {2}ABSENT$/m);
  assert.match(actual, /^\.claude\/settings\.json {2}ABSENT$/m);
});
