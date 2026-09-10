#!/usr/bin/env bash
# Mutation case for kernel-sibling-resolution-check (GOAL-012 A 域, tasks/gap-ac224-…).
# The defect: a shipped kernel file regains a naive sibling-script anchor — the sibling script is
# resolved via naive `__dirname` / target root / template-string interpolation instead of
# `resolveKernelSibling`/`resolveKernelPluginRoot`; OR regains a cross-package SOURCE anchor
# (P4, `packages/*/src/**`) resolved via `path.join(<root>, "packages", …)` / template string
# instead of the dist/shipped-aware resolver (gap-kernel-sibling-check-blind-to-cross-package-source-anchors).
# The checker MUST go RED on each of the THREE sibling concatenation forms AND each of the THREE
# cross-package forms (GOAL-012 风险 4: 不止一种拼接形态), GREEN on a clean file, and GREEN on a
# DEV-TREE-ONLY-marked anchor (风险 2: 豁免带理由、可复核, ⛔ 不是恒绿的假保证).
# Fixture: a hermetic temp root carrying plugin/scripts/fixture.ts — no git dependency.
# Phases:
#   baseline      clean fixture.ts → GREEN (0)
#   inject (P1)   `path.join(__dirname, "x.sh")` → RED (1)
#   restore       clean → GREEN (0)
#   inject (P2)   `path.join(root, "plugin", "scripts", "x.sh")` → RED (1)
#   restore       clean → GREEN (0)
#   inject (P3)   template `` `${__dirname}/x.sh` `` → RED (1)
#   restore       clean → GREEN (0)
#   inject (P4 join repoRoot)   `path.join(repoRoot(), "packages", "quay", "src", "x.ts")` → RED (1)
#   restore       clean → GREEN (0)
#   inject (P4 join var)        `path.join(root, "packages", "quay", "src", "x.ts")` → RED (1)
#   restore       clean → GREEN (0)
#   inject (P4 template)        `` `${root}/packages/quay/src/x.ts` `` → RED (1)
#   restore       clean → GREEN (0)
#   inject (exempt)  naive anchor + `kernel-sibling-dev-tree-only:` marker → GREEN (0) — 豁免可复核
#   inject (P4 exempt)  cross-package anchor + `kernel-sibling-dev-tree-only:` marker → GREEN (0)
set -u
name="kernel-sibling-resolution-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cd "${workdir}"

# A minimal clean shipped-kernel fixture (no naive sibling anchor).
write_clean() {
  cat > plugin/scripts/fixture.ts <<'EOF'
import { resolveKernelSibling } from "./driver-runtime.ts";
// 正确的 sibling 解析形态：经 resolveKernelSibling 单一真相源（⛔ 不锚 __dirname / root）。
export function launch() {
  const sibling = resolveKernelSibling("ready-pool-check.ts");
  return sibling?.path ?? null;
}
EOF
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/kernel-sibling-resolution-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
}

# GREEN baseline: clean file → exit 0.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on a clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (P1 — naive __dirname): a sibling script anchored on __dirname → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const gate = path.join(__dirname, "resource-gate.sh");
EOF
if checker_cmd; then
  echo "STAYED-GREEN — path.join(__dirname, \"x.sh\") did not redden the checker (naive __dirname slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the P1 inject still reddens the checker" >&2
  exit 4
fi

# INJECT (P2 — target root): a sibling script anchored on target root → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
export function run(root: string) {
  return path.join(root, "plugin", "scripts", "ready-pool-check.ts");
}
EOF
if checker_cmd; then
  echo "STAYED-GREEN — path.join(root, \"plugin\", \"scripts\", \"x.ts\") did not redden the checker (target-root anchor slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the P2 inject still reddens the checker" >&2
  exit 4
fi

# INJECT (P3 — template string): a template literal interpolating a sibling path → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const gate = `${__dirname}/resource-gate.sh`;
EOF
if checker_cmd; then
  echo "STAYED-GREEN — a template-string \`\${__dirname}/x.sh\` did not redden the checker (template form slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the P3 inject still reddens the checker" >&2
  exit 4
fi

# INJECT (P4 join — repoRoot() form): a cross-package source module anchored on repoRoot() → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
import { repoRoot } from "./repo-root.ts";
export const mod = path.join(repoRoot(), "packages", "quay", "src", "gate", "gate-event-store.ts");
EOF
if checker_cmd; then
  echo "STAYED-GREEN — path.join(repoRoot(), \"packages\", …) did not redden the checker (cross-package repoRoot anchor slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the P4 repoRoot inject still reddens the checker" >&2
  exit 4
fi

# INJECT (P4 join — <var> form): a cross-package source module anchored on a root variable → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
export function run(root: string) {
  return path.join(root, "packages", "quay", "src", "fan-in", "ff-merge.ts");
}
EOF
if checker_cmd; then
  echo "STAYED-GREEN — path.join(root, \"packages\", …) did not redden the checker (cross-package root-var anchor slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the P4 root-var inject still reddens the checker" >&2
  exit 4
fi

# INJECT (P4 template): a template literal interpolating a cross-package source path → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
export function run(root: string) {
  return `${root}/packages/quay/src/goal-store.ts`;
}
EOF
if checker_cmd; then
  echo "STAYED-GREEN — a template-string \`\${root}/packages/…/src/….ts\` did not redden the checker (cross-package template form slips through)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the P4 template inject still reddens the checker" >&2
  exit 4
fi

# INJECT (DEV-TREE-ONLY exemption): a naive anchor WITH the marker → STILL GREEN (豁免带理由、可复核).
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// kernel-sibling-dev-tree-only: 本仓库自检工具读自己的 plugin/ 树做检查，锚 root 是正确行为。
export const catalog = path.join(__dirname, "capability-catalog.sh");
EOF
if checker_cmd; then :; else
  echo "FALSE-RED — a DEV-TREE-ONLY-marked anchor reddened the checker (豁免未生效)" >&2
  exit 4
fi

# INJECT (P4 DEV-TREE-ONLY exemption): a cross-package anchor WITH the marker → STILL GREEN (AC3 豁免可复核).
cat > plugin/scripts/fixture.ts <<'EOF'
import path from "node:path";
// kernel-sibling-dev-tree-only: 本仓库自检工具只在 dev tree 内跑，读自己的 packages/ 树做检查（源树直跑、不经 bundle），锚 root 是正确行为。
export const store = path.join(scriptRoot, "packages", "quay", "src", "goal-store.ts");
EOF
if checker_cmd; then :; else
  echo "FALSE-RED — a P4 DEV-TREE-ONLY-marked cross-package anchor reddened the checker (豁免未生效)" >&2
  exit 4
fi

# RESTORE: clean again → GREEN (final).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean file after the exemption inject still reddens the checker" >&2
  exit 4
fi

exit 0
