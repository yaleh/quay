#!/usr/bin/env node
// peer-identity-probe.ts — 方案 C 可行性探针：「一个非 Claude 进程如实登记为 peer，能否被平台投递」。
//
// 任务：tasks/gap-quay-server-lightweight-peer-identity-spike.md（本文件是该任务 Plan 2 的产物）
//
// ⛔ 本进程【不是】Claude Code 会话，也【不假装是】：纯 Node、无 LLM 循环、⛔ 不 spawn claude。
//    它的做法是把【关于真实进程的真实事实】写进 `~/.claude/sessions/<pid>.json`：
//    pid / procStart（/proc/<pid>/stat 第 22 字段）/ pidDomain（本机 machine-id）/ cwd / startedAt /
//    messagingSocketPath（真的在监听的 socket）—— 这些不需要伪造，如实填即可。
//    自述性字段（agent / kind / version / peerProtocol / peerFeatures / name）里，`agent` 默认填
//    `"quay"`（⛔ 不是 `"claude"`）——诚实性边界见任务 AC5。
//
// 与 plugin/scripts/send-to-session.ts 的区别（任务 Proposal 的「诚实性边界」一节）：
//   那条管【发送侧冒充】（脚本自称是某个 bypass 会话发的，from-mode 是硬编码字符串）——继续禁止。
//   本探针管【接收侧登记】（一个真实进程如实登记自己的 pid/socket，声明「我可以收消息」）——是被投递方。
//
// 用法（`--help`）：
//   serve       启动探针：监听 unix socket + 登记自己的记录；逐帧落盘证据
//   patch       改写【本探针自己】的记录（AC4 逐字段剥离/改值实测用；只动自己 pid 的文件）
//   shutdown    让一个在跑的探针优雅退出（清理记录 + socket）
//   cleanup     清掉本脚本遗留的记录/key/socket（只认带本脚本标记的记录）
//
// 退出码：0 = 正常；1 = 参数错；2 = 环境不满足（如 socket 目录不可写）；3 = 目标不存在。

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ── 常量 ──────────────────────────────────────────────────────────────────────────────────────────

/** 写进记录里的标记 —— cleanup 只认它名下的文件（⛔ 绝不按「pid 看起来像探针」猜）。 */
export const PROBE_MARKER = "__quayProbe";
export const PROBE_MARKER_VALUE = "peer-identity-probe";

