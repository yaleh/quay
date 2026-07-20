## ABSORB m43 — M43-dir022-remaining-gates — 2026-07-20

**Task:** exp5-M-DIR022-REMAINING-GATES (DIR-030 item 3 of 4).
**Charter:** experiments/quay-perpetual-stream/charters/M43-dir022-remaining-gates.md

### AC / DoD checklist
- [x] `quay gate --list` includes `vmeta-lag` and `dogfood-evidence`.
- [x] `registry.js` documents why escrow-Δv/test-floor/audit are not separately registered.
- [x] DoD proof: this milestone's own real ABSORB ran 2 distinct non-`dod` engine gates.

**Adversarial audit — DISCLOSED DEVIATION, DIR-032 (third consecutive occurrence, M41→M42→M43):**
Independent-subagent dispatch was RE-TESTED this pass — `mcp__plugin_manda_manda__Agent` called
directly with `subagent_type: general-purpose` failed with `MCP error -32602`. This audit is
explicitly flagged NOT INDEPENDENT (self-audit) rather than silently passed as independent.
**adversarial-audit verdict: NO REFUTATION FOUND** (self-audit, independence NOT met).

(No "Audit session id:" line is recorded anywhere in this artifact — the exact real M41/M42/M43
shape: a self-audit happened, but no independent-session evidence was ever machine-checkable.)
