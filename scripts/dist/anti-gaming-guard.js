#!/usr/bin/env node --experimental-strip-types
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/anti-gaming-guard.ts
function validateSurface(surface) {
  const failures = [];
  if (surface.covSource !== "machine") {
    failures.push(`cov source is '${surface.covSource}' \u2014 must be 'machine' (CI-exit/GateEvent/registry-bounded)`);
  }
  if (!surface.covCapped) {
    failures.push("cov is uncapped \u2014 must have an explicit ceiling (e.g., /N registry entries)");
  }
  if (surface.covInflatable) {
    failures.push("cov is inflatable \u2014 can be gamed by adding spurious items; must use a fixed denominator");
  }
  if (surface.adjudication === "none") {
    failures.push("no residual-headroom adjudication recorded \u2014 must state pursue/abandon/fold for old chart headroom");
  }
  return {
    pass: failures.length === 0,
    failures,
    surface
  };
}
var isMain = process.argv[1] && (process.argv[1].endsWith("anti-gaming-guard.ts") || process.argv[1].endsWith("anti-gaming-guard"));
if (isMain) {
  const getArg = (name) => flagValue(process.argv, `--${name}`);
  const jsonMode = process.argv.includes("--json");
  const surface = {
    covSource: getArg("cov-source") || "subjective",
    covCapped: getArg("cov-capped") !== "false",
    covInflatable: getArg("cov-inflatable") === "true",
    adjudication: getArg("adjudication") || "none"
  };
  const result = validateSurface(surface);
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Verdict: ${result.pass ? "PASS" : "REJECT"}`);
    for (const f of result.failures) {
      console.log(`  FAIL: ${f}`);
    }
  }
  process.exit(result.pass ? 0 : 1);
}
export {
  validateSurface
};
