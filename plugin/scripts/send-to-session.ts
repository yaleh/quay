#!/usr/bin/env node
// send-to-session.ts — 基于 Claude Code 跨会话协议，从【非 Claude 进程】给一个会话发消息。
//
// 协议（2026-08-15 实测确认，Claude Code 2.1.233）：
//   第一行：{"type":"auth","token":"<peerToken>"}              ← 文档明写的 auth 帧
//   第二行：{"type":"user","message":{"role":"user","content":"<文本>"}}  ← 实测到达的消息帧
//   socket 返回 0 字节（fire-and-forget，无 ack/error）；消息以纯文本到达目标会话。
//
// gap-webui-message-delivery-entry：本脚本的 socket 协议（连接 + 写 auth/user 帧）已提炼为可 import
// 的共享模块 `packages/quay/src/serve-send.ts` 的 `sendSessionFrames`——web 发送入口（/send）与本节
// 本脚本【共用同一实现】（⛔ 不复制一份进 web 层）。本脚本继续作为独立诊断工具保留，只负责参数解析
// 与诊断输出，投递动作委托给共享模块。
//
// 用法：
//   ① 给【本会话】发（自检）：node --experimental-strip-types send-to-session.ts --self "消息"
//      用 CLAUDE_CODE_MESSAGING_SOCKET + CLAUDE_CODE_MESSAGING_TOKEN（= childToken，own-child 场景，不 hold）。
//   ② 给【别的会话】发：node --experimental-strip-types send-to-session.ts --pid <pid> "消息"
//      读 ~/.claude/sessions/<pid>.json（name↔socket）+ <pid>.*.key（peerToken）。
//      ⚠️ 用 peerToken ⇒ 对端把你当【另一个会话】。2.1.241 更正（2.1.233 时曾记「bypass 会话会 hold」，
//      跨 8 patch 行为已变）：投递不由 token 类型决定，由【接收方 settings】——permissions.defaultMode=
//      bypassPermissions 或 crossSessionInbound:accept 任一即直通，皆无则 held→expired（项目会话全带前者 ⇒ 直通）。
//      权限边界：<pid>.*.key 是 600 <user>——只挡【别的 OS 用户】，不挡【同用户的另一个会话】。
//   ③ 给【别的会话】发但【免 hold】：node --experimental-strip-types send-to-session.ts --pid <pid> --token <childToken> "消息"
//      childToken 是【目标会话】的 CLAUDE_CODE_MESSAGING_TOKEN（在该会话里 echo $CLAUDE_CODE_MESSAGING_TOKEN 取）。
//      ⇒ 对端把你当 own-child ⇒ 直接投递，不 hold（docs：own-child rules）。
//      ⚠️ childToken 是会话密钥——把它带出目标会话 = 把「以该会话身份发消息」的能力给了持有者。
//
//   ④ 【发送前】只看前置、不发送：node --experimental-strip-types send-to-session.ts --pid <pid> --precheck
//      打印一行 `hold-precheck: direct|will-hold|unknown`（exit 0）。
//   ⑤ 明知会被扣下仍要发（⛔ 唯一正当用途 = 【观察 held 结局本身】，例如 AC-205 的验证腿）：
//      `--allow-hold` ⇒ 不拒发，但前置结论仍逐字打印在 stderr 上。
//
// 退出码：0 = 连接+写成功（socket 无 ack，投递与否取决于对端 inbox 控制）；非 0 = 连接/读注册文件失败；
//         5 = 【发送前拒发】目标会话 settings 不具备免 hold 的两个键之一（见下方「发送前 HOLD 前置检测」）。
//         ⛔ 5 与 3（缺 .key）/4（连接失败）是三个【互不同形】的结局（硬规则 8：编号不复用）。


