// @test-group engine
// md-deletion-token-evaporation-check.test.mjs — gap-md-deletion-token-evaporation-check
// Source-completeness 硬规则的产物化：一个提交从 *.md 净删 ≥阈值 行时，被删内容的独有词条集
// （删除后仓库零出现）非空即失败 + 清单。测：真实删除被拦、负控制（词条在别处仍在）不误报、
// 清单输出（非布尔）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const checker = path.resolve("plugin/scripts/md-deletion-token-evaporation-check.sh");

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

/** Build a throwaway git repo with an "add" commit containing docs/evap.md carrying <tokens>. File NOT deleted. */
function buildFixture(tokens) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evap-test-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "test");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  const body = `# Evap fixture\n\n${tokens.join(" ")} only in this file.\n` + Array.from({ length: 55 }, (_, i) => `line ${i} padding`).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "docs/evap.md"), body);
  git(dir, "add", "docs/evap.md");
  git(dir, "commit", "-q", "-m", "add");
  const add = git(dir, "rev-parse", "HEAD").trim();
  return { dir, add };
}

/** Delete docs/evap.md in a new commit → returns the del HEAD. */
function deleteDoc(dir) {
  git(dir, "rm", "-q", "docs/evap.md");
  git(dir, "commit", "-q", "-m", "del");
  return git(dir, "rev-parse", "HEAD").trim();
}

function runChecker(dir, a, b, threshold = 10) {
  try {
    const out = execFileSync("bash", [checker, "--diff", a, b, "--threshold", String(threshold), "--root", dir], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? "" };
  }
}

test("a real md deletion whose unique tokens vanish is FAILED with the token list (manager scenario)", () => {
  const { dir, add } = buildFixture(["ToolSearchXyz", "makeWorkspaceXyz", "gate-gameability-xyz"]);
  try {
    const del = deleteDoc(dir);
    const r = runChecker(dir, add, del);
    assert.equal(r.code, 1, `homeless tokens must fail (got ${r.code}: ${r.out})`);
    assert.match(r.out, /FAIL/, "failure output present");
    for (const tok of ["ToolSearchXyz", "makeWorkspaceXyz", "gate-gameability-xyz"]) {
      assert.match(r.out, new RegExp(tok), `token ${tok} listed (清单非布尔)`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("negative control — a deletion whose tokens still exist elsewhere PASSES (零出现才算无家)", () => {
  const { dir, add } = buildFixture(["EvapKeeperTokenOne", "EvapKeeperTokenTwo"]);
  try {
    // Give the tokens a home in a second doc that is NOT deleted.
    fs.writeFileSync(path.join(dir, "docs/keeper.md"), "EvapKeeperTokenOne EvapKeeperTokenTwo stay here\n");
    git(dir, "add", "docs/keeper.md");
    git(dir, "commit", "-q", "-m", "keeper");
    const del = deleteDoc(dir); // deletes only evap.md; keeper.md still holds the tokens
    const r = runChecker(dir, add, del);
    assert.equal(r.code, 0, `tokens still present elsewhere → PASS (got ${r.code}: ${r.out})`);
    assert.match(r.out, /PASS/, "PASS output");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("below-threshold deletion is not triggered (threshold 50, small delete)", () => {
  const { dir, add } = buildFixture(["EvapSmallDeleteXyz"]);
  try {
    // Append 3 lines (net-small change), commit, then remove only those 3 lines (net deletion < threshold).
    fs.appendFileSync(path.join(dir, "docs/evap.md"), "\nkeep1\nkeep2\nkeep3\n");
    git(dir, "add", "docs/evap.md");
    git(dir, "commit", "-q", "-m", "append");
    const mid = git(dir, "rev-parse", "HEAD").trim();
    const content = fs.readFileSync(path.join(dir, "docs/evap.md"), "utf8").replace("\nkeep1\nkeep2\nkeep3\n", "");
    fs.writeFileSync(path.join(dir, "docs/evap.md"), content);
    git(dir, "add", "docs/evap.md");
    git(dir, "commit", "-q", "-m", "trim-small");
    const small = git(dir, "rev-parse", "HEAD").trim();
    const r = runChecker(dir, mid, small, 50);
    assert.equal(r.code, 0, `below threshold → PASS/not triggered (got ${r.code}: ${r.out})`);
    assert.match(r.out, /PASS/, "PASS (no md net-deletion ≥ threshold)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
