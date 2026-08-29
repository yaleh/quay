// outer-cron-registry.ts — AC81 注册表收据 + 每轮四判据核实（outer + inner 两层的 CronCreate 锚）。
// (tasks/gap-ac81-registry-receipt-and-four-criteria, AC1-AC6 + DoD;
//  tasks/gap-cron-registry-global-path-migration, AC1-AC5).
//
// ⛔ RETIRED-WITH-RETIRING-LAYER (gap-b0-retirement-precondition-checker-call-surface)：本脚本只被 outer
//   执行核（orchestrator-tick-core.md A23，AC81 锚核实）引用，无任何退役层之外的留存调用面。
//   outer/inner 的 CronCreate 锚将随两层退役而消失（SPEC §2.3b），本注册表收据/四判据核实随之失去
//   对象——【随退役层显式退役】（与 outer-anchor-check.ts 一并，它是本脚本的唯一 import 来源）。
//   该标记被 outer-retirement-precondition-check.ts 机械识别为「已处置」。
//
// 回答的问题（@instrument）：「outer/inner 的 CronCreate 锚是否有一个注册表收据（cron id +
//   cron 表达式 + prompt sha256 + 创建时刻），且每轮四判据核实（① CronList 恰一条 ∧ ② id==注册表 ∧
//   ③ 收据未过期 registry-verified ∧ ④ prompt sha256==正本）能取假——并在 CronCreate 文档的
//   7 天自动过期硬上限（「Recurring tasks auto-expire after 7 days — they fire one final time,
//   then are deleted」）到来前，把锚的剩余寿命报出来？」
//
// 背景（人 2026-08-14 14:2xZ 裁定「把三层统一应用 CronCreate 加入本阶段目标和 AC，包括配套工作」）：
//   manager 已有注册表收据 + 每轮四判据核实（manager-arm-loop.sh --verify，连续 17 轮全真）。
//   AC81 把同一形态扩到 outer + inner。本模块 = 注册表收据 + 四判据核实器（本 .ts——判据2 的载体）。
//
// 注册表位置（2026-08-17 人裁定方案②——全局 per-layer 路径、不进 git）：
//   ~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt
//   <repo-root-slug> = repo 根绝对路径把 '/' 全替换成 '-'（现成算法抄 session-liveness.sh:1162：
//   slug=$(printf '%s' "$root" | tr '/' '-')；本项目 root=/home/yale/work/quay ⇒ -home-yale-work-quay）。
//   覆盖：QUAY_GLOBAL_DIR 环境变量改全局目录（镜像 manager 的 QUAY_GLOBAL_DIR，默认 $HOME/.quay-global）。
//   为何全局而非 git：git 版随 worktree fork 携带 fork 那刻的陈旧快照（死 cronId，JSON 合法但与合格同形，
//   硬规则 3b）；两层冷启动 cron 重建直写同一 git 收据 ⇒ bypass-check 误红（发生率 3）+ fan-in add/add。
//   全局路径 = 任何 worktree 读到同一个文件 = 当前真值，无快照、不被 bypass-check 看见、不可能 add/add
//   （对照 manager 的 ~/.quay-global/manager/loop-registry.txt）。
//   审计线：锚变更（重建）由 --record 追加 append-only jsonl（<base>/cron-registry-events.jsonl），
//   保留 git 版唯一真实价值（收据变更留痕），但不为审计线把当前值绑回 git。
//
// 判据能取假（对 manager 形态逐条保留，硬规则 3/4）：
//   ① CronList 恰一条 —— 由 `--cron-list` 传入的会话内 CronList 视图判定；0 条或 ≥2 条即假。
//   ② id == 注册表 —— CronList 条目的 id 必须等于注册表该层的 cronId；不等即假。
//   ③ --verify registry-verified —— 注册表该层记录必须带 verifiedAt 且未过期（now − verifiedAt ∈
//      [0, staleSeconds]，默认 7 天）；缺 verifiedAt / 过期 / 未来时刻即假（镜像 manager 的
//      receipt-stale）。「注册表说武装了」≠「注册表说武装了且真 cron 已核实」。
//   ④ 锚点校验（sha256）—— 注册表记录的 promptSha256 必须等于【当前正本 prompt】的 sha256
//      （outer 正本 = orchestration/outer-tick-prompt.txt；inner 正本 = plugin/loop/
//      fast-mode-loop-tick.md 的 AC80-INNER-ANCHOR 段，outer 侧落地；--canonical-file 是测试接缝）。
//      正本缺失 ⇒ 判据④ 无法评估（独立取值，非通过；硬规则 3b）。
//   ⊢ 能取假实证（manager 09:1xZ）：多传 `--home` 覆盖默认值 ⇒ 读成 registry-missing ⇒ 差点误报
//     「88 轮断了」——判据可被输入形态污染，必须每轮核实。
//
// 判据5（7 天硬上限剩余寿命，manager 14:2xZ 报）：CronCreate 文档写明 Recurring tasks auto-expire
//   after 7 days ⇒ 三层锚都会 7 天后静默消失，注册表收据能查出「CronList 空」但无提前预警。
//   ⇒ 核实步骤必报锚的剩余寿命 =（createdAt + 7 天 − now）；< 24h 即报（CRITICAL，VIOLATED）。
//   能取假：现在剩余 ≈7 天判据为 false，到第 6 天翻 true。
//
// CronList 是会话内工具，脚本无法直接调用 ⇒ 活 CronList 视图由操作者/调用方以 `--cron-list '<json>'`
//   传入（镜像 AC80 的 --cron-prompt 接缝；外层可把自己的 CronList 视图喂进来）。绝不解析 CronList
//   的截断显示文本。活 prompt 同样不经 CronList 截断显示——正本比对（判据④）用 git 跟踪正本文件。
//
// 退出码（硬规则 3b：无法评估 ≠ 合格，独立取值）：
//   0 = OK（注册表存在 + 四判据全真 + 剩余寿命 ≥24h）
//   1 = VIOLATED（①-④ 任一为假，或剩余寿命 < 24h / 已过期 —— fail loud，绝不静默通过）
//   2 = NOT-EVALUATED（未提供 --cron-list / 注册表缺失或层缺失 / 判据④ 正本缺失且 ①②③ 无定论
//       ——判据无法评估，非通过）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts \
//       --verify --layer inner|outer [--cron-list '<json>'] [--canonical-file <path>] \
//       [--registry-base <dir>] [--root <dir>] [--stale-seconds <n>] [--json]
//   node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts \
//       --show [--root <dir>] [--json]          # 打印两层注册表收据（判据1 直接可查）
//   node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts \
//       --record --layer inner|outer --cron-id <id> --cron-expr '<expr>' \
//       [--canonical-file <path>] [--registry-base <dir>] [--json]
//       # 锚重建后把收据写进全局 per-layer 注册表 + 追加审计线（AC5；替代旧的「手改 git JSON 并提交」）
//   --verify              必选核实模式（与 --layer 配对）。
//   --record              记录模式：写/更新该层全局注册表收据 + 追加审计 jsonl（锚重建后调用）。
//   --layer <inner|outer> 选定层：注册表记录 + 正本来源。
//   --cron-id <id>        --record 的新 cron id（CronCreate 返回值；零记忆清扫重建后取 CronList 活值）。
//   --cron-expr <expr>    --record 的 cron 表达式（投进 CronCreate 的表达式）。
//   --cron-list <json>    CronList 活视图：JSON 数组或单对象，每条含 id（id|name|cronId）。
//   --canonical-file <p>  覆盖正本来源（fixture 接缝，测试用）。
//   --registry-base <dir> 覆盖注册表基目录（fixture 接缝，测试用；默认 ~/.quay-global/<repo-root-slug>）。
//   --root <dir>          仓库根（默认 cwd；决定 slug）。
//   --stale-seconds <n>   判据③ 收据新鲜度窗口（默认 604800 = 7 天）。
//   --json                机器可读输出。
//   --show                打印两层注册表收据并退出（无核实逻辑）。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractCanonical, LAYERS } from "./outer-anchor-check.ts";

