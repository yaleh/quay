#!/usr/bin/env bash
# Mutation case for release-test-client-close-check (tasks/gap-release-run-tests-hangs-on-shared-mcp-client-leak,
# GOAL-020 AC-266; Requested action 5).
#
# Fixture: a self-contained workspace under <workdir> —
#   .github/workflows/release.yml                 a `Run tests` step whose run command carries the glob
#   packages/quay/test/leaky.test.mjs             two `const { client: X } = await connectStdio(…)`
#                                                 bindings, each closed INSIDE a `finally`
# The case drives the REAL checker with `--root <workdir>`, so it never touches the repo's own tree.
#
# Phases (checker-mutation-check.sh contract: 0 = behaved, 3 = STAYED-GREEN, 4 = ALWAYS-RED, 2 = infra):
#   A  baseline: both bindings closed in a finally            → exit 0
#   B  inject:   `core.close()` moved OUT of its finally      → MUST go non-zero
#      (this is the pre-fix shape of mcp-server.test.mjs: happy-path-only close, no finally)
#   B2 inject:   the ONE-LEVEL-DEEPER close — a `finally` still exists in the file, but it belongs to a
#      DIFFERENT block, and `core.close()` sits at the outer level. A predicate that asks only "does
#      this file contain a finally anywhere" (or "does any finally contain any close") STAYS GREEN
#      here, which is exactly the 硬规则 3b shape: a check that cannot read the nesting renders as
#      "clean". Without this phase a regression to that predicate would leave the case green.
#   B3 inject:   the binding is closed ZERO times at all (the close statement deleted) → MUST be RED
#   C  restore:  both bindings closed in a finally            → exit 0 again (ALWAYS-RED detector)
#   D  tri-state: the release workflow removed → MUST be exit 3 NOT-EVALUATED, distinct from BOTH 0 and 1
#      (硬规则 3b: a checker that cannot read its input must not render as "all clients are closed")
#   D2 tri-state: the workflow present but its `Run tests` step gone → MUST be exit 3, distinct from 0/1
set -u
name="release-test-client-close-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checker="${checker_dir}/${name}.ts"
[ -f "$checker" ] || { echo "infrastructure: checker not found at $checker" >&2; exit 2; }

rm -rf "${workdir}"
mkdir -p "${workdir}/packages/quay/test" "${workdir}/.github/workflows"
cd "${workdir}" || exit 2

checker_cmd() {
  node --no-warnings --experimental-strip-types "$checker" --root "$1" >/dev/null 2>&1
}

# rc_of runs the checker and echoes its exit code (used for the tri-state phases, where the VALUE
# 3 matters and must be distinguishable from both 0 and 1).
rc_of() {
  node --no-warnings --experimental-strip-types "$checker" --root "$1" >/dev/null 2>&1
  echo $?
}

