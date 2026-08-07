// @test-group engine
// quay-init-loop-helpers.mjs — shared helpers for the quay-init-loop test family.
//
// Split out of quay-init-loop.test.mjs (2026-08-07, inner red-window fix): the original 1286-line /
// 54-test file exhausted the node:test worker event loop under heavy blocking spawnSync (each of
// 37 --loop tests spawns a real quay-init.sh, which spawns python3 children), self-failing at
// ~167s with 'Promise resolution is still pending but the event loop has already resolved'.
// Splitting into smaller files (each ~18 tests, well under the exhaustion threshold) keeps each
// file green; the shared helpers live here so all split files resolve the SAME quay-init surface.
//
// gap-quay-init-laydown-dominant-red-suite-blocker (root-cause verdict 2026-08-07 06:3x):
//   the 44-failure cluster was (1) laydown/referenced-not-landed gaps — already fixed — and
//   (2) this worker event-loop exhaustion from an oversized single test file.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const pluginDir = path.resolve(__dirname, "..");

export function makeTmp(prefix = "quay-init-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A worktree root the validation will ACCEPT: a real disk path, not tmpfs. /tmp is tmpfs on dev
// boxes (and the whole point of gap-the-shipped-tick-doc-... is that worktrees must NOT live
// there), so the sibling-of-repo default would resolve to /tmp for a /tmp-backed test workspace
// and quay-init would correctly fail closed. /var/tmp is the disk-backed tmp on Linux; prefer it.
// The dirs land in a carrier array cleaned by an after() hook (the doc-store/adr-store pattern),
// so R6 does not read the helper-return as an uncovered mkdtemp leak.
const _worktreeTestRoots = [];
after(() => {
  for (const d of _worktreeTestRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
export function diskWorktreeRoot() {
  let dir = null;
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") { dir = fs.mkdtempSync(path.join(base, "quay-wt-test-")); break; }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-test-"));
  _worktreeTestRoots.push(dir);
  return dir;
}

export function runInit(workspace, args = [], pluginRoot = pluginDir) {
  // --loop tests now need an explicit disk worktree root (the default sibling-of-repo of a /tmp
  // test workspace is tmpfs and is correctly rejected). Inject one BEFORE the caller's args so an
  // explicit --worktree-root in args wins (last flag wins in the parser).
  const loop = args.includes("--loop");
  const extra = loop && !args.some((a) => a === "--worktree-root") ? ["--worktree-root", diskWorktreeRoot()] : [];
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...extra, ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
}

// ── Shared laydown template (gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles AC2) ──
// Serial-segment analysis (2026-08-07): install/laydown is ~50% of the serial phase — every
// install-family test ran a REAL `quay-init --loop` (~6s in-suite, ~34s cold) into a fresh temp
// workspace. AC2: ONE real install per FILE process → a READ-ONLY template → each test `cp -a`
// the template and does its own delta. Two hard requirements:
//   ① `cp -a` preserves symlinks + permissions (so byte-identical assertions don't distort);
//   ② the template is READ-ONLY (write bits stripped from the whole tree) so one test's pollution
//      can never corrupt the shared template for every other test.
// The template's captured install result is returned too: every family test uses the SAME standard
// args (--project proj --test-command 'node --test' --tmux-session proj-0:0.0), so output-asserting
// tests keep asserting against the template's stdout/stderr (with the template's absolute path
// rewritten to the copy's) without a second real install.
const STANDARD_INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];
const _laydownTemplate = { ws: null, install: null, wtRoot: null };

// laydownTemplate() — lazily builds the read-only template for THIS file process (per-file
// isolation: the template lives in a module-level variable + an os.tmpdir() mkdtemp, never a
// shared-checkout path, so the test-isolation R3/R8 ratchets stay green). FAILS LOUD: a template
// install that does not exit 0 is a real product defect, not something to paper over.
export function laydownTemplate() {
  if (_laydownTemplate.ws) return _laydownTemplate;
  const ws = makeTmp("laydown-tmpl-");
  const wtRoot = diskWorktreeRoot();
  const install = runInit(ws, [...STANDARD_INIT_ARGS(ws), "--worktree-root", wtRoot]);
  if (install.status !== 0) {
    cleanup(ws);
    throw new Error(`laydown template install failed:\n${install.stderr}`);
  }
  // Read-only template (AC2 ②): strip WRITE bits from every dir + file; keep read + execute bits
  // so laid-down executables stay runnable and the tree stays traversable. Symlinks are left
  // untouched (permissions do not apply to a link itself; its target is walked normally).
  const makeReadOnly = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      const mode = fs.statSync(p).mode;
      if (e.isDirectory()) { fs.chmodSync(p, mode & ~0o222); makeReadOnly(p); }
      else { fs.chmodSync(p, mode & ~0o222); }
    }
  };
  makeReadOnly(ws);
  _laydownTemplate.ws = ws;
  _laydownTemplate.install = install;
  _laydownTemplate.wtRoot = wtRoot;
  return _laydownTemplate;
}

