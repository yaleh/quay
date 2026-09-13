// probe-write-guard.ts — the mechanical FILE-ONLY guard for LLM probe spawns: a probe's semantic
// half must not modify any TRACKED file while it runs (its product is JSON on stdout; every write
// to disk is performed mechanically by the caller afterwards). "spawn 期间出现的新改动" = violation.
//
// WHY IT IS ITS OWN MODULE (was inline in meta-driver.ts until 2026-09-13): two callers now need the
// same guard — `meta-driver.ts` (the meta loop's semantic half) and `probe-routine.ts` (the generic
// probe routine hosted by the quality driver). Hosting the guard in meta-driver would force
// quality-gate-driver → probe-routine → meta-driver → quality-gate-driver: an import CYCLE.
// ⛔ 不是两份实现——meta-driver.ts re-exports these symbols, so the single implementation stays here
// (ADR-004 single-source; the re-export keeps every existing caller/test import path working).

import { spawnSync } from "node:child_process";

/** 当前被改动的 tracked 文件集（porcelain 的 XY 前缀去掉后的路径）。git 不可用 ⇒ null
 *  （读不出 ≠ 没有改动，硬规则 6——调用侧据此跳过守卫而不是伪装成"干净"）。 */
export function snapshotTrackedChanges(root: string): Set<string> | null {
  try {
    const r = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
    if (r.status !== 0) return null;
    const set = new Set<string>();
    for (const line of String(r.stdout ?? "").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("??")) continue; // 未跟踪文件不算（probe 产出的落盘由调用方机械执行）
      set.add(t.slice(2).trim());
    }
    return set;
  } catch { return null; }
}

/** spawn 期间新增的改动 = 违约集合。任一侧读不出 ⇒ 返回 null（无法评估，⛔ 不当作"没违约"）。 */
export function probeWriteViolations(before: Set<string> | null, after: Set<string> | null): string[] | null {
  if (before === null || after === null) return null;
  return [...after].filter((f) => !before.has(f));
}