write_workflow() {
  cat > "${workdir}/.github/workflows/release.yml" <<'YAML'
name: Release
jobs:
  release:
    steps:
      - name: Install dependencies
        run: npm install

      - name: Run tests
        run: node --test packages/quay/test/*.mjs
YAML
}

# A file with TWO destructured client bindings, both closed inside a finally.
write_clean_test() {
  cat > "${workdir}/packages/quay/test/leaky.test.mjs" <<'JS'
async function main() {
  const { client: core } = await connectStdio("node", ["x", "mcp"], "ws");
  try {
    await core.callTool({ name: "task_list", arguments: {} });
  } finally {
    await core.close();
  }

  const { client: other, transport: otherTransport } = await connectStdio("node", ["y", "mcp"], "ws");
  try {
    await other.callTool({ name: "task_list", arguments: {} });
  } finally {
    await other.close();
  }
}
JS
}

# B: `core.close()` moved OUT of its finally onto the happy path (the pre-fix shape).
write_happy_path_only() {
  cat > "${workdir}/packages/quay/test/leaky.test.mjs" <<'JS'
async function main() {
  const { client: core } = await connectStdio("node", ["x", "mcp"], "ws");
  try {
    await core.callTool({ name: "task_list", arguments: {} });
  } catch (err) {
    console.error(err);
  }
  await core.close();

  const { client: other } = await connectStdio("node", ["y", "mcp"], "ws");
  try {
    await other.callTool({ name: "task_list", arguments: {} });
  } finally {
    await other.close();
  }
}
JS
}

# B2: `core.close()` sits at the OUTER level while the file still contains a `finally` — but that
# finally belongs to the INNER block and closes nothing relevant. A nesting-blind predicate (or one
# asking "does any finally contain a close?") stays green here.
write_finally_belongs_to_another_block() {
  cat > "${workdir}/packages/quay/test/leaky.test.mjs" <<'JS'
async function main() {
  const { client: core } = await connectStdio("node", ["x", "mcp"], "ws");
  {
    const inline = await openSomething();
    try {
      await inline.flush();
    } finally {
      await inline.close();
    }
  }
  await core.close();

  const { client: other } = await connectStdio("node", ["y", "mcp"], "ws");
  try {
    await other.callTool({ name: "task_list", arguments: {} });
  } finally {
    await other.close();
  }
}
JS
}

# B3: the close statement is deleted outright — no close on ANY path.
write_no_close_at_all() {
  cat > "${workdir}/packages/quay/test/leaky.test.mjs" <<'JS'
async function main() {
  const { client: core } = await connectStdio("node", ["x", "mcp"], "ws");
  try {
    await core.callTool({ name: "task_list", arguments: {} });
  } finally {
    console.log("done");
  }

  const { client: other } = await connectStdio("node", ["y", "mcp"], "ws");
  try {
    await other.callTool({ name: "task_list", arguments: {} });
  } finally {
    await other.close();
  }
}
JS
}

write_workflow

# ── A: baseline GREEN ────────────────────────────────────────────────────────────────────────────
write_clean_test
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fixture where every binding is closed in a finally (checker always-red?)" >&2
  exit 4
fi

# ── B: inject the pre-fix shape (happy-path-only close) ⇒ MUST bite ──────────────────────────────
write_happy_path_only
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN: checker exited 0 with 'core' closed OUTSIDE any finally — it cannot see the defect it exists for" >&2
  exit 3
fi

# ── B2: the nesting blind spot — a finally exists, but it is not core's ⇒ MUST still bite ────────
write_finally_belongs_to_another_block
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN: a finally belonging to a DIFFERENT block satisfied the checker for 'core' — it is nesting-blind (硬规则 3b: cannot-read renders as clean)" >&2
  exit 3
fi

# ── B3: no close at all ⇒ MUST bite ─────────────────────────────────────────────────────────────
write_no_close_at_all
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN: checker exited 0 with 'core' never closed on any path" >&2
  exit 3
fi

# ── C: restore ⇒ GREEN again (ALWAYS-RED detector) ──────────────────────────────────────────────
write_clean_test
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED: restored fixture (every binding closed in a finally) still exits non-zero" >&2
  exit 4
fi

# ── D: the release workflow is missing ⇒ NOT-EVALUATED (3), distinct from 0 and 1 ───────────────
mv "${workdir}/.github/workflows/release.yml" "${workdir}/.github/workflows/release.yml.off"
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "3" ]; then
  echo "tri-state FAIL: workflow absent ⇒ expected exit 3 NOT-EVALUATED, got ${rc}" >&2
  exit 3
fi

# ── D2: the workflow exists but carries no `Run tests` step ⇒ NOT-EVALUATED (3) ─────────────────
cat > "${workdir}/.github/workflows/release.yml" <<'YAML'
name: Release
jobs:
  release:
    steps:
      - name: Install dependencies
        run: npm install
YAML
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "3" ]; then
  echo "tri-state FAIL: 'Run tests' step absent ⇒ expected exit 3 NOT-EVALUATED, got ${rc}" >&2
  exit 3
fi

# ── E: the glob matches zero files ⇒ NOT-EVALUATED (3), never a vacuous pass ────────────────────
write_workflow
rm -f "${workdir}/packages/quay/test/leaky.test.mjs"
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "3" ]; then
  echo "tri-state FAIL: glob matched zero files ⇒ expected exit 3 NOT-EVALUATED, got ${rc}" >&2
  exit 3
fi

exit 0
