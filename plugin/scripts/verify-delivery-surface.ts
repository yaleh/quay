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
//   node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory [--root <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface --root <consumer-dir> [--layout source|laid|auto]
//     (gap-verify-delivery-surface-checks-source-layout-not-consumer-laid: --layout laid checks a
//      quay-init --loop CONSUMER's laid layout — orchestration/+docs/analysis/ — instead of the
//      SOURCE bundle layout. Default --layout auto detects: scripts/test.sh present ⇒ source;
//      orchestration/ + docs/analysis/ present ⇒ laid.)

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
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
    // gap-manager-layer-no-verified-install-vector (manager 件入清单): 三层 tick 文档全部随包。
    // outer+inner 铺入 docs/analysis/ 与 orchestration/；manager 层 = 出厂模板
    // plugin/loop/manager-loop-tick.md + 可安装结晶 plugin/skills/manager/SKILL.md（npm-pack 裸机
    // `quay manager start` 冷启动向量的管理器锚点）——不再只是「归属 gap-productize-the-manager-layer」。
    deliverables: [
      "plugin/loop/fast-mode-loop-tick.md",
      "plugin/loop/orchestrator-loop-tick.md",
      "plugin/loop/manager-loop-tick.md",
      "plugin/skills/manager/SKILL.md",
    ],
    attribution: ["gap-productize-the-manager-layer"],
    criterion:
      "三层 tick 文档随包（outer+inner 铺入 docs/analysis/ 与 orchestration/；manager 层 = plugin/loop/manager-loop-tick.md 出厂模板 + plugin/skills/manager/SKILL.md 可安装结晶）",
  },
  {
    id: 3,
    name: "launch-config",
    label: "启动配置",
    deliverables: [".claude/launch.settings.json", ".quay/profiles.yml", "plugin/scripts/quay-launch.sh"],
    attribution: ["gap-crystallize-launch-config-into-checked-in-settings-file"],
    criterion:
      "launch.settings.json 只留 Claude Code 认识的键（$schema/permissions/env）；profile/roles（launcher/model/--bare/-n/unset）+ flag-only 参数结晶进 .quay/profiles.yml（AC154 profile 抽层）；quay-launch.sh 是内部实现（非用户直接调用面），读取 profiles 生成启动命令（不再靠手打一行 shell）",
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
      "单窗口（outer）拓扑出厂定义：quay-topology.sh + topology-check.sh + session-topology skill（每层起什么命令、谁驱动谁；manager 跨项目，不属于项目拓扑）",
  },
  {
    id: 5,
    name: "periodic-anchor",
    label: "周期锚点（已排除，非交付物）",
    // 人裁定 2026-08-06：os-anchor-install.sh / os-anchor-watchdog.sh 是 quay 自身开发阶段的工具，
    // 不进交付物 build（quay-init.sh 从不调用它，需人工显式安装）。deliverables 留空使本类目
    // 恒 covered（vacuous——missing.length === 0），不再对这两个文件的存在与否作判定；
    // 保留类目位（id=5, total 仍为 6）以免影响本文件 :149 与 verify-delivery-surface.test.mjs
    // 里硬编码的 6/6 结构断言。
    deliverables: [],
    attribution: ["gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash"],
    criterion:
      "OS 级周期锚点工具（os-anchor-install.sh / os-anchor-watchdog.sh）——人裁定为开发阶段工具，明确排除出交付物，仅供人工显式使用",
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

// ── Consumer LAID layout manifest (gap-verify-delivery-surface-checks-source-layout-not-consumer-laid) ──
// The SOURCE manifest above checks quay's OWN repo layout (plugin/scripts/…, plugin/loop/…). A quay-init
// --loop CONSUMER is laid out differently: tick docs land in orchestration/ + docs/analysis/, the
// installer (quay-init.sh) and dev-tree tools (sync-vendor.sh) are NOT laid, the vendor runtime lands in
// .quay/runtime/, and the observer is session-liveness.sh + its generated orchestration/session-liveness.env.
// Checking a consumer against the SOURCE manifest is structurally impossible (0/6 for EVERY consumer — the
// parent-defect this task kills: "the check that validates delivery completeness CANNOT see the layout it
// validates"). LAID_MANIFEST is the SAME six-category surface, expressed at the CONSUMER's laid paths.
// Single-source note: this is a SECOND executable manifest, kept honest by tests that pin BOTH 6/6 on the
// bundle (source) AND 6/6 on a fixture that mirrors a real quay-init --loop consumer (laid). `--layout laid`
// (or auto-detection when the root is a consumer, see detectLayout) selects it.

export const LAID_MANIFEST: DeliveryCategory[] = [
  {
    id: 1,
    name: "mechanism-and-runtime",
    label: "机件与运行时（laid）",
    deliverables: [
      ".quay/config.yml",
      ".quay/runtime/bin/quay.js",
      ".quay/runtime/bin/quay-native.js",
      ".quay/runtime/provider.yml",
    ],
    attribution: [],
    criterion:
      "消费者自包含机制+运行时：.quay/config.yml（provider 映射）+ .quay/runtime/（quay-init 铺入的自包含 vendor 运行时，非 dev-tree 依赖）",
  },
  {
    id: 2,
    name: "loop-docs",
    label: "循环文档（laid）",
    deliverables: ["orchestration/orchestrator-loop-tick.md", "docs/analysis/fast-mode-loop-tick.md"],
    attribution: ["gap-productize-the-manager-layer"],
    criterion:
      "outer+inner 两层 tick 文档铺入消费者 orchestration/ 与 docs/analysis/（laid 真实位置；源布局 plugin/loop/ 不铺）",
  },
  {
    id: 3,
    name: "launch-config",
    label: "启动配置（laid）",
    deliverables: [".quay/profiles.yml", "plugin/scripts/quay-launch.sh"],
    attribution: ["gap-crystallize-launch-config-into-checked-in-settings-file"],
    criterion:
      "profile 承载 .quay/profiles.yml 随 quay-init 铺入消费者 .quay/；quay-launch.sh 随派生铺设集铺入消费者 plugin/scripts/（由 manager SKILL.md 的 plugin/scripts/ 引用派生）",
  },
  {
    id: 4,
    name: "session-topology",
    label: "会话拓扑（laid）",
    deliverables: ["plugin/scripts/session-liveness.sh", "orchestration/session-liveness.env"],
    attribution: ["gap-tmux-session-topology-no-factory-definition"],
    criterion:
      "session-liveness 监控（唯一 observer）铺入 plugin/scripts/ + 生成 orchestration/session-liveness.env（laid 会话拓扑）",
  },
  {
    id: 5,
    name: "periodic-anchor",
    label: "周期锚点（已排除，非交付物）",
    deliverables: [],
    attribution: ["gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash"],
    criterion:
      "OS 级周期锚点工具（os-anchor-install.sh / os-anchor-watchdog.sh）——人裁定为开发阶段工具，明确排除出交付物，仅供人工显式使用",
  },
  {
    id: 6,
    name: "observation-and-verification",
    label: "观测与校验（laid）",
    deliverables: ["plugin/scripts/verify-delivery-surface.ts", "plugin/scripts/l1-delivery-surface-check.ts"],
    attribution: ["gap-quality-criteria-are-point-in-time-no-trend-criteria"],
    criterion:
      "L1 六类完整性检查随铺设集交付（verify-delivery-surface.ts + l1-delivery-surface-check.ts）——消费方装后可自检（追加两半 #2：检查本身必须随铺设集交付）",
  },
];

// ── Layout detection (source bundle vs consumer laid) ───────────────────────────────────────────────
// The SAME six-category surface is expressed at two layouts: the bundle's OWN repo layout (source) and a
// quay-init --loop consumer's laid layout. Detection is by distinguishing markers, NOT by best-effort:
//   - a bundle/source root has scripts/test.sh (quay-init NEVER lays it into a consumer — the consumer
//     keeps its own test command);
//   - a consumer laid root has BOTH orchestration/ AND docs/analysis/ (quay-init --loop mkdir -p's both).
// Anything else defaults to source (backward compatible with bare fixtures / plain dirs).

export type Layout = "source" | "laid";

export function detectLayout(root: string): Layout {
  if (
    fs.existsSync(path.join(root, "scripts", "test.sh")) &&
    fs.existsSync(path.join(root, "plugin")) &&
    fs.existsSync(path.join(root, "package.json"))
  ) {
    return "source";
  }
  if (fs.existsSync(path.join(root, "orchestration")) && fs.existsSync(path.join(root, "docs", "analysis"))) {
    return "laid";
  }
  return "source";
}

export function manifestForLayout(layout: Layout): DeliveryCategory[] {
  return layout === "laid" ? LAID_MANIFEST : MANIFEST;
}

// ── Delivery inventory (computed at check time — no committed snapshot) ───────────────────────────
// gap-delivery-inventory-check-time-computation (2026-08-29): the outline §6 DELIVERY-INVENTORY
// counts (scripts=294 · gate-scripts=14 · …) were a COMMITTED, hand-synced snapshot. Every
// plugin/scripts A/D forced a same-change outline edit (delivery-inventory-drift-gate.sh), which
// made the outline a SHARED merge-conflict hotspot (2026-08-29 batch re-dispatch: 3 of 4 merge
// conflicts landed on the outline's `scripts=N`). The snapshot is REMOVED; the counts are now
// COMPUTED AT CHECK TIME by `--inventory` (this module) — the single command release/human audit
// runs. With no snapshot to drift against, `--inventory` is a REPORT (exit 0 on a valid root), not
// a pass/fail drift check. Predecessor ruling (gap-delivery-outline-vs-verify-surface-single-source,
// 2026-08-06) made verify-delivery-surface the single source for the counts; this task completes it
// by deleting the derived copy instead of keeping it in sync.

export interface DeliveryInventoryEntry {
  /** stable key — the `name=count` token printed by `--inventory` */
  name: string;
  /** repo-relative dir under the checked root */
  dir: string;
  /** what this plugin-bundle directory carries */
  criterion: string;
}

export const DELIVERY_INVENTORY: DeliveryInventoryEntry[] = [
  { name: "scripts", dir: "plugin/scripts", criterion: "机制与运行时脚本" },
  { name: "gate-scripts", dir: "plugin/gate-scripts", criterion: "闸门（经典管线 era，分层退役——文件留树、不铺）" },
  { name: "skills", dir: "plugin/skills", criterion: "技能（init/cold-start/author/execute/…）" },
  { name: "probes", dir: "plugin/probes", criterion: "探针（routine track probe spec，DIR-056）" },
  { name: "loop", dir: "plugin/loop", criterion: "loop tick 文档（outer/inner/manager）" },
  { name: "workflows", dir: "plugin/workflows", criterion: "workflow 脚本" },
  { name: "agents", dir: "plugin/agents", criterion: "agent 定义" },
  { name: "vendor", dir: "plugin/vendor", criterion: "自包含运行时（quay/quay-native bundles）" },
];

/** Count non-hidden entries under <root>/<dir> (top-level readdirSync, non-hidden). */
export function countInventoryDir(root: string, dir: string): number {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return -1; // missing dir → reported as -1 by --inventory
  return fs.readdirSync(abs).filter((f) => !f.startsWith(".")).length;
}

export interface InventoryEntryResult {
  name: string;
  dir: string;
  disk: number;
  criterion: string;
}

export interface InventoryReport {
  root: string;
  entries: InventoryEntryResult[];
}

/** Compute the delivery-inventory counts from disk (no committed snapshot involved). */
export function computeInventory(root: string): InventoryReport {
  const entries: InventoryEntryResult[] = DELIVERY_INVENTORY.map((e) => ({
    name: e.name,
    dir: e.dir,
    disk: countInventoryDir(root, e.dir),
    criterion: e.criterion,
  }));
  return { root, entries };
}

function formatInventory(report: InventoryReport): string {
  const lines: string[] = [];
  lines.push(`delivery-inventory (root=${report.root})`);
  lines.push(`  inventory_snapshot=none (computed at check time — no committed snapshot)`);
  for (const e of report.entries) {
    lines.push(`  ${e.name}=${e.disk} (${e.criterion})`);
  }
  return lines.join("\n");
}

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
  layout: Layout;
  categories: CategoryResult[];
  covered: number;
  total: number;
  specLive: boolean | null; // null = SPEC doc absent at root (n/a)
  specLiveReason: string;
}

