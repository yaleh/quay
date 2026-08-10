// @test-group engine
// obligation-discharge-agent.test.mjs — the schema'd "已处置" semantic contract
// (gap-obligation-ledger-mechanization, ADR-033).
//
// Per ADR-033, "这条义务算不算已处置" is a SEMANTIC judgment → must flow through a schema'd agent()
// (same family as no-action-check's agent₁/₂/₃). This file pins the schema contract: a discharge
// verdict MUST carry who+why; a `discharged:false` verdict MUST carry defer_reason + unblock_condition
// (else it is a silent skip renamed as a verdict — REJECTED, 缺值 = 未查).
//
// Run: scripts/test.sh plugin/test/obligation-discharge-agent.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDischargeVerdict, deriveObligationId, DISCHARGE_VERDICT_SCHEMA } from "../scripts/obligation-discharge-agent.ts";

test("schema: a discharge verdict requires id + discharged + who + why", () => {
  assert.equal(validateDischargeVerdict(null).ok, false);
  assert.equal(validateDischargeVerdict({ discharged: true }).ok, false); // no id
  assert.equal(validateDischargeVerdict({ id: "OB-X", discharged: true }).ok, false); // no who/why
  assert.equal(
    validateDischargeVerdict({ id: "OB-X", discharged: true, discharged_by: "outer", discharge_reason: "已处置" }).ok,
    true,
  );
});

test("schema: a silent skip — discharged:false without defer fields — is REJECTED (漏写伪装成处置)", () => {
  const v = validateDischargeVerdict({ id: "OB-X", discharged: false });
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.ok(v.errors.some((e) => e.startsWith("defer_reason")));
    assert.ok(v.errors.some((e) => e.startsWith("unblock_condition")));
  }
});

test("schema: a proper defer (reason + unblock condition) passes; discharge and defer cannot mix", () => {
  assert.equal(
    validateDischargeVerdict({ id: "OB-X", discharged: false, defer_reason: "外部阻塞", unblock_condition: "阻塞解除" }).ok,
    true,
  );
  assert.equal(
    validateDischargeVerdict({ id: "OB-X", discharged: true, discharged_by: "outer", discharge_reason: "已处置", defer_reason: "x" }).ok,
    false, // a discharge must not carry defer fields — pick one state
  );
});

test("schema: the documented defer discipline — blocking source must not be the layer itself — is part of the schema doc", () => {
  // The schema object itself carries the rule so the agent() judging the verdict is bound by it.
  const schemaText = JSON.stringify(DISCHARGE_VERDICT_SCHEMA);
  assert.match(schemaText, /not be the layer itself/i);
});

test("deriveObligationId: same key ⇒ same id, stable across call sites (obligation_set_derived=1)", () => {
  assert.equal(deriveObligationId("SLOT"), "OB-SLOT");
  assert.equal(deriveObligationId("SLOT"), deriveObligationId(" slot "));
  assert.equal(deriveObligationId("pool"), "OB-POOL");
  assert.equal(deriveObligationId("TOOL-DEFECT/ready-pool-check"), "OB-TOOL-DEFECT-READY-POOL-CHECK");
});
