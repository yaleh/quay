# M${NEXT} — preflightMergedMarkdownClaims low-identifier-count silent miss

- **Task:** `gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss`
- **Class:** development
- **Gate:** acceptance
- **High risk:** false

## Scope

Tiny: one detection-path fix in `prepare-admission-check.ts` (both mirrors). The detector currently returns zero findings for genuine mid-line-bulleted blocks with <2 backtick identifiers — the same silent-miss class that sibling tasks already fixed for ≥4-identifier blocks.

## Done when

- Real-incidence scan completed (does this shape actually occur in the task store?)
- Either fix lands (extend severity to cover <2-identifier blocks) OR explicit accepted-risk note recorded
- Full test suite green, both mirrors
- No regression in existing severity system

## Inner termination

1. Real-incidence scan completes
2. Decision recorded (fix or accepted-risk)
3. If fix: implementation + test GREEN
4. Mirrors byte-identical
5. Independent audit confirms no regression

