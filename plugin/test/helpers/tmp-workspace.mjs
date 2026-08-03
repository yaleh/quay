// tmp-workspace.mjs — shared mkdtemp helper for the test suite.
//
// gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call: the /tmp (tmpfs) leak was caused by
// test files that mkdtemp()'d fixture dirs and never removed them. The previous round fixed the then
// top-5 by writing one-off `finally { rmSync(...) }` blocks per site; that only covered the sites
// that were edited, and the hidden partial-cleanup files (a mkdtemp helper whose returned dir no
// caller removes) kept leaking ~1,800 dirs/hour.
//
// THIS helper centralizes the mkdtemp + cleanup pair: every directory it creates is registered with a
// node:test file-level `after()` hook (the same pattern document-store/adr-store adopted) and removed
// automatically at the end of the importing test file. A test that needs a tmp workspace calls
// `makeTmpWorkspace(tag, { nativeBin, nativeProviderDir })` (or `makeTmpDir(tag)`) instead of
// hand-writing `fs.mkdtempSync(...)` + its own cleanup — one cleanup point per file, shared across
// packages (packages/quay, packages/quay-backlog, experiments/...) via a relative import.
//
// The file-level `after()` is registered per importing test file (node --test runs each file in its
// own process), so the tracked-dirs list never crosses file boundaries.
//
// Isolation contract R1: this helper writes only to per-run-unique os.tmpdir() paths — never a fixed
// path under the shared checkout.

import { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Directories created by this helper, removed once at the end of the importing test file. */
const _created = new Set();

after(() => {
  for (const dir of _created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort: the dir may already be gone (a test's own cleanup ran first)
    }
  }
  _created.clear();
});

/** mkdtemp under os.tmpdir() with automatic removal at the end of the test file. */
export function makeTmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), tag));
  _created.add(dir);
  return dir;
}

/**
 * A disposable native-provider workspace: a tasks dir + a workspace root with a `.quay/config.yml`
 * (provider map form with mcp_entry, mirroring gate.test.mjs makeWorkspace()). Both dirs are removed
 * automatically at the end of the test file. Returns { workspaceRoot, tasksDir }.
 *
 * `tag` must be a unique-per-test prefix (e.g. `quay-qeng1-ac1`). `opts` may carry the native
 * package's `nativeBin` / `nativeProviderDir` paths when the tests drive the real CLI; when omitted,
 * only the two dirs + `.quay/` are created (no config.yml).
 */
export function makeTmpWorkspace(tag, { nativeBin, nativeProviderDir } = {}) {
  const tasksDir = makeTmpDir(`${tag}-tasks-`);
  const workspaceRoot = makeTmpDir(`${tag}-ws-`);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  if (nativeBin && nativeProviderDir) {
    fs.writeFileSync(
      path.join(workspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
        `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
        "",
      ].join("\n")
    );
  }
  return { workspaceRoot, tasksDir };
}
