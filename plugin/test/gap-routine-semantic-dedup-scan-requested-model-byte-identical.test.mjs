// @test-group engine
// gap-routine-semantic-dedup-scan-requested-model-byte-identical.test.mjs — semantic-dedup-scan
// finding `requested-model-byte-identical` (runId `semantic-dedup-scan-1794127147981`, dupKind
// `byte-identical-body`, verdict `real-duplication`, suggestedAction "extract into the shared routine
// engine loader both already import") named the REQUESTED-model probe as byte-identical in two sibling
// routines:
//     plugin/scripts/cross-project-dogfood-routine.ts:994
//     plugin/scripts/open-semantic-discovery-routine.ts:4315
//       const requestedModel = (() => {
//         try {
//           const probe = buildArgv("", root, { tools: "", maxTurns: …, outputFormat: null, model: null });
//           const i = probe.indexOf("--model");
//           return i >= 0 && typeof probe[i + 1] === "string" ? probe[i + 1] : null;
//         } catch { return null; }
//       })();
//
// WHAT THIS PINS — the CLASS, not the two call sites (the same shape as its sibling
// `gap-routine-semantic-dedup-scan-read-file-join-root-pair.test.mjs`). The reading that CLOSES the
// finding is: `plugin/scripts` carries ZERO private copies of that probe, and the one shared home
// (`routine-engine-module-loader.ts` → `requestedModelFromArgv`, the module BOTH routines already
// import for engine loading) is what every former carrier now calls.
//
// The predicate is STRUCTURAL and NAME-AGNOSTIC: it keys on a local bound to `<argv>.indexOf("--model")`
// and then indexed as `<that same local> + 1` — never on the outer identifier, the IIFE form, or the
// local's spelling. A rename of the local (`i` → `idx`), of the outer binding, or a switch from an IIFE
// to a `function` declaration cannot hide a private copy.
//
// ⛔ WHY THE NEGATIVE HALF MATTERS (硬规则 2 / 3b): a predicate that only ever reads "no private copy
// here" against a tree that already has none is an echo — it cannot take a false value, so it proves
// nothing. Both directions are therefore exercised on fixtures below: the VERBATIM retired bodies must
// read as private copies, and the adopted/renamed/unrelated spellings must not.
//
// Run: node --test plugin/test/gap-routine-semantic-dedup-scan-requested-model-byte-identical.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requestedModelFromArgv } from "../scripts/routine-engine-module-loader.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");

/** The single home of the shared probe — the one file allowed to DEFINE it. */
const DEF_SITE = "routine-engine-module-loader.ts";

/** The two carriers named by the finding. They are ALIVE (production routines) — naming them as bare
 *  basenames under plugin/test is therefore NOT the §12f dead-set trap its sibling test had to dodge;
 *  the derived-from-tree assertions below still hold if either is renamed or removed. */
const FORMER_CARRIERS = ["cross-project-dogfood-routine.ts", "open-semantic-discovery-routine.ts"];

function scriptTsFiles() {
  return fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts"));
}

function sourceOf(rel) {
  return fs.readFileSync(path.join(SCRIPTS_DIR, rel), "utf8");
}

