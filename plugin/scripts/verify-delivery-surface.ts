// verify-delivery-surface.ts — L1 six-category delivery-completeness check.
// gap-complete-delivery-surface-spec-and-l1-verification (AC2 / AC5).
//
// The human asked what a COMPLETE quay cold-start + sustained-correct-drive actually
// requires — SPEC-complete-delivery-surface-2026-08-05.md measures it as SIX delivery
// categories (mechanism+runtime / loop-docs / launch-config / session-topology /
// periodic-anchor / observation+verification). The existing verify-referenced-landed
// (a bash function in quay-init.sh) covers ONLY category 1 ("referenced set ⊆ landed
// set"). This module is the L1 check extended to all six: a static, before-install AND
// after-install check that every one of the six categories has a concrete deliverable
// present under the checked root, and (when the SPEC doc is present) that the SPEC doc
// tracks the same manifest — `spec_is_live`.
//
// 单源：The machine-readable six-category manifest lives in the SPEC doc as a fenced
// JSON block (the human doc is the single source). This script embeds the SAME manifest
// as its executable default (used when the checked root has no SPEC doc — e.g. a target
// project after quay-init, which does not lay down orchestration/SPEC-*). The
// `spec_is_live` bond re-validates the embedded copy against the doc on every run where
// the doc is present, so the doc CANNOT silently freeze while the executable manifest
// grows (invariant spec_is_live = 1).
//
// Contract (task gap-complete-delivery-surface-spec-and-l1-verification):
//   measure   surface_categories_covered = stdout 的 covered 数字段（N/6）
//   band      surface_categories_covered = 6
//   invariant spec_is_live = 1
//   invoke    node --experimental-strip-types <this file> --surface
//   control   六类中任一类无交付物 ⇒ L1 必报缺；补齐 ⇒ 6/6（逐类 fixture）
//
// Run:
//   node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface
//   node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface --root <dir>
//   node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --json [--root <dir>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Six-category manifest (executable default; the SPEC doc carries the same manifest) ──────────────

export interface DeliveryCategory {
  id: number;
  /** stable English key — the SPEC doc marker must match this */
  name: string;
  /** human label (SPEC §4) */
  label: string;
  /** relative paths that must exist under the checked root for the category to be delivered */
  deliverables: string[];
  /** task ids owning any remaining gap (AC4 — attribution must resolve to filed tasks) */
  attribution: string[];
  /** human criterion (SPEC §4) */
  criterion: string;
}

export const SPEC_DOC_REL = "orchestration/SPEC-complete-delivery-surface-2026-08-05.md";
export const L1_BEGIN_MARKER = "<!-- L1-MANIFEST-BEGIN -->";
export const L1_END_MARKER = "<!-- L1-MANIFEST-END -->";

export const MANIFEST: DeliveryCategory[] = [
  {
    id: 1,
    name: "mechanism-and-runtime",
    label: "机件与运行时",
    deliverables: [
      "plugin/scripts/quay-init.sh",
      "plugin/scripts/sync-vendor.sh",
      "plugin/scripts/verify-installed-executables.sh",
    ],
    attribution: [],
    criterion:
      "referenced-set ⊆ landed-set（verify_referenced_landed，verify-installed-executables 钉住逐字节）；vendor 运行时由 sync-vendor.sh 构建、quay-init 铺入目标",
  },
  {
    id: 2,
    name: "loop-docs",
    label: "循环文档",
    deliverables: ["plugin/loop/fast-mode-loop-tick.md", "plugin/loop/orchestrator-loop-tick.md"],
    attribution: ["gap-productize-the-manager-layer"],
    criterion:
      "outer+inner 两层 tick 文档随包（铺入 docs/analysis/ 与 orchestration/）；manager 层缺 → 归属 gap-productize-the-manager-layer",
  },
  {
    id: 3,
    name: "launch-config",
    label: "启动配置",
    deliverables: [".claude/launch.settings.json", "plugin/scripts/quay-launch.sh"],
    attribution: ["gap-crystallize-launch-config-into-checked-in-settings-file"],
    criterion:
      "启动命令/模型/上下文环境变量/TUI 环境变量结晶进检查进仓库的 .claude/launch.settings.json；quay-launch.sh 读取并生成启动命令（不再靠手打一行 shell）",
  },
  {
    id: 4,
    name: "session-topology",
    label: "会话拓扑",
    deliverables: [
      "plugin/scripts/quay-topology.sh",
      "plugin/scripts/topology-check.sh",
      "plugin/skills/session-topology/SKILL.md",
    ],
    attribution: ["gap-tmux-session-topology-no-factory-definition"],
    criterion:
      "三窗口（outer/inner/manager）拓扑出厂定义：quay-topology.sh + topology-check.sh + session-topology skill（每层起什么命令、谁驱动谁）",
  },
  {
    id: 5,
    name: "periodic-anchor",
    label: "周期锚点",
    deliverables: ["plugin/scripts/os-anchor-install.sh", "plugin/scripts/os-anchor-watchdog.sh"],
    attribution: ["gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash"],
    criterion:
      "OS 级周期锚点（os-anchor-install.sh systemd user timer + os-anchor-watchdog.sh）——跨崩溃存活的真实周期锚点，不依赖任何 Claude 会话",
  },
  {
    id: 6,
    name: "observation-and-verification",
    label: "观测与校验",
    deliverables: ["plugin/scripts/verify-delivery-surface.ts", "plugin/skills/cold-start/SKILL.md"],
    attribution: ["gap-quality-criteria-are-point-in-time-no-trend-criteria"],
    criterion:
      "L1 六类完整性检查（本条）+ AC8c 六键（启动瞬间）+ L2 趋势判据（gap-quality-criteria-are-point-in-time-no-trend-criteria 承载）",
  },
];

