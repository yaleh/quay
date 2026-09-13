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
// 退出码：0 = 连接+写成功（socket 无 ack，投递与否取决于对端 inbox 控制）；非 0 = 连接/读注册文件失败。


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
  const one = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
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
  } else {
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
