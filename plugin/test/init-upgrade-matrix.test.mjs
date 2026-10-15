// init-upgrade-matrix.test.mjs — the INIT UPGRADE MATRIX: every historical release's REAL
// `quay init` output, put through the CURRENT `quay init`, must end up valid — without losing the
// user's own content.
//
// (GOAL-029 AC-333; the release rehearsal of 2026-10-07 found a real project upgraded by the then
// current init whose `config validate` was still red, so "an upgrade always yields a config that
// matches the new version" was an assertion, not a measurement — 硬规则 4.)
//
// WHAT IS PINNED, per fixture `plugin/test/fixtures/init-matrix/v<X>/config.yml`
// (the bytes that tag's own init wrote; provenance in the sibling `PROVENANCE`, procedure in
// `README.md` next to them):
//
//   · the fixture set is REAL: >= 3 version dirs, each carrying `config.yml` + `PROVENANCE`, every
//     `PROVENANCE` `tag:` present in `git tag`, and the fixtures pair-wise DISTINCT (a copied
//     fixture would be caught by both the distinctness and the recorded-sha check);
//   · the CURRENT init, run over a copy of the fixture with a user comment / a user-pinned value /
//     an unknown top-level key injected, exits 0 and yields a config that validates — judged by
//     BOTH surfaces, `quay config validate` (CLI) and MCP `config_validate` (through the real stdio
//     server), because those two are the judge the engine itself calls (init.ts → validateConfigText);
//   · the injected comment, the user's own value, and the unrecognized key SURVIVE;
//   · the keys this version RETIRED (providers.native.path / mcp_entry) are GONE — an arm that at
//     least one fixture actually exercises (asserted separately, so the absence assertion cannot be
//     vacuous for the whole matrix);
//   · a SECOND run is byte-identical (the upgrade is idempotent; a version-level no-op must not
//     rewrite the file).
//
// Isolation: every workspace is a fresh mkdtemp under a DISK-BACKED temp root; no network, no real
// ~/.claude, no real project. CLAUDE_PLUGIN_ROOT is stripped from the child env so the plugin root
// resolves from the running Core module (selfPluginRoot) instead of whatever the ambient session
// exports. `os.tmpdir()` is the first candidate so TMPDIR decides (the CI job exports
// TMPDIR=${{ runner.temp }} — gap-ci-test-job-tmpdir-on-disk-not-tmpfs); see scratchBase() for why
// a tmpfs TMPDIR is skipped rather than used.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const coreBin = path.join(repoRoot, "packages", "quay", "bin", "quay.ts");
const fixturesDir = path.join(__dirname, "fixtures", "init-matrix");

// Every temp workspace is removed once at the end of this file (the carrier-array + after()
// pattern — a mkdtemp fixture without cleanup leaks a temp dir per run).
const TMP_DIRS = [];
after(() => {
  for (const dir of TMP_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

/** The version-dir names, sorted — `v0.14.0`, `v0.15.0`, … */
function listVersions() {
  return fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^v\d/.test(e.name))
    .map((e) => e.name)
    .sort();
}

const VERSIONS = listVersions();

function fixtureConfigPath(v) { return path.join(fixturesDir, v, "config.yml"); }
function fixtureProvenancePath(v) { return path.join(fixturesDir, v, "PROVENANCE"); }
function readFixture(v) { return fs.readFileSync(fixtureConfigPath(v), "utf8"); }
function sha256(text) { return createHash("sha256").update(text, "utf8").digest("hex"); }

/** Child env with CLAUDE_PLUGIN_ROOT stripped: the plugin root must resolve from the running Core
 *  module (plugin-root.ts `selfPluginRoot`), not from an ambient session export — otherwise the
 *  test's verdict would depend on the shell it happens to run in. */
function childEnv() {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

/** Run the CURRENT Core CLI; returns { status, stdout, stderr }. */
function runCore(args, cwd) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", coreBin, ...args],
    { cwd: cwd ?? repoRoot, encoding: "utf8", env: childEnv(), timeout: 120_000 },
  );
}

/** Drive the REAL MCP surface (stdio) and call `config_validate` in `workspaceRoot`. */
async function mcpConfigValidate(workspaceRoot) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--no-warnings", "--experimental-strip-types", coreBin, "mcp"],
    cwd: workspaceRoot,
    env: childEnv(),
    stderr: "pipe",
  });
  const client = new Client({ name: "init-upgrade-matrix", version: "0.0.1" });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: "config_validate", arguments: {} });
    const structured = res.structuredContent;
    if (structured && typeof structured === "object" && "ok" in structured) return structured;
    return JSON.parse(res.content?.[0]?.text ?? "{}");
  } finally {
    await client.close();
  }
}