export const EXIT_OK = 0;
export const EXIT_VIOLATED = 1;
export const EXIT_NOT_EVALUATED = 2;

/** 全局目录覆盖（镜像 manager 的 QUAY_GLOBAL_DIR；默认 $HOME/.quay-global）。 */
export function globalDir(env?: string): string {
  return env ?? process.env.QUAY_GLOBAL_DIR ?? path.join(os.homedir(), ".quay-global");
}

/** repo 根 → 分片 slug（把绝对路径的 '/' 全替换成 '-'；抄 session-liveness.sh:1162 的分片算法）。 */
export function repoSlug(root: string): string {
  return String(root).replace(/\//g, "-");
}

/**
 * 从任意工作目录/工作树解析【项目主检出根】（非 worktree 路径）。git 的 --git-common-dir 在 worktree
 * 里返回主检出的 .git 路径——AC2「任一 worktree（含 fork 早的旧 worktree）读注册表得到当前真值」要求
 * slug 必须按【项目】分片而非按 cwd/worktree 分片（否则每个 worktree 各自一个空注册表，读不到真值）。
 * 非 git 目录（tmp fixture）⇒ 回退 path.resolve(root)。
 */
export function canonicalRepoRoot(root: string): string {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
    );
    const commonDir = out.trim();
    if (commonDir) return path.dirname(commonDir);
  } catch {
    // 非 git 目录 ⇒ 回退传入 root。
  }
  return path.resolve(root);
}

/** 注册表基目录 = <globalDir>/<project-slug>（按项目分片——outer/inner 是按项目的，多项目不互相覆盖）。
 *  ⚠️ root 是任意调用上下文（主检出 / worktree / verify worktree），slug 用 canonicalRepoRoot 归一化，
 *  任何 worktree 与主检出都解析到同一基目录 ⇒ 读到同一个全局注册表 = 当前真值（AC2）。 */