export interface SpecManifest {
  schemaVersion: number;
  categories: DeliveryCategory[];
}

// ── SPEC doc manifest parsing (the single-source live copy) ────────────────────────────────────────

/** Extract the fenced L1 manifest JSON block from the SPEC doc text. Returns null if not found. */
export function extractSpecManifest(text: string): string | null {
  const start = text.indexOf(L1_BEGIN_MARKER);
  if (start === -1) return null;
  const end = text.indexOf(L1_END_MARKER, start);
  if (end === -1) return null;
  const block = text.slice(start + L1_BEGIN_MARKER.length, end);
  // Trim to the first { ... } JSON object (the fenced code block may carry ```json fence markers).
  const open = block.indexOf("{");
  const close = block.lastIndexOf("}");
  if (open === -1 || close === -1 || close <= open) return null;
  return block.slice(open, close + 1);
}

export function parseSpecManifest(text: string): SpecManifest | null {
  const json = extractSpecManifest(text);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as SpecManifest;
    if (!Array.isArray(parsed.categories) || parsed.categories.length !== 6) return null;
    for (const c of parsed.categories) {
      if (typeof c.id !== "number" || typeof c.name !== "string" || !Array.isArray(c.deliverables)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Structural equality of two category manifests (order-significant, by id/name/deliverables/attribution). */
export function manifestsEqual(a: DeliveryCategory[], b: DeliveryCategory[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.name !== y.name) return false;
    if (x.label !== y.label) return false;
    if (JSON.stringify(x.deliverables) !== JSON.stringify(y.deliverables)) return false;
    if (JSON.stringify(x.attribution) !== JSON.stringify(y.attribution)) return false;
  }
  return true;
}

// ── Root resolution ─────────────────────────────────────────────────────────────────────────────────

/**
 * Walk up to the workspace root. Sentinel is worktree-safe: the main checkout and every task
 * worktree have `package.json` + `plugin/` + `scripts/test.sh`, while a quay-init target does NOT
 * lay down `scripts/test.sh` (SPEC §1) — so auto-detection resolves the BUNDLE root, never a target.
 * (`--root <dir>` is the explicit way to point at a target workspace after install.)
 */
export function findRepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, "package.json")) &&
      fs.existsSync(path.join(dir, "plugin")) &&
      fs.existsSync(path.join(dir, "scripts", "test.sh"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find bundle root (package.json + plugin/ + scripts/test.sh) upward from " + startDir);
}

// ── Surface check ───────────────────────────────────────────────────────────────────────────────────

export interface CategoryResult {
  id: number;
  name: string;
  label: string;
  covered: boolean;
  missing: string[];
  attributionHoles: string[];
  attribution: string[];
}

export interface SurfaceReport {
  root: string;
  categories: CategoryResult[];
  covered: number;
  total: number;
  specLive: boolean | null; // null = SPEC doc absent at root (n/a)
  specLiveReason: string;
}

/** Run the six-category coverage check against a root. */
export function checkSurface(root: string, manifest: DeliveryCategory[] = MANIFEST): SurfaceReport {
  const categories: CategoryResult[] = manifest.map((c) => {
    const missing = c.deliverables.filter((d) => !fs.existsSync(path.join(root, d)));
    const attributionHoles = c.attribution.filter((t) => !fs.existsSync(path.join(root, "tasks", `${t}.md`)));
    return {
      id: c.id,
      name: c.name,
      label: c.label,
      covered: missing.length === 0,
      missing,
      attributionHoles,
      attribution: c.attribution,
    };
  });
  const covered = categories.filter((c) => c.covered).length;

  // spec_is_live: when the SPEC doc exists at the root, its manifest must match the executable one.
  const specPath = path.join(root, SPEC_DOC_REL);
  let specLive: boolean | null = null;
  let specLiveReason = "n/a";
  if (fs.existsSync(specPath)) {
    const docText = fs.readFileSync(specPath, "utf8");
    const docManifest = parseSpecManifest(docText);
    if (!docManifest) {
      specLive = false;
      specLiveReason = "SPEC doc present but its L1-MANIFEST block is missing or unparseable";
    } else if (!manifestsEqual(manifest, docManifest.categories)) {
      specLive = false;
      specLiveReason = "SPEC doc L1-MANIFEST drifts from the executable manifest (doc frozen? update it)";
    } else {
      specLive = true;
      specLiveReason = "SPEC doc L1-MANIFEST matches the executable manifest";
    }
  }

  return { root, categories, covered, total: manifest.length, specLive, specLiveReason };
}

// ── Output ──────────────────────────────────────────────────────────────────────────────────────────

export function formatSurface(report: SurfaceReport): string {
  const lines: string[] = [];
  lines.push(`surface_categories_covered=${report.covered}/${report.total}`);
  lines.push(
    `spec_is_live=${report.specLive === null ? "n/a" : report.specLive ? "1" : "0"}${report.specLiveReason === "n/a" ? "" : ` (${report.specLiveReason})`}`
  );
  for (const c of report.categories) {
    const status = c.covered ? "COVERED" : "MISSING";
    const missing = c.missing.length ? ` — missing: ${c.missing.join(", ")}` : "";
    const holes = c.attributionHoles.length ? ` — attribution-hole: ${c.attributionHoles.join(", ")}` : "";
    const attr = c.attribution.length ? ` | 归属: ${c.attribution.join(", ")}` : "";
    lines.push(`  [${c.id}/${report.total}] ${c.name} (${c.label}): ${status}${missing}${holes}${attr}`);
  }
  return lines.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  const args = argv.slice(2);
  let root: string | null = null;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[i + 1];
      i++;
    } else if (args[i].startsWith("--root=")) {
      root = args[i].slice("--root=".length);
    } else if (args[i] === "--json") {
      asJson = true;
    } else if (args[i] === "--surface" || args[i] === "--help") {
      // accepted; --surface is the default surface mode
    } else {
      console.error(`ERROR: unknown argument: ${args[i]}`);
      return 2;
    }
  }
  let resolved: string;
  try {
    resolved = root ? path.resolve(root) : findRepoRoot();
  } catch (e) {
    console.error(`ERROR: ${(e as Error).message}`);
    return 2;
  }
  if (!fs.existsSync(resolved)) {
    console.error(`ERROR: check root not found: ${resolved}`);
    return 2;
  }

  const report = checkSurface(resolved);
  const ok = report.covered === report.total && report.specLive !== false;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok,
          surface_categories_covered: `${report.covered}/${report.total}`,
          covered: report.covered,
          total: report.total,
          spec_is_live: report.specLive === null ? "n/a" : report.specLive ? 1 : 0,
          spec_live_reason: report.specLiveReason,
          root: resolved,
          categories: report.categories.map((c) => ({
            id: c.id,
            name: c.name,
            label: c.label,
            covered: c.covered,
            missing: c.missing,
            attributionHoles: c.attributionHoles,
            attribution: c.attribution,
          })),
        },
        null,
        2
      )
    );
  } else {
    console.log(formatSurface(report));
    if (ok) {
      console.log(`PASS: all ${report.total} delivery categories covered, spec_is_live satisfied`);
    } else {
      console.log(`FAIL: ${report.covered}/${report.total} delivery categories covered (band = ${report.total}); spec_is_live=${report.specLive === false ? "0" : "n/a"}`);
    }
  }
  return ok ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  process.exitCode = main(process.argv);
}
