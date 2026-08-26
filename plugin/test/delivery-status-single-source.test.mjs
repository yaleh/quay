// @test-group engine
// delivery-status-single-source.test.mjs — gap-delivery-status-two-parallel-implementations:
// the 「消息投递状态」 answer is now ONE judgment source — plugin/scripts/transcript-delivery-check.ts's
// three-state transcript verdict (delivered/failed/unknown) — not two parallel implementations that use
// the same word "delivered" with different meanings. serve-send.ts reads that verdict by SHELLING OUT to
// the checker CLI (the observation.ts readBoardLanding subprocess pattern), so packages/quay/src keeps
// its zero-plugin/-import architecture boundary (⛔ import plugin/ ⇒ 假). This file is the static
// single-source + boundary guard (AC1/AC2/AC3) — it reads the SOURCE, not a fixture.
//
// Run: node --test plugin/test/delivery-status-single-source.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_SEND = path.resolve(__dirname, "..", "..", "packages", "quay", "src", "serve-send.ts");
const CHECKER = path.resolve(__dirname, "..", "scripts", "transcript-delivery-check.ts");

const src = fs.readFileSync(SERVE_SEND, "utf8");

test("AC1 (single source) — serve-send.ts no longer defines its own settings-prediction delivery logic", () => {
  // The former parallel implementation (deliveryStateFor + settings reading) is REMOVED — a second
  // definition of "delivered" must not survive.
  assert.doesNotMatch(src, /export function deliveryStateFor\b/, "deliveryStateFor (settings prediction) must be gone");
  assert.doesNotMatch(src, /export function (?:extractDeliverySettings|deliverySettingsFromArgv|readRecipientSettings)\b/, "settings-reading functions must be gone");
  // The single judgment source is the transcript checker, read by shell-out.
  assert.match(src, /transcript-delivery-check\.ts/, "serve-send.ts reads the transcript-delivery-check.ts verdict");
});

test("AC2 (vocabulary) — serve-send.ts folds the transcript verdict, not a settings decision", () => {
  assert.match(src, /verdictStateToDeliveryState/, "the delivery state is derived from the transcript verdict");
  assert.doesNotMatch(src, /defaultMode\s*===\s*"bypassPermissions"|crossSessionInbound\s*===\s*"accept"/,
    "the settings-based delivered decision (the old §10.1 single-variable test) must be gone");
});

test("AC3 (boundary) — serve-send.ts imports nothing from plugin/ (shell-out, not import)", () => {
  // Match only import SPECIFIERS (static `from "…"` or dynamic `import("…")`), never the string
  // literals that merely NAME the checker path (TRANSCRIPT_CHECKER_REL / new URL(…)).
  const pluginImports = src
    .split("\n")
    .filter((line) => /(?:from\s*|import\s*\()["'][^"']*plugin\//.test(line));
  assert.deepEqual(pluginImports, [], `serve-send.ts must not import plugin/:\n${pluginImports.join("\n")}`);
});

test("AC3 (boundary) — the shared source still lives in transcript-delivery-check.ts (three-state verdict)", () => {
  const checkerSrc = fs.readFileSync(CHECKER, "utf8");
  assert.match(checkerSrc, /export function checkTranscriptDelivered\b/, "the pure three-state verdict still lives in transcript-delivery-check.ts");
});
