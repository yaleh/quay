#!/usr/bin/env node
// productization-verification-record.ts — AC89 writer: append ONE third-party-readable record for a
// productization verification result to the SHARED checkout's `.quay/productization-verification.jsonl`.
// (tasks/gap-ac89-productization-verification-record, "产品化验证结果落一处可机械核对的记录")
//
// AC89 目的 (manager-phase-goal.md AC85-89): AC85 (本机 build 产物) / AC86 (dist-verify 等价路径) /
// AC88 (跨主机验证) 完成后，产品化状态要写回【一处可机械核对的记录】——同 per-task-suite-records.jsonl
// 的形态（结构化 JSON 行，不是散文报告），供下次"产品化健康"检查复用。本 writer 是 AC89 的落盘侧：
// 每条验证结果 append 一行 {ts, ac, ok, artifact, evidence, detail}（按 AC 附加版本号 / run id /
// 主机 + 三项步骤字段），fail-closed on a missing/invalid field so a partial record is never written
// (硬规则 3b —— 读不懂 ≠ 合格；一个缺字段的记录会把"机制记了这次"伪装成"真的记下了").
//
// 记录必须落在 THIRD PARTIES 能读的位置 —— SHARED checkout（主检出），NOT the worktree's own
// `.quay/`（worktree 的 .quay 是 fork-inherited 副本，随 fan-in 丢弃）。shared checkout 由
// `git rev-parse --git-common-dir` 解析（与 per-task-suite-record.ts 同一 resolveSharedCheckout）。
// `--record-file` overrides for hermetic tests.
//
// 记录形状 (AC89 Plan): {ts, ac, ok, artifact, evidence, detail}
//   ts         ISO-8601 UTC —— 验证结果的时间戳（自动取 now，或 --ts 显式给）
//   ac         "AC85" | "AC86" | "AC88" —— 哪条验收的验证结果
//   ok         boolean —— 验证成功/失败（false 也必须记录 —— 一次失败的验证是合法记录）
//   artifact   验证的产物/对象（AC85: .tgz 路径；AC86: 等价路径 run id 或产物；AC88: .tgz 名）
//   evidence   可机械核对的证据位置（AC85: tar 校验证据；AC86: gh run URL；AC88: evidence JSON 路径）
//   detail     结构化细节（自由文本，机器可 grep 的 key=value 串）
// 按 AC 附加字段 (AC89 AC2/AC3/AC4 的字段要求)：
//   AC85: version   —— build 产物版本号（产物内 plugin.json version == 仓库当前 version）
//   AC86: runId     —— dist-verify 等价路径的执行 run id（gh run id）
//   AC88: host      —— 跨主机机器名（B|C）；stepInstall/stepInit/stepColdstart —— 三项布尔结果
//
// Fail-closed (硬规则 3b): missing/invalid required field exits 2 and writes NOTHING —— a partial
// record is never appended (the checker must never see a record it cannot judge as the "合格" shape).
//
// Usage:
//   node --experimental-strip-types plugin/scripts/productization-verification-record.ts
//       --ac <AC85|AC86|AC88> --ok true|false --artifact <text> --evidence <text> --detail <text>
//       [--ts <iso>] [--version <ver>] [--run-id <id>]
//       [--host <B|C>] [--step-install true|false] [--step-init true|false] [--step-coldstart true|false]
//       [--root <dir>] [--record-file <file>] [--json] [--help]
//
//   --ac                which acceptance's verification result (required: AC85|AC86|AC88)
//   --ok                true|false — verification success/failure (required)
//   --artifact          the verified artifact / object (required, non-empty)
//   --evidence          machine-checkable evidence location (required, non-empty)
//   --detail            structured free-text detail, grep-able key=value (required, non-empty)
//   --ts                ISO-8601 (default: now) — the verification's timestamp
//   --version           REQUIRED for AC85 — the build artifact's version
//   --run-id            REQUIRED for AC86 — the dist-verify equivalent-path run id
//   --host              REQUIRED for AC88 — the cross-host machine (B|C)
//   --step-install      REQUIRED for AC88 — true|false: fresh .tgz install succeeded
//   --step-init         REQUIRED for AC88 — true|false: project quay-init succeeded
//   --step-coldstart    REQUIRED for AC88 — true|false: two-layer outer+inner cold-start live
//   --root              repo root (default: cwd) — resolves the shared checkout via git common-dir
//   --record-file       override the shared-checkout record path (hermetic tests)
//   --json              machine-readable output {ok, record, file}
//   --help              this help
//
// Exit codes:
//   0  one record appended
//   2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveSharedCheckout, toIsoTimestamp } from "./per-task-suite-record.ts";

export const KNOWN_ACS = ["AC85", "AC86", "AC88"] as const;

export const REQUIRED_FIELDS = ["ts", "ac", "ok", "artifact", "evidence", "detail"] as const;

/** Build the record object from raw CLI values. Returns {record} or {error}. Missing/invalid
 *  REQUIRED field ⇒ fail-closed (error, nothing written). Per-AC required fields are enforced so a
 *  record that names an AC always carries that AC's evidence fields (硬规则 3b — a partial record
 *  must never be appended).
 *  @param {Record<string, any>} o — parsed CLI values */
