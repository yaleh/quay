// @test-group engine
// build-plugin-dist.test.mjs — gap-delivery-laydown-dist-closure-gap: the rewrite surface that
// keeps the PACKAGED quay-init's laydown derivation in sync with package.sh's dist rewrite.
//
// package.sh stages plugin/ → packages/quay/plugin/, bundles every consumer-referenced .ts into
// dist/<name>.js, DELETES the raw .ts, and rewrites the staged invokers to reference the bundles.
// Three invariants must hold in the packaged form or the installed plugin's mechanism breaks:
//   AC1 — the packaged quay-init.sh's ${SCRIPT_DIR} closure + closure-check regexes tolerate the
//         two-segment `${SCRIPT_DIR}/dist/X.js` form (package.sh rewrites .ts refs to dist/X.js).
//         Source regex is multi-segment (allow `/`) and strips ONLY the ${SCRIPT_DIR}/ prefix so
//         the scripts/-relative path `dist/X.js` resolves under scripts/; rewriteShell must
//         PRESERVE it in the packaged copy (it did NOT before this task — the closure regex stayed
//         single-segment and never matched dist paths).
//   AC-workflows — rewriteInvokers rewrites plugin/workflows/*.js's `plugin/scripts/X.ts` refs.
//         The shipped workflow FILES are invokers too (fan-in-execute.js runs
//         `node --experimental-strip-types plugin/scripts/X.ts`); without the rewrite the packaged
//         artifact's workflows point at raw .ts that package.sh deleted, and verify_referenced_landed
//         (whose refs scan covers workflows/*.js) fails the install referenced-not-landed.
//   AC5 — rewriteMarkdown rewrites the cold-start SKILL.md PRECONDITION's path form
//         (`plugin/scripts/fast-mode-telemetry.ts` → `plugin/scripts/dist/fast-mode-telemetry.js`).
//         The precondition is the fail-closed checklist an installed project reads; a bare
//         `fast-mode-telemetry.ts` token (no plugin/scripts/ prefix) is NOT rewritten by
//         rewriteMarkdown and names a file that does not exist after .ts deletion.
//
// Run: node --test packages/quay/test/build-plugin-dist.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  rewriteMarkdown,
  rewriteShell,
  rewriteInvokers,
} from "../scripts/build-plugin-dist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tmp(prefix = "build-plugin-dist-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── AC1: the closure regex survives rewriteShell multi-segment + prefix-strip ──────────────────────
test("AC1 — rewriteShell(isQuayInit=true) preserves the two-segment closure regex (dist/X.js tolerant + ${SCRIPT_DIR} prefix-strip)", () => {
  // A faithful slice of quay-init.sh's derive_loop_scripts (d) closure line AS THE SOURCE NOW HAS
  // IT (multi-segment char class + prefix-only strip). rewriteShell must not downgrade it.
  const snippet = [
    'for dep in $(grep -oE \'\\$\\{SCRIPT_DIR\\}/[a-zA-Z0-9][a-zA-Z0-9._/-]*|\\$SCRIPT_DIR/[a-zA-Z0-9][a-zA-Z0-9._/-]*\' "$PLUGIN_ROOT/scripts/$s" 2>/dev/null | sed -E \'s#^\\$\\{SCRIPT_DIR\\}/##; s#^\\$SCRIPT_DIR/##\' | sort -u || true); do',
    '  [ -f "$PLUGIN_ROOT/scripts/$dep" ] || continue',
    'done',
  ].join("\n");
  const out = rewriteShell(snippet, true);
  // The packaged copy must still allow `/` in the matched path …
  assert.match(out, /\\\$\\\{SCRIPT_DIR\\\}\/\[a-zA-Z0-9\]\[a-zA-Z0-9\._\/-\]\*/,
    "closure regex must tolerate the two-segment dist/X.js path in the packaged quay-init.sh");
  // … and must strip ONLY the ${SCRIPT_DIR}/ or $SCRIPT_DIR/ prefix (never the basename-strip
  // s#.*/## which truncated dist/X.js to X.js).
  assert.match(out, /sed -E 's#\^\\\$\\\{SCRIPT_DIR\\\}\/##; s#\^\\\$SCRIPT_DIR\/##'/,
    "closure must keep the scripts/-relative path (prefix-strip, not basename-strip)");
});