export function registryBaseFor(root: string, env?: string): string {
  return path.join(globalDir(env), repoSlug(canonicalRepoRoot(root)));
}

/** 该层注册表收据文件 = <base>/<layer>/loop-registry.txt。 */
export function registryFileFor(root: string, layer: string, base?: string): string {
  return path.join(base ?? registryBaseFor(root), layer, "loop-registry.txt");
}

/** 审计线文件 = <base>/cron-registry-events.jsonl（append-only；锚重建即追加）。 */
export function auditFileFor(root: string, base?: string): string {
  return path.join(base ?? registryBaseFor(root), "cron-registry-events.jsonl");
}

/** CronCreate 文档的 7 天自动过期硬上限。 */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** 判据5 的提前预警阈值：剩余 < 24h 即报。 */
export const CRITICAL_REMAINING_MS = 24 * 60 * 60 * 1000;

export interface RegistryRecord {
  cronId: string;
  cronExpr: string;
  promptSha256: string;
  promptBytes?: number;
  createdAt: string;
  verifiedAt: string;
}

export interface Registry {
  version: number;
  note?: string;
  layers: Record<string, RegistryRecord>;
}

/** sha256 hex（UTF-8 字节；判据④ 与注册表 promptSha256 比对）。 */
export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

/** 解析一层 loop-registry.txt（key=value 行）为 RegistryRecord。缺 cronId ⇒ null。 */
export function parseRegistryText(text: string): RegistryRecord | null {
  const kv: Record<string, string> = {};
  for (const line of String(text).split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9]*)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  if (!kv.cronId) return null;
  return {
    cronId: kv.cronId,
    cronExpr: kv.cronExpr ?? "",
    promptSha256: kv.promptSha256 ?? "",
    promptBytes: kv.promptBytes ? Number(kv.promptBytes) : undefined,
    createdAt: kv.createdAt ?? "",
    verifiedAt: kv.verifiedAt ?? "",
  };
}

/** 序列化一层 RegistryRecord 为 loop-registry.txt（key=value 行，尾部换行）。 */
export function serializeRegistryText(rec: RegistryRecord): string {
  return [
    `cronId=${rec.cronId}`,
    `cronExpr=${rec.cronExpr}`,
    `promptSha256=${rec.promptSha256}`,
    `promptBytes=${rec.promptBytes ?? ""}`,
    `createdAt=${rec.createdAt}`,
    `verifiedAt=${rec.verifiedAt}`,
  ].join("\n") + "\n";
}

/**
 * 从全局 per-layer 注册表读入 registry（两层都读；base 覆盖为测试接缝）。
 * 任一层文件缺失 ⇒ 该层缺席；两层都缺失 ⇒ null（NOT-EVALUATED，硬规则 3b 独立取值）。
 */
export function loadRegistry(root: string, base?: string): Registry | null {
  const layers: Record<string, RegistryRecord> = {};
  for (const layer of Object.keys(LAYERS)) {
    try {
      const rec = parseRegistryText(fs.readFileSync(registryFileFor(root, layer, base), "utf8"));
      if (rec) layers[layer] = rec;
    } catch {
      // 该层文件缺失/不可解析 ⇒ 层缺席（调用方按 layer 判 NOT-EVALUATED）。
    }
  }
  if (Object.keys(layers).length === 0) return null;
  return {
    version: 1,
    note: "AC81 注册表收据（全局 per-layer：~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt；任何 worktree 读当前真值，非 fork 快照）",
    layers,
  };
}

/**
 * 写/更新一层全局注册表收据（--record 的写入面）。返回写出的文件路径。
 * 独立可测：任何 worktree 读同一全局路径 ⇒ 当前真值（AC2）。
 */
export function writeRegistryRecord(root: string, layer: string, rec: RegistryRecord, base?: string): string {
  const p = registryFileFor(root, layer, base);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, serializeRegistryText(rec), "utf8");
  return p;
}

/**
 * 追加一条审计线（append-only jsonl；锚重建即追加，保留收据变更留痕——git 版唯一真实价值的替代）。
 * 返回写出的审计文件路径。
 */
export function appendAuditLine(root: string, layer: string, event: Record<string, unknown>, base?: string): string {
  const p = auditFileFor(root, base);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), layer, ...event }) + "\n";
  fs.appendFileSync(p, line, "utf8");
  return p;
}

/**
 * --record 主逻辑：锚重建后把新收据写入该层全局注册表 + 追加审计线。
 * canonicalPrompt 由调用方传入（CLI 从正本文件提取；null = 正本缺失 ⇒ 拒绝写入——收据必须可被判据④核实）。
 */