// ── 发送前 HOLD 前置检测（gap-ac205-delivery-held-unidentified-peer-sender，Req. action 2）──────────
//
// ⛔ 这【不是】送达判定，也不是已退役的 deliveryStateFor / deliverySettingsFromArgv 的复活：
//   * 送达判定的唯一真相源仍是 transcript-delivery-check.ts 的三态读数（事后读产物，
//     serve-send.ts 也只 shell-out 它，见 plugin/test/delivery-status-single-source.test.mjs）；
//   * 本函数判的是【发送前】的一个可区分前置 —— 目标会话的 settings 是否具备「免 hold」的两个键之一
//     （事前读配置）。**本函数的任何取值都不得被当成 delivered**，它只回答「照判据这次会不会被扣下」。
//
// 判据（SPEC-web-session-observability-and-control-2026-08-24.md §10.1，四样本单变量对照）：
//   接收方 settings 的 `permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound=accept`
//   任一 ⇒ 直通；两者皆无 ⇒ held→expired。cwd 已被该对照排除（同一 cwd 下两种结局都出现过）。
//   ⇒ 两个键就是判据的【直接量】；本检测读的就是它们，⛔ 不读代理量（不看 pane、不看 status 字段）。
//
// 三态（硬规则 3b：读不懂输入时，⛔ 不得返回与「合格」同形的值）：
//   direct    — 读到 ≥1 个面且命中两个键之一（evidence 里写明是哪一个面命中的）
//   will-hold — 读到 ≥1 个面，两个键都没有
//   unknown   — 一个面都读不到（/proc/<pid>/cmdline 与三个 settings 文件全部不可读）
//   ⛔ unknown ≠ direct：它只是【不拒发】（本检测是前置提示，不是投递闸的替代 —— 真值仍由
//      transcript 读取端定：held 与 absent 的区别只能在读产物时看出来）。

/** 一个「设置面」的两个键读数（⛔ 取不到 = null，不是 false —— 硬规则 6）。 */
export interface InboundFace {
  /** 该面的人类可读标签（逐字进 evidence，便于事后核对读的是哪个文件/哪段 argv）。 */
  label: string;
  defaultMode: string | null;
  crossSessionInbound: string | null;
}

export type InboundVerdict = "direct" | "will-hold" | "unknown";

export interface InboundPolicy {
  verdict: InboundVerdict;
  /** 命中证据（direct）或逐面读数（will-hold）或读不到的原因（unknown）。 */
  evidence: string[];
}

/** 从一段 settings 文本（文件内容或 `--settings` 的内联 JSON）取两个键。解析不出 ⇒ null。 */
export function inboundKeysFromSettingsText(
  text: string,
): { defaultMode: string | null; crossSessionInbound: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const perms =
    o.permissions && typeof o.permissions === "object" && !Array.isArray(o.permissions)
      ? (o.permissions as Record<string, unknown>)
      : {};
  return {
    defaultMode: typeof perms.defaultMode === "string" ? perms.defaultMode : null,
    crossSessionInbound: typeof o.crossSessionInbound === "string" ? o.crossSessionInbound : null,
  };
}

/** argv 面：`--permission-mode <v>` / `--permission-mode=<v>` 与 `--settings <v>`（v 可能是内联
 *  JSON —— 实测 worker-driver 就是这么传的 —— 也可能是文件路径）。
 *  ⚠️ 只 push【解析成功】的面：`--settings` 指向一个读不到的文件时不得记成一个「读了但没键」的面
 *  —— 那正是 gap-send-message-held-inline-settings-json 的镜像形态（把「没读到」与「没有该键」
 *  混为一谈）。读不到 ⇒ 该面缺席（全部面都缺席 ⇒ unknown，⛔ 不落成 will-hold）。 */
export function inboundFacesFromArgv(argv: string[], readFile: (p: string) => string | null): InboundFace[] {
  const faces: InboundFace[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--permission-mode" && i + 1 < argv.length) {
      faces.push({ label: "argv:--permission-mode", defaultMode: argv[i + 1], crossSessionInbound: null });
    } else if (a.startsWith("--permission-mode=")) {
      faces.push({
        label: "argv:--permission-mode",
        defaultMode: a.slice("--permission-mode=".length),
        crossSessionInbound: null,
      });
    } else if (a === "--settings" && i + 1 < argv.length) {
      const v = argv[i + 1];
      const text = v.trimStart().startsWith("{") ? v : readFile(v);
      if (text == null) continue; // 读不到 ⇒ 该面缺席（⛔ 不记成「读了、无键」）
      const k = inboundKeysFromSettingsText(text);
      if (k) faces.push({ label: "argv:--settings", ...k });
    }
  }
  return faces;
}

/** 纯判定：三个面读数 ⇒ 三态。 */
export function evaluateInboundPolicy(faces: InboundFace[]): InboundPolicy {
  const hits: string[] = [];
  for (const f of faces) {
    if (f.defaultMode === "bypassPermissions") hits.push(`${f.label}: permissions.defaultMode=bypassPermissions`);
    if (f.crossSessionInbound === "accept") hits.push(`${f.label}: crossSessionInbound=accept`);
  }
  if (hits.length > 0) return { verdict: "direct", evidence: hits };
  if (faces.length === 0) {
    return {
      verdict: "unknown",
      evidence: ["no readable settings face (/proc/<pid>/cmdline, user/project/local settings files all unreadable)"],
    };
  }
  return {
    verdict: "will-hold",
    evidence: faces.map(
      (f) => `${f.label}: defaultMode=${f.defaultMode ?? "<unset>"} crossSessionInbound=${f.crossSessionInbound ?? "<unset>"}`,
    ),
  };
}

