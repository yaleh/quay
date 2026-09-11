// checked-in-write-check.test.mjs — pins the three readings of the checked-in-write criterion
// (gap-fixture-dir-write-races-whole-tree-copy, AC4).
//
// The criterion must be able to take FALSE, so each arm here is a real reading, not a restatement:
//   red            — an input that creates an entry under the checked-in tree      ⇒ exit 1, path named
//   green          — an input that writes only under os.tmpdir()                  ⇒ exit 0
//   not-evaluated  — no inputs matched                                            ⇒ exit 3
//   not-evaluated  — an input whose module evaluation never completed             ⇒ exit 3
//
// The tree under judgement is a FABRICATED root in a temp dir (guard + runner copied into it), not
// this repository: a test for "no test writes into the checked-in tree" must not itself write into
// the checked-in tree — the red arm would otherwise be self-defeating. The fabricated root also
// keeps the arms independent of this repo's fixture contents.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO, "plugin", "scripts", "checked-in-write-check.ts");

/** A minimal workspace the criterion can judge: <root>/plugin/{scripts,fixtures}. */
function mkFakeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ciw-root-"));
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "fixtures", "wf"), { recursive: true });
  for (const f of ["checked-in-write-guard.cjs", "checked-in-write-run.cjs"]) {
    fs.copyFileSync(path.join(REPO, "plugin", "scripts", f), path.join(root, "plugin", "scripts", f));
  }
  return root;
}

function mkInput(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ciw-in-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}

function runChecker(args) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

describe("checked-in-write-check", () => {
  it("RED: an input creating an entry under the checked-in tree fails and names it", () => {
    const root = mkFakeRoot();
    const target = path.join(root, "plugin", "fixtures", "wf", "_probe");
    const input = mkInput("red.test.mjs", `
      import fs from "node:fs";
      import path from "node:path";
      const t = ${JSON.stringify(target)};
      fs.mkdirSync(t, { recursive: true });
      fs.writeFileSync(path.join(t, "e.jsonl"), "{}\\n");
      fs.rmSync(t, { recursive: true, force: true });
    `);
    const r = runChecker(["--root", root, "--files", input]);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /mkdirSync/, "the offending verb is named");
    assert.ok(r.stderr.includes(target), `the offending path is named:\n${r.stderr}`);
    assert.equal(fs.existsSync(target), false, "the probe cleaned up after itself");
  });

  it("GREEN: an input writing only under os.tmpdir() passes", () => {
    const root = mkFakeRoot();
    const input = mkInput("green.test.mjs", `
      import fs from "node:fs";
      import os from "node:os";
      import path from "node:path";
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "ciw-scratch-"));
      fs.writeFileSync(path.join(d, "e.jsonl"), "{}\\n");
      fs.rmSync(d, { recursive: true, force: true });
    `);
    const r = runChecker(["--root", root, "--files", input]);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /PASS: no checked-in-tree writes/);
  });

  it("NOT-EVALUATED: no input files matched", () => {
    const root = mkFakeRoot();
    const r = runChecker(["--root", root, "--dir", "plugin/test-does-not-exist"]);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /NOT-EVALUATED: /);
    assert.match(r.stderr, /nothing was judged/);
  });

  it("NOT-EVALUATED: an input whose module evaluation never completed", () => {
    const root = mkFakeRoot();
    const input = mkInput("broken.test.mjs", `import { x } from "./no-such-module-xyz.mjs";\n`);
    const r = runChecker(["--root", root, "--files", input]);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /did not finish evaluation/);
    assert.match(r.stderr, /UNREAD, not clean/);
  });

  // The arms above judge a fabricated root; this one judges THIS repository, over the file whose
  // three temp dirs started this task. Without it the invariant would only be known to hold for a
  // test double — and the file that regressed once could regress again with the suite still green.
  // Cost: one child process (~0.5s).
  it("GREEN on this repository: the fixed replay test writes nothing into the checked-in tree", () => {
    const input = path.join(REPO, "plugin", "test", "workflow-replay.test.mjs");
    const r = runChecker(["--root", REPO, "--files", input]);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /PASS: no checked-in-tree writes/);
  });
});
