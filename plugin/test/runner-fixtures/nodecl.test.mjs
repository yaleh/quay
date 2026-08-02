// NO @test-group declaration — exercises AC7 (undeclared files default to `engine`). This
// fixture is never in the canonical glob; the runner test passes it explicitly and relies on
// the `group_of` fallback for --list-groups counting.
import { test } from "node:test";

test("UNDECLARED TEST RAN", () => {});