/** Run the six-category coverage check against a root for the given layout. */
export function checkSurface(root: string, manifest: DeliveryCategory[] = MANIFEST, layout: Layout = "source"): SurfaceReport {
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

  return { root, layout, categories, covered, total: manifest.length, specLive, specLiveReason };
}

// ── Output ──────────────────────────────────────────────────────────────────────────────────────────

export function formatSurface(report: SurfaceReport): string {
  const lines: string[] = [];
  lines.push(`surface_categories_covered=${report.covered}/${report.total}`);
  lines.push(`layout=${report.layout}`);
  // Contract measure (consumer_surface): the outer greps stdout for `ok|PASS`. For a LAID consumer,
  // a non-zero covered surface IS the goal (AC1 — "不再 0/6"); emit an explicit ok token so a partial
  // consumer is countable (>0), not silently 0.
  if (report.layout === "laid") {
    lines.push(`consumer_surface_ok=${report.covered > 0 ? "1" : "0"}`);
  }
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
  let inventoryMode = false;
  let layoutArg: Layout | "auto" | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[i + 1];
      i++;
    } else if (args[i].startsWith("--root=")) {
      root = args[i].slice("--root=".length);
    } else if (args[i] === "--json") {
      asJson = true;
    } else if (args[i] === "--inventory") {
      inventoryMode = true;
    } else if (args[i] === "--write-inventory") {
      // Retired (gap-delivery-inventory-check-time-computation): there is no committed snapshot to
      // regenerate — the inventory is computed at check time by `--inventory`.
      console.error("ERROR: --write-inventory is retired — the inventory is computed at check time (use --inventory)");
      return 2;
    } else if (args[i] === "--layout") {
      const v = args[i + 1];
      if (v !== "source" && v !== "laid" && v !== "auto") {
        console.error(`ERROR: unknown --layout value: ${v} (expected source|laid|auto)`);
        return 2;
      }
      layoutArg = v as Layout | "auto";
      i++;
    } else if (args[i].startsWith("--layout=")) {
      const v = args[i].slice("--layout=".length);
      if (v !== "source" && v !== "laid" && v !== "auto") {
        console.error(`ERROR: unknown --layout value: ${v} (expected source|laid|auto)`);
        return 2;
      }
      layoutArg = v as Layout | "auto";
    } else if (args[i] === "--surface" || args[i] === "--help") {
      // accepted; --surface is the default surface mode
    } else {
      console.error(`ERROR: unknown argument: ${args[i]}`);
      return 2;
    }
  }

  // ── inventory mode (computed at check time — a REPORT, not a drift check) ─────────────────────────
  if (inventoryMode) {
    let resolved: string;
    try {
      resolved = root ? path.resolve(root) : repoRoot();
    } catch (e) {
      console.error(`ERROR: ${(e as Error).message}`);
      return 2;
    }
    if (!fs.existsSync(resolved)) {
      console.error(`ERROR: check root not found: ${resolved}`);
      return 2;
    }
    const report = computeInventory(resolved);
    if (asJson) {
      console.log(
        JSON.stringify(
          {
            root: report.root,
            entries: report.entries.map((e) => ({ name: e.name, dir: e.dir, disk: e.disk })),
          },
          null,
          2
        )
      );
    } else {
      console.log(formatInventory(report));
    }
    return 0;
  }
  let resolved: string;
  try {
    resolved = root ? path.resolve(root) : repoRoot();
  } catch (e) {
    console.error(`ERROR: ${(e as Error).message}`);
    return 2;
  }
  if (!fs.existsSync(resolved)) {
    console.error(`ERROR: check root not found: ${resolved}`);
    return 2;
  }

  const layout: Layout = layoutArg === null || layoutArg === "auto" ? detectLayout(resolved) : layoutArg;
  const report = checkSurface(resolved, manifestForLayout(layout), layout);
  const ok = report.covered === report.total && report.specLive !== false;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok,
          layout,
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

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "verify-delivery-surface";
if (isDirect) {
  process.exitCode = main(process.argv);
}
