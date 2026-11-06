// goal-filing-chain-audit.ts — tasks/gap-goal-filing-chain-audit（AC-937 的读面）
//
// 回答的问题（@instrument）：「.quay/goal-filing.jsonl 里每条 `state:"filed"` 行记下的 `taskId`，
// 在 `tasks/` 里是否真的落地成了**那份**认领同一 AC 且 `status: done` 的任务？以及有没有 done
// 任务认领了本台账审到的 AC、却没有任何 filed 行指向它（预置认领探针）？」
//
// 为什么需要它（Proposal）：AC-937 的判据此前做两次**互不相干**的存在性检查——台账里有一条
// `filed` 且 `ac:"AC-937"`，以及 `tasks/` 里**任意**一份 `goal_ac: AC-937` 且 `done` 的任务。
// `filed` 行的 `taskId` 没有任何读者，两个后果都与「合格」同形（硬规则 3b）：
//   (a) 预置认领：一份事先写好的 done 任务就能让判据通过，而 driver 的立案路径从未发生；
//   (b) 挂空：`filed` 行指向的 taskId 还停在 todo（或该文件已改名/删除），只要另有任一份 done
//       任务认领同一 AC，判据照样通过。
// 本脚本把二者绑在一起：只读审计，不写任何文件、不改任务状态、不进入任何门的判据链。
//
// 判定（能取假，硬规则 3/4）：每条 `filed` 行 → 一个**枚举** verdict
//   landed             tasks/<taskId>.md 存在 ∧ 顶层 goal_ac == 行上的 ac ∧ status == "done"
//   no-task-id         行上没有非空 taskId（⛔ 与「文件没了」不同形）
//   task-missing       taskId 是字符串，但 tasks/<taskId>.md 不存在
//   goal-ac-mismatch   文件存在，但它的 goal_ac != 行上的 ac（含缺省 = 不认领）
//   not-done           文件存在且认领该 AC，但 status != "done"
// 外加 unfiled-claim：审到的 AC 下、status=done 且 id **不**被该 AC 的任何 filed 行指向的任务。
//
// 审计范围（默认 vs --ac）：
//   缺省        = 台账里出现过 filed 行的 AC 集合。⛔ 不扫全仓 done 任务的 goal_ac——本仓 427 份
//                 任务带 goal_ac，多数由台账之前的机制立案，全量比对会恒红（那是把「历史」判成
//                 「预置」）。
//   --ac <AC>   = 只用点名的 AC。此时**即使该 AC 没有 filed 行**，只要有 done 任务认领它，就是
//                 Proposal (a) 的预置认领形态 ⇒ 判 chain-broken；两者都没有 ⇒ 未评估（exit 2）。
//
// 退出码（硬规则 3b：三态必须可分）：
//   0 = 至少一条 filed 行，且**每条** filed 行 verdict=landed，且零 unfiled-claim
//   1 = 链断：任一 filed 行非 landed / 存在 unfiled-claim / 存在畸形 filed 行
//   2 = 未评估：台账读不动 / tasks 读不动 / 无匹配的终态 filed 行（且无可判的 done 认领）/
//       参数非法。⛔ 不得与 0 同形；`--json` 带 `evaluated:false` 与 `cause`（cause 区分四种）。
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/goal-filing-chain-audit.ts \
//       [--root <workspace>] [--ac <AC>]… [--json]

import path from "node:path";

import { isDirectEntry, parseArgs } from "./gate-script-base.ts";
import {
  goalFilingLedgerPath,
  readGoalFilingLedger,
  readTaskFacts,
  type GoalFilingTerminalRow,
  type TaskFact,
} from "./goal-driver.ts";

/** 一条 filed 行的枚举判决。⛔ 无「unknown」兜底值：每种不可判形态各有名字（硬规则 3b）。 */
export type FilingChainVerdict = "landed" | "no-task-id" | "task-missing" | "goal-ac-mismatch" | "not-done";

export const FILING_CHAIN_VERDICTS: readonly FilingChainVerdict[] = [
  "landed",
  "no-task-id",
  "task-missing",
  "goal-ac-mismatch",
  "not-done",
];

