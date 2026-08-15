// outer-cron-registry.ts — AC81 注册表收据 + 每轮四判据核实（outer + inner 两层的 CronCreate 锚）。
// (tasks/gap-ac81-registry-receipt-and-four-criteria, AC1-AC6 + DoD).
//
// 回答的问题（@instrument）：「outer/inner 的 CronCreate 锚是否有一个 git 跟踪注册表收据（cron id +
//   cron 表达式 + prompt sha256 + 创建时刻），且每轮四判据核实（① CronList 恰一条 ∧ ② id==注册表 ∧
//   ③ 收据未过期 registry-verified ∧ ④ prompt sha256==正本）能取假——并在 CronCreate 文档的
//   7 天自动过期硬上限（「Recurring tasks auto-expire after 7 days — they fire one final time,
//   then are deleted」）到来前，把锚的剩余寿命报出来？」
//
// 背景（人 2026-08-14 14:2xZ 裁定「把三层统一应用 CronCreate 加入本阶段目标和 AC，包括配套工作」）：
//   manager 已有注册表收据 + 每轮四判据核实（manager-arm-loop.sh --verify，连续 17 轮全真）。
//   AC81 把同一形态扩到 outer + inner。本模块 = 注册表收据（plugin/scripts/outer-cron-registry.json，
//   git 跟踪、可查——判据1 的载体）+ 四判据核实器（本 .ts——判据2 的载体）。
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
//       [--registry-file <path>] [--root <dir>] [--stale-seconds <n>] [--json]
//   node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts \
//       --show [--root <dir>] [--json]          # 打印两层注册表收据（判据1 直接可查）
//   --verify              必选核实模式（与 --layer 配对）。
//   --layer <inner|outer> 选定层：注册表记录 + 正本来源。
//   --cron-list <json>    CronList 活视图：JSON 数组或单对象，每条含 id（id|name|cronId）。
//   --canonical-file <p>  覆盖正本来源（fixture 接缝，测试用）。
//   --registry-file <p>   覆盖注册表收据文件（fixture 接缝，测试用）。
//   --root <dir>          仓库根（默认 cwd）。
//   --stale-seconds <n>   判据③ 收据新鲜度窗口（默认 604800 = 7 天）。
//   --json                机器可读输出。
//   --show                打印两层注册表收据并退出（无核实逻辑）。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractCanonical, LAYERS } from "./outer-anchor-check.ts";

export const EXIT_OK = 0;
export const EXIT_VIOLATED = 1;
export const EXIT_NOT_EVALUATED = 2;

/** 注册表收据文件（git 跟踪、可查；相对仓库根）。 */
export const REGISTRY_DEFAULT_REL = "plugin/scripts/outer-cron-registry.json";

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

/** 从注册表 JSON 文件读入 registry；override 为测试接缝。解析失败 ⇒ null（NOT-EVALUATED）。 */
export function loadRegistry(root: string, override?: string): Registry | null {
  const p = override ? override : path.join(root, REGISTRY_DEFAULT_REL);
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Registry;
    if (!raw || typeof raw !== "object" || !raw.layers) return null;
    return raw;
  } catch {
    return null;
  }
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
    result.reason = `NOT-EVALUATED: 注册表缺失/不可解析（${REGISTRY_DEFAULT_REL}）`;
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
    cronExprMatch = expr === null ? null : expr === rec.cronExpr;
    if (expr !== null && expr !== rec.cronExpr) {
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

  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --verify \\
      --layer inner|outer [--cron-list '<json>'] [--canonical-file <path>] [--registry-file <path>] \\
      [--root <dir>] [--stale-seconds <n>] [--json]
  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --show [--root <dir>] [--json]

  --verify              核实模式：四判据（①CronList 恰一条 ②id==注册表 ③registry-verified ④prompt sha256==正本）+ 判据5（剩余寿命<24h 即报）。
  --layer <inner|outer> 选定层。
  --cron-list <json>    CronList 活视图（脚本无法调用 CronList，由调用方传入）：JSON 数组或单对象，每条含 id（id|name|cronId）。
  --canonical-file <p>  覆盖正本来源（测试接缝）。
  --registry-file <p>   覆盖注册表收据文件（测试接缝）。
  --root <dir>          仓库根（默认 cwd）。
  --stale-seconds <n>   判据③ 收据新鲜度窗口（默认 604800 = 7 天）。
  --show                打印两层注册表收据（判据1 直接可查）。
  --json                机器可读输出。

  退出码: 0=OK（四判据全真+剩余寿命正常）  1=VIOLATED（任一判据假或剩余<24h）  2=NOT-EVALUATED（无 --cron-list/注册表缺失/正本缺失）`;

interface CliArgs {
  verify: boolean;
  show: boolean;
  layer: string;
  cronList: string | null;
  canonicalFile: string | null;
  registryFile: string | null;
  root: string;
  staleSeconds: number;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    verify: false,
    show: false,
    layer: "",
    cronList: null,
    canonicalFile: null,
    registryFile: null,
    root: process.cwd(),
    staleSeconds: 7 * 24 * 60 * 60,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verify") out.verify = true;
    else if (a === "--show") out.show = true;
    else if (a === "--layer") out.layer = argv[++i] ?? "";
    else if (a === "--cron-list") out.cronList = argv[++i] ?? null;
    else if (a === "--canonical-file") out.canonicalFile = argv[++i] ?? null;
    else if (a === "--registry-file") out.registryFile = argv[++i] ?? null;
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
  const registry = loadRegistry(args.root, args.registryFile ?? undefined);

  // --show：打印两层注册表收据（判据1 直接可查）。
  if (args.show) {
    if (args.json) {
      process.stdout.write(JSON.stringify(registry ?? { error: "registry-missing" }, null, 2) + "\n");
    } else {
      process.stdout.write(`outer-cron-registry: ${formatShow(registry)}\n`);
    }
    process.exit(registry === null ? 1 : 0);
  }

  // --verify。
  if (!args.verify) {
    process.stderr.write("outer-cron-registry: 需 --verify 或 --show\n" + USAGE + "\n");
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
