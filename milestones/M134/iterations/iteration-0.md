## M134 iteration-0 — loadbearing-test-gate .test.ts fix

Extended hasSiblingTest to check both .test.mjs AND .test.ts extensions,
and to check both testDir AND scriptsDir (since M127 scripts have tests
as siblings in scripts/ not in test/).

Before: 3 FAIL (anti-gaming-guard, chart-saturation-check, milestones-since-transition)
After: 0 FAIL — all 11 load-bearing scripts have sibling tests detected.

GREEN: gate exits 0 on current tree. RED: gate exits 1 when test is missing.
