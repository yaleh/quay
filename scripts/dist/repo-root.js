import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}
function mainCheckoutRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  const dir = path.resolve(startDir);
  let commonDir = "";
  try {
    commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    commonDir = "";
  }
  if (!commonDir) {
    try {
      commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], {
        encoding: "utf8",
        timeout: 5e3,
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      return "";
    }
    if (commonDir && !path.isAbsolute(commonDir)) commonDir = path.resolve(dir, commonDir);
  }
  if (!commonDir) return "";
  const main = path.dirname(commonDir);
  try {
    return fs.realpathSync(main);
  } catch {
    return main;
  }
}
export {
  mainCheckoutRoot,
  repoRoot
};
