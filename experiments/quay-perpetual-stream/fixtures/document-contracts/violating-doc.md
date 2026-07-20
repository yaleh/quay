---
id: DOC-999
title: synthetic violating document (fixture, exp5-M-CRYST-D1 Stage 5)
status: active
kind: fixture
contracts:
  - target: self
    type: grep
    pattern: "this pattern is deliberately absent from the body below"
    description: synthetic FAIL-path proof — this assertion is designed to fail
---
This is a synthetic fixture document created for exp5-M-CRYST-D1 Stage 5 to
prove the doc-<id> gate's FAIL path end-to-end. It is NEVER a real managed
document deliberately broken — it lives only here, under
fixtures/document-contracts/, and is loaded directly by
packages/quay/test/document-gate-fixture.test.mjs (not by the real
docs-managed/ store any milestone's gates run against).
