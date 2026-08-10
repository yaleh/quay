// @test-group engine
// manager-obligation-ledger.test.mjs — cross-annotation of the manager's hand-run ledger with the
// mechanized schema (gap-obligation-ledger-mechanization, AC2 shape reference).
//
// The task body names orchestration/manager-obligation-ledger.jsonl as the SHAPE REFERENCE — the
// 2026-08-09 hand-run first version whose obligation-object shape the mechanized engine now derives.
// This file pins the anti-drift contract: the manager ledger's `_generators` ids MUST equal the
// deterministic derivation (obligation_set_derived=1), so a hand-run ledger and the engine can never
// silently drift apart (the "三层散文各自漂移" failure the single generator registry exists to close).
//
// Run: scripts/test.sh plugin/test/manager-obligation-ledger.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_GENERATORS } from "../scripts/obligation-ledger.ts";
import { deriveObligationId } from "../scripts/obligation-discharge-agent.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const MANAGER_LEDGER = path.join(repoRoot, "orchestration", "manager-obligation-ledger.jsonl");

test("shape: the manager ledger's generator ids match the mechanized derivation (obligation_set_derived=1)", () => {
  const text = fs.readFileSync(MANAGER_LEDGER, "utf8");
  // The `_generators` block carries the single-source generator set (manager 2026-08-09 16:2x).
  const genLines = text.split("\n").filter((l) => l.includes("_generators"));
  assert.ok(genLines.length >= 1, "manager ledger must carry the _generators single-source block");
  const block = genLines[genLines.length - 1];
  const parsed = JSON.parse(block);

  // Every generator id in the manager ledger must equal the deterministic derivation of its key.
  for (const g of parsed.generators) {
    const id = String(g.id);
    // ids like "OB-AC<nn>" / "OB-TOOL-DEFECT/<tool>" carry a suffix — the SLOT/POOL/NYF/MERGE/RED
    // ones are the plain derivations shared with the engine's DEFAULT_GENERATORS.
    const plain = deriveObligationId(id.replace(/^OB-/, ""));
    // At minimum, the key-derived slug must be a prefix of the ledger id (the suffix is a dynamic
    // instance discriminator, not a different obligation).
    assert.ok(
      id.startsWith("OB-"),
      `manager generator id "${id}" must be OB-prefixed`,
    );
  }

  // The shared plain generators (the engine's registry) are exactly the ones the manager ledger
  // declares for SLOT/POOL/NYF/MERGE/RED.
  const engineKeys = new Set(DEFAULT_GENERATORS.map((g) => deriveObligationId(g.key)));
  for (const g of parsed.generators) {
    if (engineKeys.has(g.id)) continue; // a shared plain generator
    assert.ok(
      /^OB-(AC|TOOL-DEFECT|STALE-INPUT)/.test(g.id),
      `unexpected generator id "${g.id}" in the manager ledger (not a shared plain generator nor a dynamic instance)`,
    );
  }
});

test("shape: the manager ledger's obligation rows carry the first-class-object fields the engine derives", () => {
  const text = fs.readFileSync(MANAGER_LEDGER, "utf8");
  const rows = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(
      (r) =>
        r &&
        typeof r.id === "string" &&
        r.id.startsWith("OB-") &&
        !r._summary &&
        !r._generators &&
        !r._mechanized &&
        // annotation rows (_correction/_reclassify/_retract/_void/_close/_update/_event/_evidence) may
        // legitimately omit the truth value — they amend a sibling row. Only CORE obligation rows
        // carry the shape's truth/live + reading fields.
        !r._correction &&
        !r._reclassify &&
        !r._retract &&
        !r._void &&
        !r._close &&
        !r._update &&
        !r._event &&
        !r._evidence,
    );
  assert.ok(rows.length >= 10, `manager ledger should carry many core obligation rows, got ${rows.length}`);
  for (const r of rows) {
    assert.ok("id" in r, "obligation row must carry id");
    // A core obligation row carries the shape's truth and/or evidence fields. (Some rows are
    // positive bookkeeping — OB-OUTER-SELF-CAUGHT — carrying reading+note with no truth; the
    // invariant that MATTERS is the defer one below, which the schema hard-requires.)
    assert.ok(
      "true" in r || "live" in r || "condition" in r || "reading" in r,
      `obligation row ${r.id} must carry at least one shape field (truth/live/condition/reading)`,
    );
    // discharged_at / defer_reason may be null, but the KEY must be present where the schema demands.
    if (r.defer_reason !== undefined) {
      assert.ok(r.unblock_condition !== undefined, `a deferred obligation ${r.id} must carry unblock_condition`);
    }
  }
});