// ── Staging: the fixtures' GENERATION layout is rebased onto a scratch this test owns ───────────
//
// A fixture carries, verbatim, the absolute layout its release's init wrote on the day it was
// generated (README.md's `BASE=/tmp/quay-init-matrix-gen`): `loop.repo_root`, `loop.worktree_root`,
// `providers.native.path` / `mcp_entry`, and the four `QUAY_NATIVE_*` carrier dirs. Replaying those
// bytes against the CURRENT `quay init` on a host whose `/tmp` is tmpfs — the CI runner's
// `gh-runner-quay` container mounts `--tmpfs /tmp` — hands init a `loop.worktree_root` that is
// memory, and init FAIL-CLOSES on that BY DESIGN (init.ts validateWorktreeRoot; the 2026-08-04
// machine-wide OOM):
//
//   worktree root '/tmp/quay-init-matrix-gen/scratch-rel-v0.14.0/../scratch-rel-v0.14.0-worktrees'
//   is on tmpfs ('/tmp' is tmpfs) — this is memory, not disk.
//
// That is an environment verdict about the GENERATION host, not a verdict about the upgrade under
// test — so the generation base is swapped for a scratch root this test owns, on a disk-backed base.

/** Filesystem type of `p` — the probe init itself runs (init.ts validateWorktreeRoot: `stat -f -c %T`). */
function fsTypeAt(p) {
  const r = spawnSync("stat", ["-f", "-c", "%T", p], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

/** A disk-backed temp base to stage scratch under, or null when this host has none.
 *  `os.tmpdir()` is FIRST so TMPDIR is the deciding input (the CI job exports TMPDIR=runner.temp —
 *  gap-ci-test-job-tmpdir-on-disk-not-tmpfs). A tmpfs candidate is skipped rather than used: every
 *  rebased `loop.worktree_root` would land on it, and init fail-closes on a tmpfs worktree root by
 *  design, which would turn this upgrade matrix into a test of the host's memory. `/var/tmp` is the
 *  POSIX persistent-temp fallback (same idiom as worktree-root-fs-check.test.mjs's `diskTemp()`),
 *  and it is LAST, so TMPDIR still wins whenever TMPDIR is on disk. */
function scratchBase() {
  for (const base of [os.tmpdir(), "/var/tmp"]) {
    try {
      if (fs.existsSync(base) && fsTypeAt(base) !== "tmpfs") return base;
    } catch { /* unreadable candidate — try the next one */ }
  }
  return null;
}

const SCRATCH_BASE = scratchBase();

/** The absolute base fixture `v` was generated in: its `loop.repo_root` is `<base>/scratch-rel-<v>`,
 *  and every other baked path is that directory's sibling or child. Read OUT of the fixture rather
 *  than restated here, so this file never carries a second copy of the generation layout. */
function fixtureGenerationBase(v) {
  const repoRoot = YAML.parse(readFixture(v))?.loop?.repo_root;
  assert.ok(
    typeof repoRoot === "string" && path.isAbsolute(repoRoot),
    `${v}: fixture must record an absolute loop.repo_root — that is where its generation layout is read from`,
  );
  const base = path.dirname(repoRoot);
  assert.ok(
    base.split(path.sep).filter(Boolean).length >= 2,
    `${v}: refusing to rebase from '${base}' — a shallower base could rewrite unrelated absolute paths`,
  );
  return base;
}

/** Swap the fixture's generation base for `scratchRoot`, keeping the fixture's SHAPE (absolute paths,
 *  and the `…/scratch-rel-<v>/../scratch-rel-<v>-worktrees` sibling spelling init persists verbatim).
 *  The bytes under fixtures/init-matrix/ are untouched: this only stages the config in the workspace,
 *  exactly as `injectUserEdits` already edits the fixture's own text for the duration of a run. */
function rebaseOntoScratch(raw, v, scratchRoot) {
  const base = fixtureGenerationBase(v);
  const rebased = raw.split(base).join(scratchRoot);
  assert.notEqual(rebased, raw, `${v}: '${base}' does not occur in the fixture config — nothing was rebased`);
  return rebased;
}

/** A fresh scratch workspace on a disk-backed temp root; `.quay/config.yml` is the (rebased,
 *  user-edited) fixture. The rebase target IS the workspace, so the fixture's `loop.repo_root` lands
 *  on a real directory and its `loop.worktree_root` lands on that directory's (disk) filesystem. */
function makeWorkspaceWithConfig(v, raw) {
  const ws = fs.mkdtempSync(path.join(SCRATCH_BASE, "quay-init-matrix-"));
  TMP_DIRS.push(ws);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), rebaseOntoScratch(injectUserEdits(raw), v, ws), "utf8");
  return ws;
}