export function recordLayer(root: string, layer: string, rec: Omit<RegistryRecord, "promptSha256" | "promptBytes" | "createdAt" | "verifiedAt"> & { canonicalPrompt: string | null; nowMs?: number }, base?: string): { ok: boolean; reason: string; file?: string; auditFile?: string } {
  if (!rec.cronId || !rec.cronExpr) {
    return { ok: false, reason: "record 缺 cron-id/cron-expr" };
  }
  if (rec.canonicalPrompt === null) {
    return { ok: false, reason: "record 拒绝：该层正本缺失，无法计算 promptSha256（收据必须可被判据④核实）" };
  }
  const nowMs = rec.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const full: RegistryRecord = {
    cronId: rec.cronId,
    cronExpr: rec.cronExpr,
    promptSha256: sha256Hex(rec.canonicalPrompt),
    promptBytes: Buffer.byteLength(rec.canonicalPrompt, "utf8"),
    createdAt: nowIso,
    verifiedAt: nowIso,
  };
  const file = writeRegistryRecord(root, layer, full, base);
  const auditFile = appendAuditLine(root, layer, {
    event: "anchor-rebuild",
    cronId: full.cronId,
    cronExpr: full.cronExpr,
    promptSha256: full.promptSha256,
    promptBytes: full.promptBytes,
    createdAt: full.createdAt,
    verifiedAt: full.verifiedAt,
  }, base);
  return { ok: true, reason: `recorded ${layer} cronId=${full.cronId}（sha256=${full.promptSha256.slice(0, 12)}…）`, file, auditFile };
}

/**
 * 解析 CronList 活视图（`--cron-list`）。接受 JSON 数组（多条 job）或单对象（一条 job）。
 * 每条 job 的 id 字段按 id|name|cronId 任一取（CronList 工具返回形态的容忍解析）。无法解析 ⇒ null。
 */
export function parseCronList(raw: string): { id: string }[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) return [];
  const jobs: { id: string }[] = [];
  for (const j of arr) {
    if (typeof j !== "object" || j === null) return null;
    const o = j as Record<string, unknown>;
    const id =
      typeof o.id === "string" ? o.id
        : typeof o.name === "string" ? o.name
          : typeof o.cronId === "string" ? o.cronId
            : null;
    if (id === null) return null;
    jobs.push({ id });
  }
  return jobs;
}

/** 判据①：CronList 恰一条。 */
export function cronListExactlyOne(jobs: { id: string }[] | null): boolean {
  return jobs !== null && jobs.length === 1;
}

/** 判据5：剩余寿命（ms）。createdAt 不可解析 ⇒ null。 */
export function remainingLifetimeMs(createdAt: string, nowMs: number): number | null {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return null;
  return createdMs + SEVEN_DAYS_MS - nowMs;
}

/**
 * 解析 cron 表达式分钟字段为排序去重的分钟集合。支持 `*`、步进「星号斜杠 N」、`N/M`、`N-M`、`N`
 * 及逗号组合。解析失败（非标准分钟字段 / 字段数 < 5）⇒ null（无法归一化）。
 * 归一化目标（gap-a23-ticklog-verify-and-cron-normalization）：`* / 20` ≡ `0,20,40`（都第 0/20/40
 * 分钟），严格字符串比较会把语义等价判成漂移 ⇒ 每轮恒红。分钟字段展开成集合后比集合，消除格式差异。
 */
export function cronMinuteSet(expr: string): number[] | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length < 5) return null;
  // 5 字段标准 cron 取第 0 字段为分钟；6 字段（秒级）取第 1 字段——取倒数第 5 字段对两者都成立。
  const minuteField = fields[fields.length - 5];
  const out = new Set<number>();
  for (const part of minuteField.split(",")) {
    const p = part.trim();
    if (p === "") return null;
    let lo: number;
    let hi: number;
    let step = 1;
    if (p === "*") {
      lo = 0;
      hi = 59;
    } else if (/^\*\/(\d+)$/.test(p)) {
      // */N → 0..59 每 N（含 0——*/20 = 0,20,40）
      lo = 0;
      hi = 59;
      step = Number(p.slice(2));
    } else if (/^(\d+)\/(\d+)$/.test(p)) {
      // N/M → N..59 每 M
      const m = /^(\d+)\/(\d+)$/.exec(p)!;
      lo = Number(m[1]);
      hi = 59;
      step = Number(m[2]);
    } else if (/^(\d+)-(\d+)$/.test(p)) {
      // N-M → N..M 每 1
      const m = /^(\d+)-(\d+)$/.exec(p)!;
      lo = Number(m[1]);
      hi = Number(m[2]);
    } else if (/^\d+$/.test(p)) {
      lo = Number(p);
      hi = Number(p);
    } else {
      return null; // 无法识别的分钟子字段（含 `?` 等）——无法归一化
    }
    if (!Number.isInteger(step) || step < 1 || lo < 0 || hi > 59 || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 两个 cron 表达式语义等价？
 * 分钟字段归一化成集合比集合（`* / 20` ≡ `0,20,40`）；其余字段（hour/dom/month/dow）按字符串等。
 * 任一侧无法归一化（分钟字段解析失败）且字符串不等 ⇒ 判不等（保守——不因无法归一化而静默通过）。
 * 真漂移（不同分钟集合，如 `* / 20` vs `* / 30`；或非分钟字段漂移）⇒ false。
 */
export function cronExprsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = a.trim().split(/\s+/);
  const fb = b.trim().split(/\s+/);
  if (fa.length !== fb.length || fa.length < 5) return false;
  const ma = cronMinuteSet(a);
  const mb = cronMinuteSet(b);
  if (ma === null || mb === null) return false; // 无法归一化且字符串不等 ⇒ 不等
  if (ma.length !== mb.length) return false;
  for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) return false;
  for (let i = 0; i < fa.length; i++) {
    if (i === fa.length - 5) continue; // 分钟字段已归一化比
    if (fa[i] !== fb[i]) return false;
  }
  return true;
}