/** 审计过的 filed 行（一行一个 verdict）。 */
export interface AuditedFiledRow {
  requestId: string;
  ac: string;
  goal: string;
  taskId: string | null;
  filedAt: string | null;
  verdict: FilingChainVerdict;
  /** 任务文件顶层的 status；null = 该文件读不到或没有 status（只在 verdict!=task-missing 时有意义）。 */
  status: string | null;
  /** 任务文件顶层的 goal_ac；null = 该文件没写 goal_ac。 */
  taskGoalAc: string | null;
}

/** 预置认领探针的一条命中：done 任务认领该 AC，但该 AC 的 filed 行没有一条指向它。 */
export interface UnfiledClaim {
  ac: string;
  taskId: string;
}

/** 被判成「读得懂但形态不对」的 filed 行（缺 ac 之类的结构性畸形）——⛔ 不与「零 filed 行」同形。 */
export interface MalformedFiledRow {
  requestId: string;
  reason: string;
}

export type ChainVerdict = "chain-landed" | "chain-broken" | "not-evaluated";

export interface FilingChainSummary {
  filedRows: number;
  landed: number;
  noTaskId: number;
  taskMissing: number;
  goalAcMismatch: number;
  notDone: number;
  malformedFiledRows: number;
  unfiledClaims: number;
}

export interface AuditReading {
  tool: "goal-filing-chain-audit";
  root: string;
  ledger: string;
  evaluated: boolean;
  /** 未评估时**必填**的枚举原因（见下）——与 evaluated:true 互斥。 */
  cause: string | null;
  badLines: number;
  scope: { requested: string[] | null; acs: string[] };
  rows: AuditedFiledRow[];
  unfiledClaims: UnfiledClaim[];
  malformed: MalformedFiledRow[];
  summary: FilingChainSummary;
  verdict: ChainVerdict;
}

/** 未评估的 cause 词表（枚举，⛔ 自由文本）。 */
export const NOT_EVALUATED_CAUSES = [
  "invalid-ac", // 参数非法（--ac 给了空值）
  "ledger-unreadable", // 台账存在但读不动
  "ledger-lines-unparsable", // 读得动，但零条可解析行（全部坏行）
  "tasks-unreadable", // tasks/ 目录读不到
  "no-filed-rows", // 缺省模式：台账里没有任何终态 filed 行
  "no-filed-rows-and-no-done-claim", // --ac 模式：点名的 AC 既没 filed 行，也没有 done 任务认领
] as const;

export type NotEvaluatedCause = (typeof NOT_EVALUATED_CAUSES)[number];

/** 给一条 filed 行判 verdict（纯函数：输入任务事实或 null=文件不存在）。 */
export function verdictForFiledRow(
  row: Pick<GoalFilingTerminalRow, "taskId" | "ac">,
  fact: TaskFact | undefined,
): FilingChainVerdict {
  const taskId = typeof row.taskId === "string" ? row.taskId.trim() : "";
  if (taskId === "") return "no-task-id";
  if (!fact) return "task-missing";
  if (fact.goalAc !== row.ac) return "goal-ac-mismatch";
  if (fact.status !== "done") return "not-done";
  return "landed";
}

export interface AuditOptions {
  /** `--ac` 的取值；undefined = 缺省（审台账里出现过的全部 AC）。 */
  acs?: string[];
  /** 台账路径覆盖（测试缝）。缺省 `<root>/.quay/goal-filing.jsonl`。 */
  ledgerPath?: string;
}

/**
 * 只读审计一次。⛔ 不写任何文件。
 *
 * 三态：`evaluated:false` + `cause` = 没审成（⛔ 不与 chain-landed 同形）；`evaluated:true` 时
 * `verdict` 由 rows / unfiledClaims / malformed 决定。
 */
