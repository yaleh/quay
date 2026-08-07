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