/** 默认 socket 目录（与本机真实会话同目录，路径形态与真实记录一致）。 */
export const DEFAULT_SOCK_DIR = path.join(
  process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`,
  "cc-socks",
);

export const DEFAULT_EVIDENCE = ".quay/peer-identity-probe-evidence.jsonl";
export const DEFAULT_AGENT = "quay";
export const DEFAULT_NAME_PREFIX = "quay-server";

// ── 纯函数区（单测对象：plugin/test/peer-identity-probe.test.mjs） ─────────────────────────────────

/** 把 /proc/<pid>/stat 的内容解析成 procStart（第 22 字段）。解析不出 ⇒ null（⛔ 不编一个数）。 */
export function parseProcStart(statContent: string): string | null {
  if (typeof statContent !== "string") return null;
  // 进程名可能含空格/括号 ⇒ 按【最后一个 ')'】之后切分，字段从 state(第3字段) 起算。
  const close = statContent.lastIndexOf(")");
  if (close < 0) return null;
  const rest = statContent.slice(close + 1).trim();
  if (!rest) return null;
  const fields = rest.split(/\s+/);
  // rest[0] = state(字段3) ⇒ starttime(字段22) = rest[22 - 3] = rest[19]
  const v = fields[19];
  if (!v || !/^\d+$/.test(v)) return null;
  return v;
}

/** pidDomain 的形态（实测本机真实会话）：`linux:<machine-id>:pid:[<pid-ns inode>]`。 */
export function buildPidDomain(machineId: string, pidNamespaceInode: string): string {
  return `linux:${machineId}:pid:[${pidNamespaceInode}]`;
}

/** 从 /proc/self/ns/pid 的 link 目标（`pid:[4026531836]`）取命名空间号；取不到 ⇒ null。 */
export function parsePidNamespaceLink(linkTarget: string): string | null {
  const m = /^pid:\[(\d+)\]$/.exec((linkTarget ?? "").trim());
  return m ? m[1] : null;
}

/** 生成 32 hex 的 peerToken（与真实 `<pid>.*.key` 的 peerToken 同长度/同字符集）。 */
export function generatePeerToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** 生成 key 文件名里的 64 hex 段（真实文件名形态：`<pid>.<64hex>.key`）。 */
export function generateKeyFileId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface ProbeFacts {
  pid: number;
  /** 探针进程的真实启动时刻（procStart，字符串）。 */
  procStart: string;
  /** 本机身份域。 */
  pidDomain: string;
  /** 探针进程的真实 cwd。 */
  cwd: string;
  /** 探针进程的真实启动墙钟（ms）。 */
  startedAtMs: number;
  /** 真的在监听的 unix socket 绝对路径。 */
  sockPath: string;
  /** 探针自报的版本（quay 侧版本，⛔ 不冒充 Claude Code 版本时用 quayVersion 字段）。 */
  version: string;
  /** 本机 Claude Code 版本（如实记录「当下协议是哪一版」的读数）。 */
  ccVersion: string;
}

export interface RecordOpts {
  agent?: string | null;
  name?: string | null;
  kind?: string | null;
  sessionId?: string | null;
  /** 需要【剥离】的字段名（AC4 逐字段剥离实测）。 */
  omit?: string[];
  /** 需要【改值】的字段：字段名 → 值（值已是 JSON 可序列化形态；字符串 `__DELETE__` 表示剥离）。 */
  set?: Record<string, unknown>;
}

/**
 * 构造注册记录（纯函数——AC4 的逐字段剥离/改值全部经此，⛔ 不是散在各处的 mutate）。
 * 默认值都为【关于真实进程的真实事实】；`agent` 默认为 `"quay"`（诚实标注，⛔ 不是 `"claude"`）。
 */
export function buildSessionRecord(facts: ProbeFacts, opts: RecordOpts = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    pid: facts.pid,
    sessionId: opts.sessionId ?? crypto.randomUUID(),
    cwd: facts.cwd,
    startedAt: facts.startedAtMs,
    procStart: facts.procStart,
    version: facts.ccVersion,          // 本机 Claude Code 版本（协议版本读数）
    peerProtocol: 1,
    peerFeatures: ["notify_idle", "reply_across_default_dirs", "artifact_yield"],
    kind: opts.kind ?? "bg",
    entrypoint: "quay-peer-probe",
    pidDomain: facts.pidDomain,
    messagingSocketPath: facts.sockPath,
    name: opts.name === undefined ? `${DEFAULT_NAME_PREFIX}-${facts.pid}` : opts.name,
    nameSince: facts.startedAtMs,
    agent: opts.agent === undefined ? DEFAULT_AGENT : opts.agent,
    status: "idle",
    updatedAt: Date.now(),
    statusUpdatedAt: facts.startedAtMs,
    // 本脚本自己加的标记 —— cleanup 靠它，⛔ 不靠文件名/pid 猜。
    [PROBE_MARKER]: PROBE_MARKER_VALUE,
  };
  // 剥离：字段值置为 undefined ⇒ JSON.stringify 自然省略该键。
  for (const k of opts.omit ?? []) base[k] = undefined;
  for (const [k, v] of Object.entries(opts.set ?? {})) {
    if (v === "__DELETE__") base[k] = undefined;
    else base[k] = v;
  }
  return base;
}

/** 构造 `<pid>.<64hex>.key` 的内容。`tokenOverride` 用于 AC2 的「token 不一致」负控制。 */
export function buildKeyRecord(facts: ProbeFacts, token: string): Record<string, unknown> {
  return { peerToken: token, procStart: facts.procStart, pidDomain: facts.pidDomain };
}

/** 帧切分：返回完整行 + 余量（socket 的 data 事件不保证按行到达）。 */
export function splitFrames(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim().length > 0), rest };
}

/** 解析一帧：JSON 化成功 ⇒ 对象；失败 ⇒ null（⛔ 不把不可解析的帧当成 auth 失败而静默吞掉）。 */
export function parseFrame(line: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(line);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 校验 auth 帧：type==="auth" ∧ token 与探针当前校验值一致。返回 'ok' / 'mismatch' / 'not-auth'。 */
export function verifyAuthFrame(line: string, expectedToken: string): "ok" | "mismatch" | "not-auth" {
  const f = parseFrame(line);
  if (!f || f.type !== "auth") return "not-auth";
  return f.token === expectedToken ? "ok" : "mismatch";
}

/**
 * 从 user 帧里取消息正文（平台投递的包裹为 `<cross-session-message from=… …>`）。
 * 取不到 ⇒ null（⛔ 不返回空串，空串与「消息为空」同形）。
 */
export function extractMessageText(line: string): string | null {
  const f = parseFrame(line);
  if (!f || f.type !== "user") return null;
  const msg = f.message;
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const content = (msg as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

/**
 * 从包裹文本里抽出 `<cross-session-message …>` 的属性（AC1 要求抄进报告的「实际到达的属性值」）。
 * 纯字符串解析（⛔ 不对 package 做语义假设——属性原文按字节抄）。
 */
export function extractWrapperAttrs(content: string): Record<string, string> {
  const m = /<cross-session-message\b([^>]*)>/.exec(content ?? "");
  if (!m) return {};
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let g: RegExpExecArray | null;
  while ((g = re.exec(m[1])) !== null) attrs[g[1]] = g[2];
  return attrs;
}

/**
 * AC6 安全闸：判断某个文件名是否【属于本探针 pid】。只允许动自己的记录/key。
 * 命中 `cleanup` 时【还】要求内容是本脚本写的（带 marker）——⛔ 不能因为「pid 像探针」就删别人的。
 */
export function isOwnRegistryFile(fileName: string, pid: number): boolean {
  const base = fileName.replace(/\.key$/, "");
  const pidPart = base.split(".")[0];
  return pidPart === String(pid);
}

/** cleanup 的判定：文件属于本 pid ⇒ 无论如何删（拆自己的）；否则必须带 marker 才删（防误删）。 */
export function shouldCleanupFile(fileName: string, content: string | null, pid: number): boolean {
  if (isOwnRegistryFile(fileName, pid)) return true;
  if (fileName.endsWith(".key")) return false; // 别人的 key：永不碰（无 marker 可言）
  if (content == null) return false;
  const f = parseFrame(content);
  return !!f && f[PROBE_MARKER] === PROBE_MARKER_VALUE;
}

/** 证据行构造（每帧一行 JSON，含该轮 label，便于按轮过滤）。 */
export function buildEvidenceEntry(
  label: string,
  kind: string,
  payload: Record<string, unknown>,
  nowMs: number = Date.now(),
): Record<string, unknown> {
  return { ts: new Date(nowMs).toISOString(), tsMs: nowMs, label, kind, ...payload };
}

// ── 进程事实读取（注入 fs 便于单测） ──────────────────────────────────────────────────────────────

export interface FactIo {
  /** 必须带 utf8 —— 不带则返回 Buffer，`parseProcStart` 的 typeof 检查会把它读成「取不到」（实测踩过）。 */
  readFileSync: (p: string, enc: string) => string;
  readlinkSync: (p: string) => string;
}

export function readProcStart(pid: number, io: FactIo = fs as unknown as FactIo): string | null {
  try {
    return parseProcStart(io.readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

export function readPidDomain(io: FactIo = fs as unknown as FactIo): string | null {
  let machineId: string;
  try {
    machineId = io.readFileSync("/etc/machine-id", "utf8").trim();
  } catch {
    return null;
  }
  let inode: string | null;
  try {
    inode = parsePidNamespaceLink(io.readlinkSync("/proc/self/ns/pid"));
  } catch {
    inode = null;
  }
  if (!machineId || !inode) return null;
  return buildPidDomain(machineId, inode);
}

/** 本机 Claude Code 版本（取 versions 目录里最高版本；⛔ 读不到就如实 null，不编）。 */
export function detectCcVersion(home: string = os.homedir()): string | null {
  try {
    const dir = path.join(home, ".local", "share", "claude", "versions");
    const vs = fs.readdirSync(dir).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
    if (vs.length === 0) return null;
    vs.sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    });
    return vs[vs.length - 1];
  } catch {
    return null;
  }
}

// ── 证据落盘 ──────────────────────────────────────────────────────────────────────────────────────

export function appendEvidence(evidencePath: string, entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.appendFileSync(evidencePath, JSON.stringify(entry) + "\n");
  } catch {
    // best-effort：证据落盘失败绝不能杀掉探针（否则「探针还在跑」这个事实会随证据一起消失）
  }
}

// ── serve：注册 + 监听 + 逐帧落盘 ─────────────────────────────────────────────────────────────────

interface ServeOpts {
  registryDir: string;
  sockPath: string;
  evidencePath: string;
  label: string;
  agent: string | null | undefined;
  name: string | null | undefined;
  kind: string | null | undefined;
  omit: string[];
  set: Record<string, unknown>;
  register: boolean;
  writeKey: boolean;
  token: string;
  keyFileId: string;
}

function keyFilePath(registryDir: string, pid: number, id: string): string {
  return path.join(registryDir, `${pid}.${id}.key`);
}

function serve(opts: ServeOpts): void {
  const pid = process.pid;
  const procStart = readProcStart(pid);
  const pidDomain = readPidDomain();
  if (procStart == null || pidDomain == null) {
    console.error(`⛔ 无法读取本进程的真实身份事实（procStart=${procStart} pidDomain=${pidDomain}）——不伪造，退出`);
    process.exit(2);
  }
  const facts: ProbeFacts = {
    pid,
    procStart,
    pidDomain,
    cwd: process.cwd(),
    startedAtMs: Date.now(),
    sockPath: opts.sockPath,
    version: "probe",
    ccVersion: detectCcVersion() ?? "unknown",
  };

  const recordPath = path.join(opts.registryDir, `${pid}.json`);
  const kPath = keyFilePath(opts.registryDir, pid, opts.keyFileId);

  const cleanup = (): void => {
    try {
      if (fs.existsSync(recordPath)) fs.unlinkSync(recordPath);
    } catch { /* ignore */ }
    try {
      if (fs.existsSync(kPath)) fs.unlinkSync(kPath);
    } catch { /* ignore */ }
    try {
      if (fs.existsSync(opts.sockPath)) fs.unlinkSync(opts.sockPath);
    } catch { /* ignore */ }
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "cleanup", {
      pid, removed: [recordPath, kPath, opts.sockPath],
    }));
  };

  // 记录：注册（AC2 的「删除记录」扰动由外部删除，不由本进程模拟）
  if (opts.register) {
    fs.mkdirSync(opts.registryDir, { recursive: true });
    const record = buildSessionRecord(facts, {
      agent: opts.agent,
      name: opts.name,
      kind: opts.kind,
      omit: opts.omit,
      set: opts.set,
    });
    fs.writeFileSync(recordPath, JSON.stringify(record));
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "register-record", {
      path: recordPath, record,
    }));
  }
  if (opts.writeKey) {
    fs.writeFileSync(kPath, JSON.stringify(buildKeyRecord(facts, opts.token)), { mode: 0o600 });
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "register-key", {
      path: kPath, peerTokenLen: opts.token.length, procStart, pidDomain,
    }));
  }

  // 监听 socket（先清残留，避免 EADDRINUSE 把「上次没清干净」伪装成「平台拒绝连接」）
  try {
    fs.mkdirSync(path.dirname(opts.sockPath), { recursive: true });
    if (fs.existsSync(opts.sockPath)) fs.unlinkSync(opts.sockPath);
  } catch { /* ignore */ }

  let connSeq = 0;
  const server = net.createServer((sock) => {
    connSeq += 1;
    const connId = connSeq;
    let buf = "";
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "connect", { connId }));

    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const { lines, rest } = splitFrames(buf);
      buf = rest;
      for (const line of lines) {
        const parsed = parseFrame(line);
        const authVerdict = verifyAuthFrame(line, opts.token);
        const wrapper = extractWrapperAttrs(extractMessageText(line) ?? "");
        appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "frame", {
          connId,
          rawLine: line,                       // ⛔ 原始字节（AC1 要求核对「实际到达的属性值」）
          parsed,
          authVerdict,
          wrapperAttrs: Object.keys(wrapper).length > 0 ? wrapper : undefined,
        }));
      }
    });
    sock.on("end", () => {
      appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "end", { connId }));
    });
    sock.on("error", (e: Error) => {
      appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "sock-error", { connId, error: e.message }));
    });
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "listen-error", { error: e.message, code: e.code }));
    console.error(`⛔ 监听失败: ${e.message}`);
    cleanup();
    process.exit(2);
  });

  server.listen(opts.sockPath, () => {
    // 让平台能连上（真实会话的 socket 是 600）；chmod 需在 listen 之后
    try { fs.chmodSync(opts.sockPath, 0o600); } catch { /* ignore */ }
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "listening", {
      sockPath: opts.sockPath, pid, recordPath, keyPath: kPath,
    }));
    // 机器可读的一行 stdout：调用方据此取 pid/name/sock（⛔ 不靠解析人类输出）
    process.stdout.write(JSON.stringify({
      probe: "peer-identity-probe", status: "listening", pid,
      name: opts.name === undefined ? `${DEFAULT_NAME_PREFIX}-${pid}` : opts.name,
      agent: opts.agent === undefined ? DEFAULT_AGENT : opts.agent,
      sockPath: opts.sockPath, recordPath, keyPath: kPath, evidencePath: opts.evidencePath, label: opts.label,
    }) + "\n");
  });

  const bye = (): void => { try { server.close(); } catch { /* ignore */ } cleanup(); process.exit(0); };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
  process.on("uncaughtException", (e) => {
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "uncaught", { error: String(e) }));
    bye();
  });
}

// ── patch / shutdown / cleanup ────────────────────────────────────────────────────────────────────

function registryDirOf(home: string): string {
  return path.join(home, ".claude", "sessions");
}

/** 只改【本探针自己】的记录（pid 必须与自己一致，且记录带 marker）。 */
function patchRecord(pid: number, omit: string[], set: Record<string, unknown>): void {
  const dir = registryDirOf(os.homedir());
  const p = path.join(dir, `${pid}.json`);
  const raw = fs.readFileSync(p, "utf8");
  const rec = JSON.parse(raw) as Record<string, unknown>;
  if (rec[PROBE_MARKER] !== PROBE_MARKER_VALUE) {
    console.error(`⛔ ${p} 不带本探针标记——拒绝改写（⛔ 不碰非本探针的记录）`);
    process.exit(3);
  }
  for (const k of omit) delete rec[k];
  for (const [k, v] of Object.entries(set)) {
    if (v === "__DELETE__") delete rec[k];
    else rec[k] = v;
  }
  rec.updatedAt = Date.now();
  fs.writeFileSync(p, JSON.stringify(rec));
  console.error(`✅ patched ${p}（omit=${omit.join(",") || "-"} set=${Object.keys(set).join(",") || "-"}）`);
}

/** 清理：只删【属于本 pid】的或【带本脚本 marker】的（AC6 的共享状态安全闸）。 */
function cleanupAll(): void {
  const dir = registryDirOf(os.homedir());
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { console.error("（无注册目录）"); return; }
  const removed: string[] = [];
  const skipped: string[] = [];
  for (const f of entries) {
    if (!f.endsWith(".json") && !f.endsWith(".key")) continue;
    const p = path.join(dir, f);
    let content: string | null = null;
    try { content = fs.readFileSync(p, "utf8"); } catch { content = null; }
    if (shouldCleanupFile(f, content, -1)) {
      try { fs.unlinkSync(p); removed.push(f); } catch { /* ignore */ }
    } else {
      skipped.push(f);
    }
  }
  console.log(JSON.stringify({ removed, skipped }, null, 2));
}

function shutdown(pid: number): void {
  const dir = registryDirOf(os.homedir());
  const p = path.join(dir, `${pid}.json`);
  let rec: Record<string, unknown>;
  try { rec = JSON.parse(fs.readFileSync(p, "utf8")); } catch {
    console.error(`⛔ 读不到 ${p}`);
    process.exit(3);
  }
  if (rec[PROBE_MARKER] !== PROBE_MARKER_VALUE) {
    console.error(`⛔ ${p} 不是本探针的记录——拒绝（⛔ 不 kill 别的会话）`);
    process.exit(3);
  }
  const target = Number(rec.pid);
  // 只发 SIGTERM，由探针自己的信号处理做清理（⛔ 不替它删文件——那样就测不到「探针自己清理」）
  try { process.kill(target, "SIGTERM"); } catch (e) {
    console.error(`⛔ kill(${target}) 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(JSON.stringify({ signalled: target }));
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cmd: string; flags: Map<string, string[]> } {
  const cmd = argv[0] ?? "";
  const flags = new Map<string, string[]>();
  let cur: string | null = null;
  for (const a of argv.slice(1)) {
    if (a.startsWith("--")) { cur = a.slice(2); if (!flags.has(cur)) flags.set(cur, []); }
    else if (cur) flags.get(cur)!.push(a);
  }
  return { cmd, flags };
}