/** 目标会话（pid）的发送前前置：argv 面（/proc/<pid>/cmdline）+ 三个 settings 文件面。
 *  `readFile` 是单测接缝（⛔ 不 spawn `ps`，也⛔ 不读 pane）。 */
export function targetInboundPolicy(
  pid: string | number,
  opts: { cwd?: string; home?: string; readFile?: (p: string) => string | null } = {},
): InboundPolicy {
  const readFile = opts.readFile ?? ((p: string) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  });
  const home = opts.home ?? os.homedir();
  const cwd = opts.cwd ?? "";
  const cmdlineRaw = readFile(`/proc/${pid}/cmdline`);
  const argv = cmdlineRaw ? cmdlineRaw.split("\0").filter(Boolean) : [];
  const faces = inboundFacesFromArgv(argv, readFile);
  const settingsPaths: Array<{ label: string; p: string }> = [
    { label: path.join(home, ".claude", "settings.json"), p: path.join(home, ".claude", "settings.json") },
  ];
  if (cwd) {
    settingsPaths.push(
      { label: path.join(cwd, ".claude", "settings.json"), p: path.join(cwd, ".claude", "settings.json") },
      { label: path.join(cwd, ".claude", "settings.local.json"), p: path.join(cwd, ".claude", "settings.local.json") },
    );
  }
  for (const s of settingsPaths) {
    const text = readFile(s.p);
    if (text == null) continue;
    const k = inboundKeysFromSettingsText(text);
    if (k) faces.push({ label: s.label, ...k });
  }
  return evaluateInboundPolicy(faces);
}


// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️ 安全边界（2026-08-15，outer 裁定相关）：本脚本的消息帧会带
//    `<cross-session-message from=… from-name=… from-mode="bypass">` 包裹——
//    `from-mode` 是【硬编码的字符串】，不是平台验证的权限模式。
//    ⇒ 对端无法区分「真的 bypass 会话发的」与「一个知道格式的脚本发的」。
//    ⇒ 这【绕过】了平台认证（SendMessage 的 from-mode 是 Claude Code 投递层验证后加的），
//       不是通过了它。outer 2026-08-15 拒绝替读另一个会话的凭据，正是这个形态
//       （CLAUDE.md §0.55「自报身份 = 无认证」）。
//    ⇒ 本脚本仅用于【owner 自己给自己的会话发消息】（own-child / 同用户另一个 shell）。
//       ⛔ 不要用于「代替 SendMessage 给别的会话发消息」——SendMessage 的价值正是平台标注身份。
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// one (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one of
// the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { flagValue } from "./gate-script-base.ts";

// 共享 socket 协议（packages/quay/src/serve-send.ts 的 sendSessionFrames）。动态 import 用相对路径
// ——与 build-evidence-gate.ts 的 `await import("../../packages/quay/src/…")` 同型（plugin 从 repo-root
// 的 packages/quay 取产品模块，相对本脚本解析，非打包期依赖）。
async function loadSendSessionFrames(): Promise<
  (opts: { sockPath: string; token: string; text: string; fromName: string }) => Promise<{ ok: boolean; reason: string | null }>
> {
  const mod = await import("../../packages/quay/src/serve-send.ts");
  return mod.sendSessionFrames;
}

