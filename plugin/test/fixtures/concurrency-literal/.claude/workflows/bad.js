// Committed AC2 negative-control fixture (gap-b5-input-shape-path-to-content): the historical
// CPUQuota=400% leak shape that concurrency-literal-check --gate must flag as a violation. This file
// lives under plugin/test/fixtures/ (NOT the real .claude/workflows/), so the real-repo gate scan
// never sees it — only this test's in-process main(--root <fixture>) walks it.
systemdRunLimits = "MemoryMax=4G CPUQuota=400% TasksMax=200",