export function buildRecord(o) {
  const ac = String(o.ac ?? "").trim();
  if (!KNOWN_ACS.includes(ac)) {
    return { error: `--ac must be one of ${KNOWN_ACS.join("|")} (got ${JSON.stringify(ac)})` };
  }
  let ok;
  if (o.ok != null) {
    const okS = String(o.ok).trim().toLowerCase();
    if (okS === "true") ok = true;
    else if (okS === "false") ok = false;
    else return { error: `--ok must be true|false (got ${JSON.stringify(o.ok)})` };
  } else {
    return { error: "--ok is required (true|false)" };
  }
  const artifact = String(o.artifact ?? "").trim();
  if (!artifact) return { error: "--artifact is required (non-empty)" };
  const evidence = String(o.evidence ?? "").trim();
  if (!evidence) return { error: "--evidence is required (non-empty)" };
  const detail = String(o.detail ?? "").trim();
  if (!detail) return { error: "--detail is required (non-empty)" };
  const ts = toIsoTimestamp(o.ts ?? new Date().toISOString());
  if (ts == null) return { error: `--ts must be ISO/epoch (got ${JSON.stringify(o.ts)})` };

  const record = { ts, ac, ok, artifact, evidence, detail };

  // ── per-AC required fields (AC89 AC2/AC3/AC4 的字段要求) ──────────────────────────────────────────
  if (ac === "AC85") {
    const version = String(o.version ?? "").trim();
    if (!version) return { error: "--version is required for AC85 (the build artifact's version)" };
    record.version = version;
  }
  if (ac === "AC86") {
    const runId = String(o.runId ?? "").trim();
    if (!runId) return { error: "--run-id is required for AC86 (the dist-verify equivalent-path run id)" };
    record.runId = runId;
  }
  if (ac === "AC88") {
    const host = String(o.host ?? "").trim();
    if (!host) return { error: "--host is required for AC88 (B|C — the cross-host machine)" };
    record.host = host;
    // 安装/初始化/冷启动 三项 —— AC4 的结构化字段。缺任一 ⇒ fail-closed（一个 AC88 记录必须说出
    // 三项各自的真值，否则无法机械核对"哪一步没验"）。
    for (const [flag, key] of [
      ["step-install", "stepInstall"],
      ["step-init", "stepInit"],
      ["step-coldstart", "stepColdstart"],
    ]) {
      const raw = o[key] ?? o[flag] ?? o[flag.replace("-", "")];
      if (raw == null) return { error: `--${flag} is required for AC88 (true|false)` };
      const sv = String(raw).trim().toLowerCase();
      if (sv === "true") record[key] = true;
      else if (sv === "false") record[key] = false;
      else return { error: `--${flag} must be true|false (got ${JSON.stringify(raw)})` };
    }
  }
  return { record };
}

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `productization-verification-record.ts — AC89 writer: append ONE third-party-readable record
  for a productization verification result (AC85 build / AC86 dist-verify equivalent path / AC88
  cross-host) to the SHARED checkout's .quay/productization-verification.jsonl
  ({ts, ac, ok, artifact, evidence, detail} + per-AC fields).

Usage:
  node --experimental-strip-types plugin/scripts/productization-verification-record.ts
      --ac <AC85|AC86|AC88> --ok true|false --artifact <text> --evidence <text> --detail <text>
      [--ts <iso>] [--version <ver>] [--run-id <id>]
      [--host <B|C>] [--step-install true|false] [--step-init true|false] [--step-coldstart true|false]
      [--root <dir>] [--record-file <file>] [--json] [--help]

  --ac               which acceptance's verification result (required: AC85|AC86|AC88)
  --ok               true|false — verification success/failure (required)
  --artifact         the verified artifact / object (required)
  --evidence         machine-checkable evidence location (required)
  --detail           structured free-text detail, grep-able key=value (required)
  --ts               ISO-8601 timestamp (default: now)
  --version          REQUIRED for AC85 — the build artifact's version
  --run-id           REQUIRED for AC86 — the dist-verify equivalent-path run id
  --host             REQUIRED for AC88 — the cross-host machine (B|C)
  --step-install     REQUIRED for AC88 — true|false: fresh .tgz install succeeded
  --step-init        REQUIRED for AC88 — true|false: project quay-init succeeded
  --step-coldstart   REQUIRED for AC88 — true|false: two-layer cold-start live
  --root             repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file      override the shared-checkout record path (hermetic tests)
  --json             machine-readable output {ok, record, file}
  --help             this help

Exit codes:
  0  one record appended
  2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const recordFileOverride = getArgValue(args, "--record-file");
  const asJson = args.includes("--json");

  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`productization-verification-record: ${msg}`);
    return 2;
  };

  const built = buildRecord({
    ac: getArgValue(args, "--ac"),
    ok: getArgValue(args, "--ok"),
    artifact: getArgValue(args, "--artifact"),
    evidence: getArgValue(args, "--evidence"),
    detail: getArgValue(args, "--detail"),
    ts: getArgValue(args, "--ts"),
    version: getArgValue(args, "--version"),
    runId: getArgValue(args, "--run-id"),
    host: getArgValue(args, "--host"),
    stepInstall: getArgValue(args, "--step-install"),
    stepInit: getArgValue(args, "--step-init"),
    stepColdstart: getArgValue(args, "--step-coldstart"),
  });
  if (built.error) return fail(built.error);
  const record = built.record;

  let recordFile;
  if (recordFileOverride) {
    recordFile = path.resolve(recordFileOverride);
  } else {
    const shared = resolveSharedCheckout(root);
    if (!shared) return fail(`cannot resolve the shared checkout from ${root} (git common-dir failed)`);
    recordFile = path.join(shared, ".quay", "productization-verification.jsonl");
  }

  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  fs.appendFileSync(recordFile, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });

  if (asJson) {
    console.log(JSON.stringify({ ok: true, record, file: recordFile }));
  } else {
    console.log(`productization-verification-record: appended ${record.ac} (ok=${record.ok}) → ${recordFile}`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "productization-verification-record")) {
  process.exitCode = main(process.argv);
}