export interface VerifyResult {
  ok: boolean;
  code: number;
  layer: string;
  reason: string;
  criteria: {
    cronListExactlyOne: { ok: boolean; reason: string };
    idMatches: { ok: boolean; reason: string };
    registryVerified: { ok: boolean; reason: string };
    anchorMatches: { ok: boolean; reason: string; evaluated: boolean };
  };
  cronExprMatch: boolean | null;
  remaining: {
    createdAt: string | null;
    remainingMs: number | null;
    remainingHours: number | null;
    critical: boolean;
    expired: boolean;
  };
  findings: string[];
}

export interface VerifyOptions {
  layer: string;
  registry: Registry | null;
  cronListRaw: string | null;
  /** 正本 prompt（extractCanonical 输出）；null = 正本缺失（判据④ 无法评估）。 */
  canonicalPrompt: string | null;
  nowMs?: number;
  staleSeconds?: number;
}

/**
 * 主判定（判据①-④ + 判据5）。纯函数，测试直接 import。
 * - registry 缺失 / 层缺失 ⇒ NOT-EVALUATED。
 * - 未提供 --cron-list ⇒ ①② 无法评估 ⇒ NOT-EVALUATED。
 * - canonicalPrompt 为 null（正本缺失）⇒ 判据④ 无法评估：若 ①②③ 已有一判为假 ⇒ VIOLATED；
 *   若 ①②③ 全真 ⇒ NOT-EVALUATED（硬规则 3b，独立取值非通过）。
 * - ①-④ 全真但剩余寿命 < 24h / 已过期 ⇒ VIOLATED（判据5 触发，report prominently）。
 */