export async function auditGoalFilingChain(root: string, opts: AuditOptions = {}): Promise<AuditReading> {
  const ledger = opts.ledgerPath ?? goalFilingLedgerPath(root);
  const requested = opts.acs && opts.acs.length > 0 ? [...opts.acs] : null;

  const base: AuditReading = {
    tool: "goal-filing-chain-audit",
    root,
    ledger,
    evaluated: false,
    cause: null,
    badLines: 0,
    scope: { requested, acs: [] },
    rows: [],
    unfiledClaims: [],
    malformed: [],
    summary: {
      filedRows: 0,
      landed: 0,
      noTaskId: 0,
      taskMissing: 0,
      goalAcMismatch: 0,
      notDone: 0,
      malformedFiledRows: 0,
      unfiledClaims: 0,
    },
    verdict: "not-evaluated",
  };
  const notEvaluated = (cause: NotEvaluatedCause): AuditReading => ({ ...base, cause, verdict: "not-evaluated" });

  if (requested && requested.some((a) => a.trim() === "")) return notEvaluated("invalid-ac");

  const read = readGoalFilingLedger(ledger);
  if (!read.readable) return notEvaluated("ledger-unreadable");
  const withBadLines = { ...base, badLines: read.badLines };

  const filedRows = read.rows.filter((r): r is GoalFilingTerminalRow => r.state === "filed");
  if (filedRows.length === 0 && read.badLines > 0) {
    return { ...withBadLines, cause: "ledger-lines-unparsable", verdict: "not-evaluated" };
  }

  const facts = await readTaskFacts(root);
  if (facts === null) return { ...withBadLines, cause: "tasks-unreadable", verdict: "not-evaluated" };
  const factById = new Map(facts.map((f) => [f.id, f]));

  // ── 范围：缺省 = 台账 filed 行的 AC；--ac = 点名的 AC（可扩到台账从未立案的 AC，见文件头） ──
  const malformed: MalformedFiledRow[] = [];
  const scopedFiled: GoalFilingTerminalRow[] = [];
  for (const r of filedRows) {
    const ac = typeof r.ac === "string" ? r.ac.trim() : "";
    if (ac === "") {
      malformed.push({ requestId: String(r.requestId ?? ""), reason: "filed-row-without-ac" });
      continue;
    }
    if (requested && !requested.includes(ac)) continue;
    scopedFiled.push(r);
  }
  const acs = requested ?? [...new Set(scopedFiled.map((r) => r.ac.trim()))].sort();

  const rows: AuditedFiledRow[] = scopedFiled.map((r) => {
    const taskId = typeof r.taskId === "string" ? r.taskId.trim() : "";
    const fact = taskId === "" ? undefined : factById.get(taskId);
    return {
      requestId: String(r.requestId ?? ""),
      ac: r.ac.trim(),
      goal: String(r.goal ?? ""),
      taskId: taskId === "" ? null : taskId,
      filedAt: typeof r.at === "string" ? r.at : null,
      verdict: verdictForFiledRow(r, fact),
      status: fact ? fact.status : null,
      taskGoalAc: fact ? fact.goalAc : null,
    };
  });

  // ── 预置认领探针：done 任务认领 AC，但该 AC 的 filed 行不指向它 ────────────────────────────────
  const pointedAt = new Map<string, Set<string>>();
  for (const r of scopedFiled) {
    const ac = r.ac.trim();
    const id = typeof r.taskId === "string" ? r.taskId.trim() : "";
    if (id === "") continue;
    const set = pointedAt.get(ac) ?? new Set<string>();
    set.add(id);
    pointedAt.set(ac, set);
  }
  const scopeAcs = new Set(acs);
  const unfiledClaims: UnfiledClaim[] = [];
  for (const f of facts) {
    if (f.status !== "done" || f.goalAc === null || !scopeAcs.has(f.goalAc)) continue;
    if (pointedAt.get(f.goalAc)?.has(f.id)) continue;
    unfiledClaims.push({ ac: f.goalAc, taskId: f.id });
  }
  unfiledClaims.sort((a, b) => (a.ac === b.ac ? a.taskId.localeCompare(b.taskId) : a.ac.localeCompare(b.ac)));

  // ── 未评估的两个范围形态（⛔ 不与「审过且干净」同形） ──────────────────────────────────────────
  if (rows.length === 0 && unfiledClaims.length === 0 && malformed.length === 0) {
    return {
      ...withBadLines,
      scope: { requested, acs },
      cause: requested ? "no-filed-rows-and-no-done-claim" : "no-filed-rows",
      verdict: "not-evaluated",
    };
  }

  const summary: FilingChainSummary = {
    filedRows: rows.length,
    landed: rows.filter((r) => r.verdict === "landed").length,
    noTaskId: rows.filter((r) => r.verdict === "no-task-id").length,
    taskMissing: rows.filter((r) => r.verdict === "task-missing").length,
    goalAcMismatch: rows.filter((r) => r.verdict === "goal-ac-mismatch").length,
    notDone: rows.filter((r) => r.verdict === "not-done").length,
    malformedFiledRows: malformed.length,
    unfiledClaims: unfiledClaims.length,
  };
  const broken = summary.landed !== summary.filedRows || summary.unfiledClaims > 0 || summary.malformedFiledRows > 0;

  return {
    ...withBadLines,
    evaluated: true,
    cause: null,
    scope: { requested, acs },
    rows,
    unfiledClaims,
    malformed,
    summary,
    verdict: broken ? "chain-broken" : "chain-landed",
  };
}