test("AC1 — the packaged closure regex extracts dist/X.js from a ${SCRIPT_DIR}/dist/X.js reference (end-to-end shell semantics)", () => {
  // Simulate the packaged quay-init's derive closure grep+sed on a REAL rewritten reference.
  const dir = tmp();
  try {
    const script = path.join(dir, "send-keys-reliable.sh");
    fs.writeFileSync(script, 'CHECKER="${SCRIPT_DIR}/dist/transcript-delivery-check.js"\n', "utf8");
    const refs = execFileSync(
      "bash",
      ["-c",
        "grep -oE '\\$\\{SCRIPT_DIR\\}/[a-zA-Z0-9][a-zA-Z0-9._/-]*|\\$SCRIPT_DIR/[a-zA-Z0-9][a-zA-Z0-9._/-]*' \"$1\" | sed -E 's#^\\$\\{SCRIPT_DIR\\}/##; s#^\\$SCRIPT_DIR/##' | sort -u",
        "bash",
        script,
      ],
      { encoding: "utf8" },
    ).trim();
    assert.equal(refs, "dist/transcript-delivery-check.js",
      "the closure grep must extract the scripts/-relative two-segment path, not the basename");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-workflows: rewriteInvokers rewrites the shipped workflow FILES' plugin/scripts/X.ts refs ─────
test("AC-workflows — rewriteInvokers rewrites plugin/workflows/*.js plugin/scripts/X.ts refs to dist/X.js", () => {
  const dir = tmp();
  try {
    const wfDir = path.join(dir, "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, "fan-in-execute.js"), [
      "// comment referencing plugin/scripts/per-task-suite-record.ts",
      "if ! node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task ${task}; then",
      "  echo ok",
      "fi",
      "// dev-repo path must be left alone",
      "node experiments/quay-perpetual-stream/scripts/drain-scheduler.ts",
    ].join("\n"), "utf8");
    const touched = rewriteInvokers(dir);
    assert.equal(touched, 1, "the workflow .js must be counted as a rewritten invoker");
    const out = fs.readFileSync(path.join(wfDir, "fan-in-execute.js"), "utf8");
    assert.ok(out.includes("plugin/scripts/dist/anti-drift-touches-check.js"),
      "the node --experimental-strip-types invocation must point at the dist bundle");
    assert.ok(out.includes("plugin/scripts/dist/per-task-suite-record.js"),
      "the comment reference must point at the dist bundle");
    assert.ok(!out.includes("anti-drift-touches-check.ts"),
      "no plugin/scripts/*.ts reference may survive in the shipped workflow");
    assert.ok(out.includes("experiments/quay-perpetual-stream/scripts/drain-scheduler.ts"),
      "a dev-repo experiments/...ts path (not a plugin mechanism) must be left untouched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC5: rewriteMarkdown rewrites the cold-start SKILL.md PRECONDITION's path form ─────────────────
test("AC5 — rewriteMarkdown rewrites the cold-start precondition plugin/scripts/fast-mode-telemetry.ts to the dist form", () => {
  const precondition =
    "| loop mechanism laid down | `<root>/plugin/scripts/session-liveness.sh`, `<root>/plugin/scripts/fast-mode-telemetry.ts` exist |";
  const out = rewriteMarkdown(precondition);
  assert.ok(out.includes("<root>/plugin/scripts/dist/fast-mode-telemetry.js"),
    "the precondition's .ts reference must become the bundled executable form the packaged install lays down");
  assert.ok(!out.includes("fast-mode-telemetry.ts"),
    "no raw .ts reference may survive the precondition after packaging");
});

test("AC5 — the REAL cold-start SKILL.md precondition table carries no raw .ts reference after rewriteMarkdown (C-machine 'entire .ts layer missing' zeroed)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "..", "plugin", "skills", "cold-start", "SKILL.md"), "utf8");
  // The PRECONDITION TABLE is the section between `## Preconditions (fail-closed)` and the next
  // `##` heading (`## Observable consequences`). The later sections legitimately carry bare .ts
  // prose references (e.g. the Intentional transcript-delivery-check.ts mechanism-name refs) —
  // those are NOT preconditions and must NOT be counted here.
  const preEnd = (s) => s.indexOf("\n## ", s.indexOf("## Preconditions"));
  const pre = src.slice(src.indexOf("## Preconditions"), preEnd(src));
  assert.match(pre, /fast-mode-telemetry\.ts/, "the SOURCE precondition must still reference the source .ts (readable dev form)");
  const out = rewriteMarkdown(src);
  const preOut = out.slice(out.indexOf("## Preconditions"), preEnd(out));
  assert.doesNotMatch(preOut, /[a-zA-Z0-9_-]+\.ts/,
    "after packaging the precondition table must carry NO raw .ts reference (every one rewritten to the executable dist form)");
  assert.match(preOut, /plugin\/scripts\/dist\/fast-mode-telemetry\.js/,
    "the precondition must reference the bundled executable form the packaged install lays down");
});

test("AC5 — a BARE .ts token (no plugin/scripts/ prefix) is deliberately NOT rewritten (prose/mechanism-name references stay)", () => {
  // The task judged the cold-start precondition as a same-root dist-closure defect and fixed it via
  // the path form — NOT by teaching rewriteMarkdown to rewrite every bare `.ts` token (which would
  // corrupt the INTENTIONAL bare-name mechanism references, e.g. `transcript-delivery-check.ts` in
  // cold-start SKILL.md prose).
  const prose = "the mechanism `transcript-delivery-check.ts` is resolved by quay-init's laydown derivation";
  const out = rewriteMarkdown(prose);
  assert.ok(out.includes("transcript-delivery-check.ts"),
    "a bare-name .ts token without a plugin/scripts/ prefix must stay untouched");
});
