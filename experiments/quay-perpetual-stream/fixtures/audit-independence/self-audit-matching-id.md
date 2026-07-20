## ABSORB m-fixture — self-audit-with-recorded-but-matching-id

**Task:** exp5-FIXTURE-TASK.
**Audit session id:** orchestrator-session-abc123

**adversarial-audit verdict: NO REFUTATION FOUND**

(This artifact DOES record a session id, but it is the SAME id as the dispatching orchestrator's own
— i.e. the "audit" ran in the same context as the milestone it was supposed to independently check.
This is the self-audit-with-a-recorded-id variant: a subtler failure than the fully-absent case,
since a naive "any id present -> PASS" check would be fooled by it.)