export function checkVerify(opts: VerifyOptions): VerifyResult {
  const { layer, registry, cronListRaw, canonicalPrompt } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const staleSeconds = opts.staleSeconds ?? 7 * 24 * 60 * 60;

  const findings: string[] = [];
  const result: VerifyResult = {
    ok: false,
    code: EXIT_NOT_EVALUATED,
    layer,
    reason: "",
    criteria: {
      cronListExactlyOne: { ok: false, reason: "NOT-EVALUATED" },
      idMatches: { ok: false, reason: "NOT-EVALUATED" },
      registryVerified: { ok: false, reason: "NOT-EVALUATED" },
      anchorMatches: { ok: false, reason: "NOT-EVALUATED", evaluated: false },
    },
    cronExprMatch: null,
    remaining: {
      createdAt: null,
      remainingMs: null,
      remainingHours: null,
      critical: false,
      expired: false,
    },
    findings,
  };

  // 注册表缺失 / 层缺失 ⇒ NOT-EVALUATED（独立取值）。
  if (registry === null) {
    result.reason = "NOT-EVALUATED: 注册表缺失/不可解析（全局 per-layer ~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt）";
    result.findings.push("registry-missing");
    return result;
  }
  const rec = registry.layers?.[layer];
  if (!rec) {
    result.reason = `NOT-EVALUATED: 注册表无该层记录（layer=${layer}）`;
    result.findings.push(`registry-missing-layer:${layer}`);
    return result;
  }

  // 判据5：剩余寿命（无论核实结果如何都报——判据3：每轮必跑，不因窗口/暂停跳过）。
  const remainingMs = remainingLifetimeMs(rec.createdAt, nowMs);
  result.remaining.createdAt = rec.createdAt;
  result.remaining.remainingMs = remainingMs;
  result.remaining.remainingHours = remainingMs === null ? null : Math.floor(remainingMs / (60 * 60 * 1000));
  result.remaining.expired = remainingMs !== null && remainingMs <= 0;
  result.remaining.critical = remainingMs !== null && remainingMs < CRITICAL_REMAINING_MS;
  if (result.remaining.expired) {
    findings.push("判据5: 锚已过期（createdAt+7d 已过）——注册表收据还在，cron 应已自动删除");
  } else if (result.remaining.critical) {
    findings.push(
      `判据5: 锚剩余寿命 < 24h（剩 ${result.remaining.remainingHours}h）——CronCreate 7 天自动过期将至，需清扫重建`,
    );
  }

  // 未提供 --cron-list ⇒ ①② 无法评估 ⇒ NOT-EVALUATED（判据5 已报）。
  if (cronListRaw === null || cronListRaw === "") {
    result.reason = "NOT-EVALUATED: 未提供 --cron-list（判据①② 无法评估）";
    result.findings.push("cron-list-missing");
    result.criteria.cronListExactlyOne = { ok: false, reason: "NOT-EVALUATED: 无 --cron-list" };
    result.criteria.idMatches = { ok: false, reason: "NOT-EVALUATED: 无 --cron-list" };
    return result;
  }

  const jobs = parseCronList(cronListRaw);
  // ① CronList 恰一条。
  const c1 = cronListExactlyOne(jobs);
  result.criteria.cronListExactlyOne = c1
    ? { ok: true, reason: `CronList 恰一条（id=${jobs![0].id}）` }
    : { ok: false, reason: jobs === null ? "CronList 无法解析" : `CronList 条数=${jobs.length}（须恰一条）` };
  if (!c1) findings.push(`判据①: ${result.criteria.cronListExactlyOne.reason}`);

  // ② id == 注册表。
  const c2 = c1 && jobs !== null && jobs[0].id === rec.cronId;
  result.criteria.idMatches = c2
    ? { ok: true, reason: `id==注册表（${rec.cronId}）` }
    : {
        ok: false,
        reason: c1 ? `CronList id（${jobs![0].id}）≠ 注册表（${rec.cronId}）` : "② 依附于①（CronList 非恰一条）",
      };
  if (c1 && !c2) findings.push(`判据②: ${result.criteria.idMatches.reason}`);

  // ③ --verify registry-verified：verifiedAt 存在且新鲜。
  const vAtMs = Date.parse(rec.verifiedAt ?? "");
  const fresh = Number.isNaN(vAtMs) ? false : vAtMs <= nowMs && nowMs - vAtMs <= staleSeconds * 1000;
  result.criteria.registryVerified = fresh
    ? { ok: true, reason: `registry-verified（verifiedAt=${rec.verifiedAt}）` }
    : {
        ok: false,
        reason: Number.isNaN(vAtMs)
          ? "registry-not-verified: 缺 verifiedAt 收据"
          : vAtMs > nowMs
            ? "registry-not-verified: verifiedAt 在未来（时钟偏移）"
            : `registry-not-verified: 收据过期（verifiedAt=${rec.verifiedAt}，>${staleSeconds}s）`,
      };
  if (!fresh) findings.push(`判据③: ${result.criteria.registryVerified.reason}`);

  // ④ 锚点校验（sha256）：注册表 promptSha256 == 当前正本 prompt 的 sha256。
  let c4: boolean;
  if (canonicalPrompt === null) {
    result.criteria.anchorMatches = { ok: false, reason: "NOT-EVALUATED: 正本缺失", evaluated: false };
    // ④ 无法评估：若 ①②③ 已有一判为假 ⇒ VIOLATED（有定论）；全真 ⇒ NOT-EVALUATED（3b）。
    const c123Fail = !c1 || !c2 || !fresh;
    if (c123Fail) {
      result.ok = false;
      result.code = EXIT_VIOLATED;
      result.reason = "VIOLATED: " + (findings.length > 0 ? findings.join(" / ") : "判据④ 正本缺失");
    } else {
      result.ok = false;
      result.code = EXIT_NOT_EVALUATED;
      result.reason = "NOT-EVALUATED: ①-③ 全真，但判据④ 正本缺失（该层正本尚未落地）";
      result.findings.push("判据④: NOT-EVALUATED（正本缺失）");
    }
    return result;
  }
  const canonHash = sha256Hex(canonicalPrompt);
  c4 = canonHash === rec.promptSha256;
  result.criteria.anchorMatches = c4
    ? { ok: true, reason: `prompt sha256==正本（${canonHash.slice(0, 12)}…）`, evaluated: true }
    : { ok: false, reason: `prompt sha256（${canonHash.slice(0, 12)}…）≠ 注册表（${rec.promptSha256.slice(0, 12)}…）`, evaluated: true };
  if (!c4) findings.push(`判据④: ${result.criteria.anchorMatches.reason}`);

  // cron 表达式（信息性报告，非判据；CronList 条目可能带 schedule/interval/cron/expr 字段）。
  let cronExprMatch: boolean | null = null;
  if (c1 && jobs !== null) {
    const raw = JSON.parse(cronListRaw);
    const entry = Array.isArray(raw) ? raw[0] : raw;
    const expr =
      typeof entry?.schedule === "string" ? entry.schedule
        : typeof entry?.cron === "string" ? entry.cron
          : typeof entry?.expr === "string" ? entry.expr
            : typeof entry?.interval === "string" ? entry.interval
              : null;
    // 归一化比较（gap-a23-ticklog-verify-and-cron-normalization）：分钟字段展开成集合比集合，
    // 语义等价（`*/20` ≡ `0,20,40`）不再判漂移；真漂移（不同分钟集合/非分钟字段）仍 VIOLATED。
    cronExprMatch = expr === null ? null : cronExprsEquivalent(expr, rec.cronExpr);
    if (expr !== null && !cronExprsEquivalent(expr, rec.cronExpr)) {
      findings.push(`cron-expr-mismatch: CronList（${expr}）≠ 注册表（${rec.cronExpr}）`);
    }
  }
  result.cronExprMatch = cronExprMatch;

  // 汇总。
  const fourOk = c1 && c2 && fresh && c4;
  const fiveOk = !result.remaining.expired && !result.remaining.critical;
  if (fourOk && fiveOk && findings.length === 0) {
    result.ok = true;
    result.code = EXIT_OK;
    result.reason = "OK: 四判据全真 + 剩余寿命正常";
  } else if (fourOk && fiveOk) {
    // 只有信息性 finding（如 cron-expr-mismatch）⇒ 仍 VIOLATED（漂移要报）。
    result.ok = false;
    result.code = EXIT_VIOLATED;
    result.reason = "VIOLATED: " + findings.join(" / ");
  } else if (fourOk && !fiveOk) {
    result.ok = false;
    result.code = EXIT_VIOLATED;
    result.reason = "VIOLATED: 四判据全真，但判据5 剩余寿命预警触发";
  } else {
    result.ok = false;
    result.code = EXIT_VIOLATED;
    result.reason = "VIOLATED: " + findings.join(" / ");
  }
  return result;
}

