// @test-group product
// driver-control.test.mjs — GOAL-033/AC-350: the driver CONTROL CLIENT moved from `cli/driver.ts`
// into core-root, and so did the driver verb/kind vocabulary.
//
// WHY THESE THREE GROUPS (they are the three things the move can silently break):
//   (a) the refusal path still refuses — and now also answers `root:null, kernelPath:null`, the two
//       fields the CLI's instrument decoration keys on (a refusal must not look like a delegation);
//   (b) the module really SITS in core-root — `driver-control.ts` imports neither `./cli/` nor
//       `./fan-in/`, `driver-vocab.ts` is a zero-import leaf, and `probeInstruments` is still called
//       from exactly one place (`cli/driver.ts`). This is the structural half of AC-350, asserted
//       ON THE SOURCE BY POSITION (硬规则 2: a prose mention in a comment is not a hit).
//   (c) the CLI PRESENTATION contract survives the move: `quay driver status --kind worker --json`
//       still carries the `instruments` reading and `--kind promotion` still does not. ⛔ BEFORE this
//       move the decoration lived inside `runDriver`, which made it reachable from every caller; it
//       is now applied by `handleDriver` alone, so nothing else pinned it. This group is that pin.
//
// ⛔ NOT a re-test of `runDriver`'s spawn semantics: `server.test.mjs` already pins the sync/async
// agreement and `serve-handlers.test.mjs` pins the web delegation. This file owns the MOVE.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../bin/quay.ts";
import { runDriver, runDriverAsync } from "../src/driver-control.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src");

// ── the shared scanning helpers (same shape as AC-350's own criterion, so the test and the gate
//    cannot disagree about what "an import edge" means) ──────────────────────────────────────────

/** Drop whole-line comments — the position-based judgment (硬规则 2): a path spelled inside a
 *  comment is NOT an import edge. ⛔ Deliberately line-based and conservative (matches the AC-350
 *  criterion's own `live()`), so both agree on the same input. */
function live(text) {
  return text
    .split("\n")
    .filter((l) => {
      const s = l.trim();
      return !(s.startsWith("//") || s.startsWith("*") || s.startsWith("/*"));
    })
    .join("\n");
}