/** 读数 → 退出码（0 landed / 1 broken / 2 not-evaluated）。 */
export function exitCodeFor(reading: AuditReading): number {
  if (!reading.evaluated) return 2;
  return reading.verdict === "chain-landed" ? 0 : 1;
}

const USAGE =
  "usage: goal-filing-chain-audit [--root <workspace>] [--ac <AC>]… [--json]";

function renderHuman(r: AuditReading): string {
  const lines: string[] = [];
  lines.push(`goal-filing-chain-audit — root=${r.root}`);
  lines.push(`  ledger: ${r.ledger}${r.badLines > 0 ? `  (badLines=${r.badLines})` : ""}`);
  lines.push(`  scope : ${r.scope.acs.length > 0 ? r.scope.acs.join(", ") : "(none)"}${r.scope.requested ? " (requested)" : ""}`);
  for (const row of r.rows) {
    const detail = row.verdict === "task-missing" || row.verdict === "no-task-id"
      ? ""
      : `  (status=${row.status ?? "∅"}, goal_ac=${row.taskGoalAc ?? "∅"})`;
    lines.push(`  ${row.ac}  ${row.goal}  task=${row.taskId ?? "∅"}  verdict=${row.verdict}${detail}`);
  }
  for (const m of r.malformed) lines.push(`  malformed filed row: requestId=${m.requestId} reason=${m.reason}`);
  for (const u of r.unfiledClaims) lines.push(`  unfiled-claim: ${u.ac}  task=${u.taskId}  (done task claims the AC, no filed row points at it)`);
  const s = r.summary;
  lines.push(
    `summary: filed=${s.filedRows} landed=${s.landed} task-missing=${s.taskMissing} goal-ac-mismatch=${s.goalAcMismatch} ` +
      `not-done=${s.notDone} no-task-id=${s.noTaskId} malformed=${s.malformedFiledRows} unfiled-claims=${s.unfiledClaims}`,
  );
  lines.push(`verdict: ${r.verdict}${r.evaluated ? "" : `  cause=${r.cause}`}`);
  return lines.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    usage: "[--root <workspace>] [--ac <AC>]... [--json]",
    minArgs: 0,
    flags: {
      root: { type: "string", description: "workspace root (default: cwd)" },
      ac: { type: "string[]", description: "AC to audit (repeatable; default: every AC in the ledger)" },
      json: { type: "boolean", description: "machine-readable reading" },
    },
    unknown: "reject",
    errors: "return",
    help: "return",
  });
  const json = parsed.flags.json === true || argv.includes("--json");
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.error) {
    if (json) {
      process.stdout.write(`${JSON.stringify({ tool: "goal-filing-chain-audit", evaluated: false, cause: "invalid-ac", error: parsed.error, verdict: "not-evaluated" }, null, 2)}\n`);
    } else {
      process.stderr.write(`${parsed.error}\n`);
    }
    return 2;
  }

  const root = path.resolve((parsed.flags.root as string | undefined) ?? process.cwd());
  const acs = parsed.lists?.ac ?? [];
  const reading = await auditGoalFilingChain(root, { acs });
  if (json) process.stdout.write(`${JSON.stringify(reading, null, 2)}\n`);
  else process.stdout.write(`${renderHuman(reading)}\n`);
  return exitCodeFor(reading);
}

if (isDirectEntry(import.meta, undefined, "goal-filing-chain-audit")) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