// laydownWorkspace([prefix]) — a fresh WRITABLE copy of the read-only laydown template, with the
// template's absolute workspace path rewritten to the copy's path in the config files that embed
// it, and the loop.worktree_root pointed at a FRESH disk root (so two copies never share a
// worktree root). Returns { ws, install } — install is the TEMPLATE's captured install result
// (paths rewritten to the copy), so output-asserting tests keep their assertions without a second
// real install.
export function laydownWorkspace(prefix = "laydown-") {
  const t = laydownTemplate();
  const ws = makeTmp(prefix);
  // cp -a preserves symlinks + permissions (AC2 ①). The source template is read-only, so the copy
  // inherits read-only perms; restore write bits on the COPY so the test can do its own delta.
  const cp = spawnSync("cp", ["-a", `${t.ws}/.`, ws], { encoding: "utf8" });
  if (cp.status !== 0) {
    cleanup(ws);
    throw new Error(`laydown template cp -a failed:\n${cp.stderr}`);
  }
  spawnSync("chmod", ["-R", "u+w", ws]);
  // Rewrite the template's absolute path → the copy's path where the installed tree embeds it
  // (.quay/config.yml carries the provider path / tasks_dir / mcp_entry / repo_root), and give the
  // copy a FRESH loop.worktree_root (never the template's, so copies never collide on worktrees).
  const cfg = path.join(ws, ".quay", "config.yml");
  if (fs.existsSync(cfg)) {
    const freshWt = diskWorktreeRoot();
    const rewritten = fs.readFileSync(cfg, "utf8")
      .split(t.ws).join(ws)
      .split("\n").map((line) =>
        line.startsWith("  worktree_root:") ? `  worktree_root: ${freshWt}` : line)
      .join("\n");
    fs.writeFileSync(cfg, rewritten);
  }
  const install = {
    status: t.install.status,
    stdout: t.install.stdout.split(t.ws).join(ws),
    stderr: t.install.stderr.split(t.ws).join(ws),
  };
  return { ws, install };
}

// extractRefs(pluginRoot, prefix): every `<prefix>/<file>` reference in the shipped skills + tick
// docs — the SAME extraction quay-init.sh's verify_referenced_landed uses, so the test's landing
// assertion and the installer's own check cannot disagree about what the referenced set is.
export function extractRefs(pluginRoot, prefix) {
  const files = [];
  for (const d of fs.readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(pluginRoot, "skills", d.name, "SKILL.md");
    if (fs.existsSync(f)) files.push(f);
  }
  const loopDir = path.join(pluginRoot, "loop");
  for (const f of fs.readdirSync(loopDir)) {
    if (f.endsWith(".md")) files.push(path.join(loopDir, f));
  }
  const re = new RegExp(`(?:${prefix})/[a-zA-Z0-9._-]+`, "g");
  const refs = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(text)) !== null) refs.add(m[0]);
  }
  return [...refs].sort();
}

// declaredSet(pluginRoot, kind): the machine-readable `<!-- <kind>: <path> -->` declarations in
// plugin/skills/init/SKILL.md — `self-create` (local-state files the first run creates, AC8) and
// `reference-doc` (quay-specific template prose, not a loop-mechanism deliverable).
export function declaredSet(pluginRoot, kind) {
  const skill = fs.readFileSync(path.join(pluginRoot, "skills", "init", "SKILL.md"), "utf8");
  const re = new RegExp(`<!-- ${kind}: ([a-zA-Z0-9._/-]+) -->`, "g");
  const set = new Set();
  let m;
  while ((m = re.exec(skill)) !== null) set.add(m[1]);
  return set;
}