const USER_COMMENT = "# USER-NOTE-KEEP-ME — a user's own comment, must survive the upgrade";

/** Inject the three things a user owns: a comment, a value this version still accepts, and an
 *  unknown top-level key. Applied by substitution (and asserted) so a fixture that lost its
 *  `test_command` line fails loudly instead of silently testing nothing. */
function injectUserEdits(raw) {
  const re = /(\n\s*test_command:\s*)([^\n]*)(\n)/;
  assert.match(raw, re, "fixture should carry a `loop.test_command` line to pin");
  const replaced = raw.replace(re, "$1make verify$3");
  assert.ok(replaced.includes("test_command: make verify"), "injection of the user value failed");
  return `${replaced}\n${USER_COMMENT}\nmy_custom_section:\n  keep: true\n`;
}

// ── The fixture set is REAL ────────────────────────────────────────────────────────────────────

test("fixtures: >= 3 version dirs, each with config.yml + PROVENANCE", () => {
  assert.ok(
    VERSIONS.length >= 3,
    `expected >= 3 historical fixtures under ${fixturesDir}, found ${VERSIONS.length}: ${VERSIONS.join(", ")}`,
  );
  for (const v of VERSIONS) {
    assert.ok(fs.existsSync(fixtureConfigPath(v)), `${v}/config.yml is missing`);
    assert.ok(fs.existsSync(fixtureProvenancePath(v)), `${v}/PROVENANCE is missing`);
  }
});