// ── L2 (raw keys / control-plane) mode ────────────────────────────────────────────────────────────
// `--keys --sock <pty.sock> [--token <authToken>] [--audit <path>] "<text>"`
//
// This is the mode the cross-session MESSAGING socket cannot serve: a slash command such as `/clear`
// has no native cross-session form, and hand-rolled `tmux send-keys` is forbidden in this repo. The
// bytes go out as a pty.sock DATA frame, unmodified (control bytes included). The delivery + audit
// implementation lives in packages/quay/src/primitives/delivery-audit.mjs's `deliverKeys` (the repo's
// ONE L2 socket lane — gap-ac253-session-primitives-shared-layer-adoption retired the hand-written
// copy that used to sit in serve-send.ts's `sendKeysToSession`, which is now a thin mapping of
// deliverKeys' audit record onto this CLI's exit codes) — this script only parses argv and resolves
// paths.
//
// ⛔ The socket path is REQUIRED and never guessed: this repo has no verified pty.sock discovery
// convention, and inventing one would fabricate a fact (硬规则 6).
const args = process.argv.slice(2);
if (args.includes("--keys")) {
  /** Arity-1 adapter over the shared `flagValue`: this closure captures the local `args` slice. */
  const one = (name: string): string | undefined => flagValue(args, name);
  const sockPath = one("--sock");
  if (!sockPath) {
    console.error("⛔ --keys 需要 --sock <pty.sock>（本仓库无已验证的 pty.sock 发现约定，⛔ 不猜）");
    process.exit(2);
  }
  const authToken = one("--token") ?? "";
  const auditLogPath = one("--audit") ?? path.join(os.homedir(), ".claude", "pty-keys-audit.jsonl");
  const bytes =
    args.filter((a, i) => !a.startsWith("--") && i !== args.indexOf("--sock") + 1 &&
      i !== args.indexOf("--token") + 1 && i !== args.indexOf("--audit") + 1).join(" ") || "/clear";
  console.error(`  socket = ${sockPath}`);
  console.error(`  audit  = ${auditLogPath}`);
  console.error(`  bytes  = ${JSON.stringify(bytes)}（原样注入，含控制字节；⛔ 不自动补换行）`);
  try {
    const mod = await import("../../packages/quay/src/serve-send.ts");
    const out = await mod.sendKeysToSession({ sockPath, authToken, bytes, auditLogPath, who: `script-${process.pid}` });
    if (out.delivered) {
      console.error("  ✅ DATA 帧已写出（拒绝帧未先到）");
      process.exit(0);
    }
    console.error(`  ⛔ 未投递: ${out.error ?? "unknown"}${out.rejectedAs ? ` (rejectedAs=${out.rejectedAs})` : ""}`);
    process.exit(4);
  } catch (e) {
    console.error(`  ⛔ 共享 keys 投递模块不可用: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(4);
  }
}

const self = args.includes("--self");
const pidIdx = args.indexOf("--pid");
const tokenIdx = args.indexOf("--token");
// --precheck 只报前置、不发送；--allow-hold 明知会被扣下仍发（唯一正当用途 = 观察 held 结局本身）。
// 两者都以 `--` 开头 ⇒ 已被下面的 text 过滤排除，⛔ 不会漏进消息正文。
const precheckOnly = args.includes("--precheck");
const allowHold = args.includes("--allow-hold");
const text =
  args
    .filter((a, i) => !a.startsWith("--") && i !== pidIdx + 1 && i !== tokenIdx + 1)
    .join(" ") || "probe";

let sockPath: string, token: string;

if (self) {
  sockPath = process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? "";
  token = process.env.CLAUDE_CODE_MESSAGING_TOKEN ?? "";
  if (!sockPath || !token) {
    console.error("⛔ 本会话未注入 CLAUDE_CODE_MESSAGING_SOCKET / _TOKEN（不是 Claude Code 起的进程？）");
    process.exit(2);
  }
} else if (pidIdx !== -1) {
  const pid = args[pidIdx + 1];
  const home = os.homedir();
  const reg = JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "sessions", `${pid}.json`), "utf8"),
  );
  sockPath = reg.messagingSocketPath;
  // --token <childToken> 显式传入 ⇒ 用 childToken（own-child，免 hold）；
  // 否则读 .key 里的 peerToken（跨会话；投递由接收方 settings 决定，非 token 类型——见 2.1.241 更正）。
  if (tokenIdx !== -1) {
    token = args[tokenIdx + 1];
    console.error(`  token 来源 = --token 参数（childToken，own-child，不 hold）`);
    // ⛔ own-child 路径不做 HOLD 前置检测：文档的 own-child 规则下它不 hold（判据的两个键只约束 peerToken 路径）。
  } else {
    // ── 发送前 HOLD 前置检测（peerToken 路径独有）──────────────────────────────────────────────
    // 检测在【读 .key / 连接之前】跑：不具备两个键之一 ⇒ 以独立结局收场（exit 5），⛔ 不 exit 0 让下游去猜。
    const policy = targetInboundPolicy(pid, { cwd: typeof reg.cwd === "string" ? reg.cwd : "" });
    if (precheckOnly) {
      // 只报前置、不发送（AC-205 验证腿据此把「事前预测」与「事后结局」并排落痕）。
      // 形态固定为 `hold-precheck=<verdict>`（⛔ 无空格、无后缀），供调用方一 token 解析。
      console.log(`hold-precheck=${policy.verdict}`);
      console.error(`  evidence: ${policy.evidence.join(" | ")}`);
      process.exit(0);
    }
    if (policy.verdict === "will-hold" && !allowHold) {
      console.error(`⛔ target will HOLD (no bypassPermissions/crossSessionInbound) — 发送前拒发（exit 5）`);
      for (const e of policy.evidence) console.error(`    ${e}`);
      console.error(`    判据：SPEC-web-session-observability-and-control-2026-08-24.md §10.1（四样本单变量对照）。`);
      console.error(`    若目标是自己启动的会话，用 --token <childToken>（own-child 不 hold）；`);
      console.error(`    若【就是要观察 held 结局本身】（例如 AC-205 验证腿），加 --allow-hold。`);
      process.exit(5);
    }
    // 形态固定为 `hold-precheck=<verdict>`（⛔ 无空格、无后缀），供调用方一 token 解析。
    if (policy.verdict === "will-hold") {
      console.error(`  hold-precheck=will-hold — ⚠️ --allow-hold：仍然发送（本腿就是要观察 held 结局）`);
      for (const e of policy.evidence) console.error(`    ${e}`);
    } else if (policy.verdict === "direct") {
      console.error(`  hold-precheck=direct — ${policy.evidence.join(" | ")}`);
    } else {
      console.error(`  hold-precheck=unknown — 读不到任何设置面，⛔ 不置真，继续发（真值仍由 transcript 读取端定）`);
    }
    const keyFile = fs
      .readdirSync(path.join(home, ".claude", "sessions"))
      .find((f) => f.startsWith(`${pid}.`) && f.endsWith(".key"));
    if (!keyFile) {
      console.error(`⛔ 找不到 ${pid}.*.key（peerToken 载体）`);
      process.exit(3);
    }
    token = JSON.parse(
      fs.readFileSync(path.join(home, ".claude", "sessions", keyFile), "utf8"),
    ).peerToken;
    // ⚠️ 2.1.241 更正（2.1.233 曾记「peerToken ⇒ bypass 会话会 hold」，跨 8 patch 已变）：
    // 投递不由 token 类型决定，而由【接收方 settings】——permissions.defaultMode=bypassPermissions 或
    // crossSessionInbound:accept 任一即直通，皆无则 held→expired。项目会话全带 bypassPermissions ⇒ 25/25 直通（实测）。
    console.error(`  token 来源 = ${pid}.*.key（peerToken，跨会话）`);
    console.error(`  ⚠️ 投递由接收方 settings 决定（bypassPermissions/crossSessionInbound:accept ⇒ 直通，皆无 ⇒ held→expired），非 token 类型。`);
    console.error(`     若目标是【自己的会话】且要免 hold，请加 --token <childToken>（目标会话的 CLAUDE_CODE_MESSAGING_TOKEN）。`);
  }
  console.error(`  target = ${reg.name} (pid=${pid}, sessionId=${reg.sessionId})`);
} else {
  console.error(
    '用法：--self "msg"  或  --pid <pid> [--token <childToken>] "msg"\n' +
    '  或（L2 控制面，pty.sock 原始字节）：--keys --sock <pty.sock> [--token <authToken>] [--audit <path>] "/clear"',
  );
  process.exit(1);
}

console.error(`  socket = ${sockPath}`);
console.error(`  token  = ${token.slice(0, 8)}…（len=${token.length}）`);

// 投递动作委托给共享模块（与 web /send 入口同一实现，AC1）。诊断脚本保留自己的 from-name
// `script-<pid>`（与既有 --self 实测到达的形态一致）；from 字段由共享模块按协议写 `uds:${sockPath}`。
try {
  const sendSessionFrames = await loadSendSessionFrames();
  const result = await sendSessionFrames({
    sockPath,
    token,
    text,
    fromName: `script-${process.pid}`,
  });
  if (result.ok) {
    console.error("  ✅ 已写 auth + user 帧（带 cross-session-message 包裹）并关闭");
    process.exit(0);
  }
  console.error(`  ⛔ 连接失败: ${result.reason ?? "unknown"}`);
  process.exit(4);
} catch (e) {
  // 共享模块加载失败（packages/quay 不可用——例如打包产物剥离了源码树）：诚实报错，不伪造投递。
  console.error(`  ⛔ 共享投递模块不可用: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(4);
}