const USAGE = `usage:
  peer-identity-probe.ts serve   [--agent X] [--name X] [--kind X] [--omit a,b] [--set k=json]
                                 [--no-register] [--no-key] [--token HEX] [--sock PATH]
                                 [--evidence PATH] [--label L] [--registry DIR]
  peer-identity-probe.ts patch   --pid N [--omit a,b] [--set k=json]
  peer-identity-probe.ts shutdown --pid N
  peer-identity-probe.ts cleanup`;

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  const { cmd, flags } = parseArgs(argv);
  const one = (k: string): string | undefined => flags.get(k)?.[0];
  const parseSet = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const s of flags.get("set") ?? []) {
      const eq = s.indexOf("=");
      if (eq < 0) continue;
      const k = s.slice(0, eq);
      const v = s.slice(eq + 1);
      if (v === "__DELETE__") out[k] = "__DELETE__";
      else { try { out[k] = JSON.parse(v); } catch { out[k] = v; } }
    }
    return out;
  };
  const pidOf = (): number => {
    const n = Number(one("pid"));
    if (!Number.isInteger(n) || n <= 0) { console.error(USAGE); process.exit(1); }
    return n;
  };

  switch (cmd) {
    case "serve": {
      const pid = process.pid;
      const evidencePath = path.resolve(one("evidence") ?? DEFAULT_EVIDENCE);
      const sockPath = one("sock") ?? path.join(one("sockdir") ?? DEFAULT_SOCK_DIR, `${pid}.sock`);
      serve({
        registryDir: one("registry") ?? registryDirOf(os.homedir()),
        sockPath,
        evidencePath,
        label: one("label") ?? `run-${pid}`,
        agent: flags.has("agent") ? (one("agent") ?? "") : undefined,
        name: flags.has("name") ? (one("name") ?? "") : undefined,
        kind: flags.has("kind") ? (one("kind") ?? "") : undefined,
        omit: (one("omit") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        set: parseSet(),
        register: !flags.has("no-register"),
        writeKey: !flags.has("no-key"),
        token: one("token") ?? generatePeerToken(),
        keyFileId: one("keyid") ?? generateKeyFileId(),
      });
      break;
    }
    case "patch":
      patchRecord(pidOf(), (one("omit") ?? "").split(",").map((s) => s.trim()).filter(Boolean), parseSet());
      break;
    case "shutdown":
      shutdown(pidOf());
      break;
    case "cleanup":
      cleanupAll();
      break;
    default:
      console.error(USAGE);
      process.exit(1);
  }
}

const isDirect = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try { return path.resolve(a1) === path.resolve(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isDirect) main();