test("fixtures: every PROVENANCE tag exists in `git tag` (they came from a real release)", () => {
  const tagList = spawnSync("git", ["tag"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(tagList.status, 0, `git tag failed: ${tagList.stderr}`);
  const tags = new Set(tagList.stdout.split("\n").map((s) => s.trim()).filter(Boolean));

  for (const v of VERSIONS) {
    const prov = fs.readFileSync(fixtureProvenancePath(v), "utf8");
    const m = /^tag:[ \t]*(\S+)/m.exec(prov);
    assert.ok(m, `${v}/PROVENANCE must record a \`tag:\` line`);
    assert.ok(tags.has(m[1]), `${v}/PROVENANCE names tag "${m[1]}" which is not in \`git tag\``);
    assert.match(prov, /^config-sha256:[ \t]*[0-9a-f]{64}/m, `${v}/PROVENANCE must record a config-sha256`);
  }
});

test("fixtures: PROVENANCE config-sha256 matches the fixture bytes it describes", () => {
  for (const v of VERSIONS) {
    const prov = fs.readFileSync(fixtureProvenancePath(v), "utf8");
    const recorded = /^config-sha256:[ \t]*([0-9a-f]{64})/m.exec(prov)?.[1];
    assert.ok(recorded, `${v}/PROVENANCE is missing a 64-hex config-sha256`);
    assert.equal(
      recorded,
      sha256(readFixture(v)),
      `${v}/config.yml does not match the sha recorded in its PROVENANCE — the fixture was edited`,
    );
  }
});

test("fixtures are pair-wise distinct — 夹具互不相同 (a copy would masquerade as a second release)", () => {
  const shas = VERSIONS.map((v) => sha256(readFixture(v)));
  const dupes = shas.filter((s, i) => shas.indexOf(s) !== i);
  assert.equal(
    new Set(shas).size,
    shas.length,
    `two fixtures are byte-identical (${dupes.join(", ")}): a historical shape was copied, not generated`,
  );
});

test("at least one fixture carries the now-retired native binding (the removal arm is exercised)", () => {
  const carriers = VERSIONS.filter((v) => {
    const d = YAML.parse(readFixture(v));
    return d?.providers?.native?.path !== undefined || d?.providers?.native?.mcp_entry !== undefined;
  });
  assert.ok(
    carriers.length >= 1,
    "no fixture carries providers.native.path/mcp_entry — the retired-key removal arm would be vacuous",
  );
});

// ── The upgrade behavior, one test per historical shape ────────────────────────────────────────

for (const v of VERSIONS) {
  test(`${v}: current init upgrades to a VALID, comment-preserving, idempotent config`, { timeout: 180_000 }, async (t) => {
    // NOT-EVALUATED, not a pass (硬规则 3b): with no disk-backed temp root the fixture's
    // `loop.worktree_root` could only be staged on tmpfs, which init fail-closes on — the upgrade
    // would go unmeasured, so say so instead of reporting a verdict about the host's memory.
    if (SCRATCH_BASE === null) {
      t.skip("no disk-backed temp root (TMPDIR and /var/tmp are both tmpfs or absent) — cannot stage a non-tmpfs loop.worktree_root");
      return;
    }

    const raw = readFixture(v);
    const before = YAML.parse(raw);

    const ws = makeWorkspaceWithConfig(v, raw);
    const configPath = path.join(ws, ".quay", "config.yml");

    // 1. the upgrade itself
    const up = runCore(["init", "--root", ws]);
    assert.equal(up.status, 0, `${v}: \`quay init\` upgrade failed (${up.status})\n${up.stdout}\n${up.stderr}`);
    const upgraded = fs.readFileSync(configPath, "utf8");

    // 2. it VALIDATES — CLI and the real MCP tool (the same judge the engine calls internally)
    const cli = runCore(["config", "validate", "--root", ws]);
    assert.equal(cli.status, 0, `${v}: \`quay config validate\` says the upgraded config is invalid\n${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stdout, /Config valid/);

    const mcp = await mcpConfigValidate(ws);
    assert.equal(mcp.ok, true, `${v}: MCP config_validate ok:false — ${JSON.stringify(mcp.issues)}`);

    // 3. the user's own content survives
    const d = YAML.parse(upgraded);
    assert.ok(upgraded.includes(USER_COMMENT), `${v}: the user's comment was dropped by the upgrade`);
    assert.equal(d?.loop?.test_command, "make verify", `${v}: a user-pinned loop.test_command was overwritten`);
    assert.equal(d?.my_custom_section?.keep, true, `${v}: an unknown top-level key was dropped`);
    assert.match(up.stderr, /unrecognized top-level config key "my_custom_section"/, `${v}: the unknown key was not warned about`);

    // 4. the keys this version RETIRED are gone
    assert.equal(d?.providers?.native?.path, undefined, `${v}: retired providers.native.path survived the upgrade`);
    assert.equal(d?.providers?.native?.mcp_entry, undefined, `${v}: retired providers.native.mcp_entry survived the upgrade`);

    // 5. this version's required loop keys were filled from the version defaults
    assert.equal(d?.loop?.board, "native", `${v}: loop.board was not filled`);
    assert.deepEqual(d?.loop?.gates, ["acceptance"], `${v}: loop.gates was not filled`);

    // 6. idempotent — the second run must be a byte-level no-op
    const up2 = runCore(["init", "--root", ws]);
    assert.equal(up2.status, 0, `${v}: second \`quay init\` failed (${up2.status})\n${up2.stderr}`);
    assert.equal(fs.readFileSync(configPath, "utf8"), upgraded, `${v}: a second upgrade rewrote the config`);

    // The precondition only matters where the key existed; assert it so the removal arm above is
    // known to have had something to remove for THIS fixture.
    if (before?.providers?.native?.path !== undefined) {
      assert.ok(before.providers.native.path.length > 0);
    }
  });
}