// ── 正本 prompt 来源（默认路径）────────────────────────────────────────────────────────────────────────
// 正本相对路径来自 outer-anchor-check.ts 的 LAYERS 配置（单一来源，防漂移）：outer=
// orchestration/outer-tick-prompt.txt（整个文件去一个尾部换行）；inner=plugin/loop/fast-mode-loop-tick.md
// 的 AC80-INNER-ANCHOR 段（extractCanonical；段未落地 ⇒ null = 正本缺失）。root 在 verify worktree
// 上下文中是工作树根（与主检出同布局，path.resolve 归一化后路径一致），故查找在两种上下文都成立。
function readCanonicalPrompt(root: string, layer: string, override?: string): string | null {
  if (override) {
    if (!fs.existsSync(override)) return null;
    return extractCanonical(fs.readFileSync(override, "utf8"), layer);
  }
  const cfg = LAYERS[layer];
  if (!cfg) return null;
  const p = path.resolve(root, cfg.canonicalRel);
  if (!fs.existsSync(p)) return null;
  return extractCanonical(fs.readFileSync(p, "utf8"), layer);
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `outer-cron-registry.ts — AC81 注册表收据 + 每轮四判据核实（outer/inner 的 CronCreate 锚）
注册表位置（全局 per-layer，2026-08-17 人裁定方案②）：~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt

  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --verify \\
      --layer inner|outer [--cron-list '<json>'] [--canonical-file <path>] [--registry-base <dir>] \\
      [--root <dir>] [--stale-seconds <n>] [--json]
  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --show [--root <dir>] [--json]
  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --record \\
      --layer inner|outer --cron-id <id> --cron-expr '<expr>' [--canonical-file <path>] \\
      [--registry-base <dir>] [--root <dir>] [--json]

  --verify              核实模式：四判据（①CronList 恰一条 ②id==注册表 ③registry-verified ④prompt sha256==正本）+ 判据5（剩余寿命<24h 即报）。
  --record              记录模式：锚重建后把新收据写进该层全局注册表 + 追加审计 jsonl（AC5；替代手改 git JSON 并提交）。
  --layer <inner|outer> 选定层。
  --cron-id <id>        --record 的新 cron id（CronCreate 返回值 / CronList 活值）。
  --cron-expr <expr>    --record 的 cron 表达式（投进 CronCreate 的表达式）。
  --cron-list <json>    CronList 活视图（脚本无法调用 CronList，由调用方传入）：JSON 数组或单对象，每条含 id（id|name|cronId）。
  --canonical-file <p>  覆盖正本来源（测试接缝）。
  --registry-base <dir> 覆盖注册表基目录（测试接缝；默认 ~/.quay-global/<repo-root-slug>）。
  --root <dir>          仓库根（默认 cwd；决定 slug）。
  --stale-seconds <n>   判据③ 收据新鲜度窗口（默认 604800 = 7 天）。
  --show                打印两层注册表收据（判据1 直接可查）。
  --json                机器可读输出。

  退出码: 0=OK（四判据全真+剩余寿命正常）  1=VIOLATED（任一判据假或剩余<24h）  2=NOT-EVALUATED（无 --cron-list/注册表缺失/正本缺失）`;

interface CliArgs {
  verify: boolean;
  show: boolean;
  record: boolean;
  layer: string;
  cronId: string | null;
  cronExpr: string | null;
  cronList: string | null;
  canonicalFile: string | null;
  registryBase: string | null;
  root: string;
  staleSeconds: number;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    verify: false,
    show: false,
    record: false,
    layer: "",
    cronId: null,
    cronExpr: null,
    cronList: null,
    canonicalFile: null,
    registryBase: null,
    root: process.cwd(),
    staleSeconds: 7 * 24 * 60 * 60,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verify") out.verify = true;
    else if (a === "--show") out.show = true;
    else if (a === "--record") out.record = true;
    else if (a === "--layer") out.layer = argv[++i] ?? "";
    else if (a === "--cron-id") out.cronId = argv[++i] ?? null;
    else if (a === "--cron-expr") out.cronExpr = argv[++i] ?? null;
    else if (a === "--cron-list") out.cronList = argv[++i] ?? null;
    else if (a === "--canonical-file") out.canonicalFile = argv[++i] ?? null;
    else if (a === "--registry-base") out.registryBase = argv[++i] ?? null;
    else if (a === "--root") out.root = argv[++i] ?? out.root;
    else if (a === "--stale-seconds") out.staleSeconds = Number(argv[++i] ?? 604800);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

export function formatShow(registry: Registry | null, layer?: string): string {
  if (registry === null) return "registry-missing";
  const layers = layer ? [layer] : Object.keys(registry.layers);
  const lines: string[] = [];
  for (const l of layers) {
    const r = registry.layers?.[l];
    if (!r) {
      lines.push(`${l}: registry-missing-layer`);
      continue;
    }
    lines.push(
      `${l}: cronId=${r.cronId} cronExpr=${r.cronExpr} promptSha256=${r.promptSha256.slice(0, 16)}… createdAt=${r.createdAt} verifiedAt=${r.verifiedAt}`,
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }
  const registry = loadRegistry(args.root, args.registryBase ?? undefined);

  // --show：打印两层注册表收据（判据1 直接可查）。
  if (args.show) {
    if (args.json) {
      process.stdout.write(JSON.stringify(registry ?? { error: "registry-missing" }, null, 2) + "\n");
    } else {
      process.stdout.write(`outer-cron-registry: ${formatShow(registry)}\n`);
    }
    process.exit(registry === null ? 1 : 0);
  }

  // --record：锚重建后写/更新该层全局注册表收据 + 追加审计线（AC5）。
  if (args.record) {
    if (args.layer !== "inner" && args.layer !== "outer") {
      process.stderr.write("outer-cron-registry: --record 需 --layer inner|outer\n" + USAGE + "\n");
      process.exit(2);
    }
    const canonicalPrompt = readCanonicalPrompt(args.root, args.layer, args.canonicalFile ?? undefined);
    const rec = recordLayer(args.root, args.layer, {
      cronId: args.cronId ?? "",
      cronExpr: args.cronExpr ?? "",
      canonicalPrompt,
    }, args.registryBase ?? undefined);
    if (args.json) {
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
    } else {
      process.stdout.write(rec.ok ? `outer-cron-registry: ${rec.reason}\n` : `outer-cron-registry: ERROR — ${rec.reason}\n`);
    }
    process.exit(rec.ok ? 0 : 2);
  }

  // --verify。
  if (!args.verify) {
    process.stderr.write("outer-cron-registry: 需 --verify / --show / --record\n" + USAGE + "\n");
    process.exit(2);
  }
  if (args.layer !== "inner" && args.layer !== "outer") {
    process.stderr.write("outer-cron-registry: --layer 必须为 inner 或 outer\n" + USAGE + "\n");
    process.exit(2);
  }
  const canonicalPrompt = readCanonicalPrompt(args.root, args.layer, args.canonicalFile ?? undefined);
  const result = checkVerify({
    layer: args.layer,
    registry,
    cronListRaw: args.cronList,
    canonicalPrompt,
    staleSeconds: args.staleSeconds,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const tag = result.code === EXIT_OK ? "PASS" : result.code === EXIT_VIOLATED ? "VIOLATED" : "NOT-EVALUATED";
    process.stdout.write(`outer-cron-registry: ${tag} — ${result.reason}\n`);
    for (const c of ["cronListExactlyOne", "idMatches", "registryVerified", "anchorMatches"] as const) {
      const cr = result.criteria[c];
      process.stdout.write(`  判据 ${c}: ${cr.ok ? "真" : "假"} — ${cr.reason}\n`);
    }
    process.stdout.write(
      `  判据5 剩余寿命: ${result.remaining.remainingHours === null ? "n/a" : result.remaining.remainingHours + "h"}（createdAt=${result.remaining.createdAt}）` +
        (result.remaining.critical ? " — CRITICAL <24h，需清扫重建\n" : result.remaining.expired ? " — 已过期\n" : " — 正常\n"),
    );
  }
  process.exit(result.code);
}