const RE_CLI = /(?:\bfrom|\bimport\s*\()\s*["']\.\/cli\//g;
const RE_FAN = /(?:\bfrom|\bimport\s*\()\s*["']\.\/fan-in\//g;

const count = (text, re) => (text.match(re) ?? []).length;

// ── (a) the refusal path ────────────────────────────────────────────────────────────────────────

test("(a) refusal path — unknown verb / unknown kind / configless root ⇒ ok:false AND root/kernelPath null", async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "quay-driver-control-bare-"));
  try {
    const cases = [
      ["nope-verb", "worker", bare], // verb not in VERBS
      ["status", "nope-kind", bare], // kind not in KINDS
      ["status", "worker", bare], // valid verb+kind, but no .quay/config.yml under `bare`
    ];
    for (const [verb, kind, root] of cases) {
      const sync = runDriver(verb, kind, ["--kind", kind], root);
      const conc = await runDriverAsync(verb, kind, ["--kind", kind], root);
      for (const [arm, r] of [["sync", sync], ["async", conc]]) {
        assert.equal(r.ok, false, `${arm} ${verb}/${kind}: a refused invocation is NOT ok`);
        assert.equal(typeof r.reason, "string", `${arm} ${verb}/${kind}: carries a reason`);
        assert.ok(r.reason.length > 0, `${arm} ${verb}/${kind}: the reason is not empty`);
        // ⛔ The two fields the CLI decoration keys on: a refusal must be distinguishable from a
        // delegation by MORE than the `ok` boolean (硬规则 3b).
        assert.equal(r.root, null, `${arm} ${verb}/${kind}: refusal reports root:null`);
        assert.equal(r.kernelPath, null, `${arm} ${verb}/${kind}: refusal reports kernelPath:null`);
        assert.equal(r.stdout, "", `${arm} ${verb}/${kind}: refusal printed nothing to stdout`);
      }
    }
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

// ── (b) core-root placement (source, by position) ───────────────────────────────────────────────

test("(b) core-root placement — no ./cli/ or ./fan-in/ import, zero-import vocab leaf, one probeInstruments caller", () => {
  const ctlRaw = fs.readFileSync(path.join(SRC, "driver-control.ts"), "utf8");
  const vocabRaw = fs.readFileSync(path.join(SRC, "driver-vocab.ts"), "utf8");
  const ctl = live(ctlRaw);
  const vocab = live(vocabRaw);

  // ⛔ The falsifiable half (硬规则 4 推论四): an injected import line MUST be detected, else this
  // predicate is blind and "0 hits" would mean nothing.
  assert.equal(count(live('import { x } from "./cli/anything.ts";\n' + ctlRaw), RE_CLI), 1,
    "the scanner detects an injected ./cli/ import — otherwise its 0 below is vacuous");
  assert.equal(count(live('import { x } from "./fan-in/anything.ts";\n' + ctlRaw), RE_FAN), 1,
    "the scanner detects an injected ./fan-in/ import — otherwise its 0 below is vacuous");

  assert.equal(count(ctl, RE_CLI), 0, "driver-control.ts imports nothing from ./cli/ (the edge GOAL-033 removes)");
  assert.equal(count(ctl, RE_FAN), 0, "driver-control.ts imports nothing from ./fan-in/ (would create a new root⇄fan-in edge)");
  assert.equal(count(vocab, /^\s*import\b/m), 0, "driver-vocab.ts is a ZERO-import leaf (quay --help load cost)");

  // The old location is GONE — not kept as a second copy and not as a re-export shim.
  assert.equal(fs.existsSync(path.join(SRC, "cli", "driver-vocab.ts")), false,
    "cli/driver-vocab.ts must be absent (a shim would keep a cli/ file that core-root cannot import)");

  // `probeInstruments` is CALLED from exactly one place: the CLI facade. (The definition in
  // fan-in/ff-merge.ts is excluded by shape; comment mentions are excluded by `live()`.)
  const callSites = [];
  for (const f of walk(SRC)) {
    const t = live(fs.readFileSync(f, "utf8"));
    for (const line of t.split("\n")) {
      if (/\bprobeInstruments\s*\(/.test(line) && !/function\s+probeInstruments\s*\(/.test(line)) {
        callSites.push(path.relative(SRC, f));
      }
    }
  }
  assert.deepEqual([...new Set(callSites)], [path.join("cli", "driver.ts")],
    "probeInstruments is called only from the CLI facade (the decoration is a presentation concern)");
});

// ── (c) the CLI presentation contract ───────────────────────────────────────────────────────────

function mkWorkspace(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `quay-driver-control-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "provider: native\n");
  return root;
}

async function runCli(args) {
  try {
    const r = await run(args, { capture: true });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  } finally {
    process.exitCode = 0; // run() mutates the shared global; keep the test runner's exit clean
  }
}

/** The single JSON frame the kernel prints (the status command may also print warnings to stderr). */
function jsonFrame(stdout) {
  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  assert.ok(line, `a JSON frame was printed (got ${JSON.stringify(stdout.slice(0, 200))})`);
  return JSON.parse(line);
}

test("(c) CLI presentation — worker status carries `instruments`, promotion does NOT", async () => {
  const root = mkWorkspace("instruments");
  try {
    const worker = jsonFrame((await runCli(["driver", "status", "--kind", "worker", "--json", "--root", root])).stdout);
    assert.ok(Object.prototype.hasOwnProperty.call(worker, "instruments"),
      "`quay driver status --kind worker --json` still carries the fan-in instrument reading");
    assert.ok(worker.instruments && typeof worker.instruments === "object",
      "the `instruments` reading is an object (classifier + reaper)");

    const promotion = jsonFrame((await runCli(["driver", "status", "--kind", "promotion", "--json", "--root", root])).stdout);
    assert.equal(Object.prototype.hasOwnProperty.call(promotion, "instruments"), false,
      "…and promotion does NOT (the two kinds must stay distinguishable by their stdout shape)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return walk(path.join(dir, e.name));
    return e.name.endsWith(".ts") ? [path.join(dir, e.name)] : [];
  });
}