function carrierSourceOf(rel) {
  const p = path.join(SCRIPTS_DIR, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// ── the structural, name-agnostic predicate ─────────────────────────────────────────────────────────
//
// A local bound to `<argv>.indexOf("--model")`, then a read of `<that local> + 1`. The backreference
// (`\1`) is what ties the guard to the SAME local — `indexOf` on one name and `[other + 1]` on another
// is not the probe, and a `--model` mention with no `+ 1` read is not the probe either.
const MODEL_PROBE_SHAPE =
  /(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]{0,160}?\.indexOf\(\s*["'`]--model["'`]\s*\)[\s\S]{0,240}?\[\s*\1\s*\+\s*1\s*\]/;

/** True when `source` carries a requested-model probe (of ANY name / definition form). */
function carriesModelProbe(source) {
  return MODEL_PROBE_SHAPE.test(source);
}

// ── AC1 — the single source (the ratchet: a redefinition turns this RED) ─────────────────────────────

test("AC1 — requestedModelFromArgv is defined exactly once, in routine-engine-module-loader.ts", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction\s+requestedModelFromArgv\b/.test(sourceOf(f)));
  assert.deepEqual(
    defs,
    [DEF_SITE],
    `requestedModelFromArgv must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

// ── AC1 — the class is closed: no private copy survives anywhere under plugin/scripts ────────────────

test("AC1 — no plugin/scripts source carries a private requested-model probe", () => {
  const offenders = scriptTsFiles().filter((f) => carriesModelProbe(sourceOf(f)));
  assert.deepEqual(
    offenders,
    [DEF_SITE],
    `the requested-model probe must have exactly one home (routine-engine-module-loader.requestedModelFromArgv); ` +
      `carried elsewhere by: ${offenders.filter((f) => f !== DEF_SITE).join(", ") || "none"}`,
  );
});

// ⛔ WHY THE CONSUMERS ARE DERIVED FROM THE TREE INSTEAD OF LISTED AS A COUNT. A hardcoded "2" cannot
// tell "both former carriers consume it" from "the list no longer matches the tree". Reading each
// carrier's own source and requiring BOTH an import naming the helper AND a call to it means deleting
// a carrier (or leaving one on a private copy) turns this RED with a named file.
test("AC2 — the shared probe is genuinely CONSUMED by both former carriers, not merely defined", () => {
  const consumers = [];
  const missing = [];
  for (const rel of FORMER_CARRIERS) {
    const src = carrierSourceOf(rel);
    if (src === null) {
      missing.push(`${rel}: file is GONE (update this test's carrier list)`);
      continue;
    }
    const importsIt = /import\s*\{[^}]*\brequestedModelFromArgv\b[^}]*\}\s*from\s*["'][^"']*routine-engine-module-loader\.ts["']/.test(src);
    const callsIt = /\brequestedModelFromArgv\s*\(/.test(src);
    if (!importsIt || !callsIt) {
      missing.push(`${rel}: import=${importsIt} call=${callsIt}`);
      continue;
    }
    consumers.push(rel);
  }
  assert.deepEqual(
    missing,
    [],
    `every former carrier must import AND call the shared probe (an import alone is inert): ${missing.join(" | ")}`,
  );
  assert.ok(
    consumers.length >= 2,
    `the finding named two byte-identical carriers, so ≥2 must consume the shared probe; found ${consumers.length}: ${consumers.join(", ")}`,
  );
});

// ── AC2 — the negative control (both directions, on fixtures) ────────────────────────────────────────

test("AC2 — the predicate can take BOTH values (硬规则 2 negative control)", () => {
  // The VERBATIM retired bodies — these MUST read as private copies.
  const retired = {
    "the finding's body (cross-project-dogfood / open-semantic-discovery, retired)": `
  const requestedModel = (() => {
    try {
      const probe = buildArgv("", root, { tools: "", maxTurns: BLIND_INVESTIGATOR_MAX_TURNS, outputFormat: null, model: null });
      const i = probe.indexOf("--model");
      return i >= 0 && typeof probe[i + 1] === "string" ? probe[i + 1] : null;
    } catch { return null; }
  })();`,
    "renamed local (name must NOT hide it)": `
  const requestedModel = (() => {
    try {
      const argvProbe = buildArgv("", root, { tools: "", maxTurns: 1, outputFormat: null, model: null });
      const idx = argvProbe.indexOf("--model");
      return idx >= 0 ? argvProbe[idx + 1] : null;
    } catch { return null; }
  })();`,
    "plain function-declaration form (definition style must NOT hide it)": `
function readRequestedModel(buildArgv, root) {
  const argv = buildArgv("", root, { tools: "", maxTurns: 1, outputFormat: null, model: null });
  const at = argv.indexOf("--model");
  return at >= 0 && typeof argv[at + 1] === "string" ? argv[at + 1] : null;
}`,
  };
  for (const [label, src] of Object.entries(retired)) {
    assert.equal(carriesModelProbe(src), true, `${label} must read as a private requested-model probe`);
  }

  // What replaced them: the shared probe, CALLED. Plus three look-alikes that are NOT this class, so the
  // predicate is not merely "any indexOf on --model".
  const adopted = {
    "carrier (adopted — a call, no index arithmetic)": `
  const requestedModel = requestedModelFromArgv(buildArgv, root, BLIND_INVESTIGATOR_MAX_TURNS);`,
    "mentions --model but never indexes past it": `
  function flagPresent(argv) {
    const i = argv.indexOf("--model");
    return i >= 0;
  }`,
    "indexes +1, but on a DIFFERENT flag": `
  function toolsOf(argv) {
    const i = argv.indexOf("--tools");
    return i >= 0 && typeof argv[i + 1] === "string" ? argv[i + 1] : null;
  }`,
    "+1 on a DIFFERENT local than the indexOf binding": `
  function odd(argv) {
    const i = argv.indexOf("--model");
    const j = 0;
    return typeof argv[j + 1] === "string" ? argv[j + 1] : null;
  }`,
  };
  for (const [label, src] of Object.entries(adopted)) {
    assert.equal(carriesModelProbe(src), false, `${label} must NOT read as a private requested-model probe`);
  }
});

// ── AC2 — semantics: the shared probe reads the REQUESTED model off the right argv ───────────────────

test("AC2 — the probe builds a TOOL-LESS, model-null argv (the requested identity, not the served one)", () => {
  const seen = [];
  const buildArgv = (prompt, root, opts) => {
    seen.push({ prompt, root, opts });
    return ["claude", "--model", "claude-opus-5-5", "--tools", opts.tools, "--max-turns", String(opts.maxTurns)];
  };
  assert.equal(requestedModelFromArgv(buildArgv, "/some/root", 1), "claude-opus-5-5");
  assert.equal(seen.length, 1, "exactly ONE throwaway argv is built");
  const call = seen[0];
  assert.equal(call.prompt, "", "the probe builds the SAME argv shape a real call's argv builder produces");
  assert.equal(call.root, "/some/root", "…rooted at the caller's workspace");
  assert.equal(call.opts.tools, "", "…tool-less");
  assert.equal(call.opts.model, null, "…asking for NO model, so the launcher's resolved --model is what comes back");
  assert.equal(call.opts.outputFormat, null, "…not a stream (nothing is spawned)");
  assert.equal(call.opts.maxTurns, 1, "…carrying the caller's tool-less turn cap");
});

test("AC2 — null is an ANSWER: absent, dangling, throwing and first-wins are each distinct inputs", () => {
  const argvOf = (argv) => () => argv;
  // Absent: a launcher that carries no --model at all.
  assert.equal(requestedModelFromArgv(argvOf(["claude", "--tools", ""]), "/r", 1), null);
  // Dangling: --model is the LAST token, so [i + 1] is undefined — NOT a string, so NOT a model.
  assert.equal(requestedModelFromArgv(argvOf(["claude", "--model"]), "/r", 1), null);
  // Throwing builder: reported as "no requested model" rather than crashing the round.
  assert.equal(
    requestedModelFromArgv(() => {
      throw new Error("BOOM");
    }, "/r", 1),
    null,
  );
  // First wins, matching the retired expression exactly.
  assert.equal(requestedModelFromArgv(argvOf(["--model", "a", "--model", "b"]), "/r", 1), "a");
  // A non-string after the flag is not a model.
  assert.equal(requestedModelFromArgv(argvOf(["--model", 42]), "/r", 1), null);
});

test("AC2 — the shared probe agrees with the RETIRED expression on every argv it can be fed", () => {
  // The pre-image, verbatim (硬规则 4: the equality is MEASURED against a really-running copy, not
  // asserted by construction).
  const retiredProbe = (buildArgv, root, maxTurns) => {
    try {
      const probe = buildArgv("", root, { tools: "", maxTurns, outputFormat: null, model: null });
      const i = probe.indexOf("--model");
      return i >= 0 && typeof probe[i + 1] === "string" ? probe[i + 1] : null;
    } catch {
      return null;
    }
  };

  const matrix = {
    "model present": () => ["claude", "--model", "m-1", "--tools", ""],
    "model absent": () => ["claude", "--tools", ""],
    "model dangling": () => ["claude", "--model"],
    "model first": () => ["--model", "m-2"],
    "two models": () => ["--model", "m-3", "--model", "m-4"],
    "empty argv": () => [],
    "non-array answer": () => "not an array",
  };
  for (const [label, buildArgv] of Object.entries(matrix)) {
    assert.equal(
      requestedModelFromArgv(buildArgv, "/r", 1),
      retiredProbe(buildArgv, "/r", 1),
      `the shared probe must agree with the retired expression on: ${label}`,
    );
  }
  // The throwing builder is the one case a matrix row cannot express (the comparison expression itself
  // would throw); both sides are checked directly.
  const thrower = () => {
    throw new Error("BOOM");
  };
  assert.equal(requestedModelFromArgv(thrower, "/r", 1), retiredProbe(thrower, "/r", 1));
});
