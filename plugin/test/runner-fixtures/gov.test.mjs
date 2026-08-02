// @test-group governance
// Fixture for plugin/test/runner-grouping.test.mjs (NOT in the canonical glob — this subdir is
// only reached by explicit path). Exercises the in-file pre-import self-skip block: with
// QUAY_TEST_GROUPS excluding governance the real test must NOT run and the file must report
// `skipped`; with governance included the real test must run.
import { test } from "node:test";

if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {
  test("REAL GOV TEST RAN", () => {});
}
