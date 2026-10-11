#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/peer-identity-probe.ts
import fs2 from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// packages/quay/src/primitives/session-liveness.mjs
import fs from "node:fs";
function readProcStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeIdx = raw.lastIndexOf(")");
    if (closeIdx === -1) return null;
    const rest = raw.slice(closeIdx + 2).trim().split(/\s+/);
    const starttime = rest[19];
    return starttime !== void 0 ? { starttime } : null;
  } catch {
    return null;
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/peer-identity-probe.ts
var PROBE_MARKER = "__quayProbe";
var PROBE_MARKER_VALUE = "peer-identity-probe";
var DEFAULT_SOCK_DIR = path.join(
  process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1e3}`,
  "cc-socks"
);
var DEFAULT_EVIDENCE = ".quay/peer-identity-probe-evidence.jsonl";
var DEFAULT_AGENT = "quay";
var DEFAULT_NAME_PREFIX = "quay-server";
function parseProcStart(statContent) {
  if (typeof statContent !== "string") return null;
  const close = statContent.lastIndexOf(")");
  if (close < 0) return null;
  const rest = statContent.slice(close + 1).trim();
  if (!rest) return null;
  const fields = rest.split(/\s+/);
  const v = fields[19];
  if (!v || !/^\d+$/.test(v)) return null;
  return v;
}
function buildPidDomain(machineId, pidNamespaceInode) {
  return `linux:${machineId}:pid:[${pidNamespaceInode}]`;
}
function parsePidNamespaceLink(linkTarget) {
  const m = /^pid:\[(\d+)\]$/.exec((linkTarget ?? "").trim());
  return m ? m[1] : null;
}
function generatePeerToken() {
  return crypto.randomBytes(16).toString("hex");
}
function generateKeyFileId() {
  return crypto.randomBytes(32).toString("hex");
}
function buildSessionRecord(facts, opts = {}) {
  const base = {
    pid: facts.pid,
    sessionId: opts.sessionId ?? crypto.randomUUID(),
    cwd: facts.cwd,
    startedAt: facts.startedAtMs,
    procStart: facts.procStart,
    version: facts.ccVersion,
    // 本机 Claude Code 版本（协议版本读数）
    peerProtocol: 1,
    peerFeatures: ["notify_idle", "reply_across_default_dirs", "artifact_yield"],
    kind: opts.kind ?? "bg",
    entrypoint: "quay-peer-probe",
    pidDomain: facts.pidDomain,
    messagingSocketPath: facts.sockPath,
    name: opts.name === void 0 ? `${DEFAULT_NAME_PREFIX}-${facts.pid}` : opts.name,
    nameSince: facts.startedAtMs,
    agent: opts.agent === void 0 ? DEFAULT_AGENT : opts.agent,
    status: "idle",
    updatedAt: Date.now(),
    statusUpdatedAt: facts.startedAtMs,
    // 本脚本自己加的标记 —— cleanup 靠它，⛔ 不靠文件名/pid 猜。
    [PROBE_MARKER]: PROBE_MARKER_VALUE
  };
  for (const k of opts.omit ?? []) base[k] = void 0;
  for (const [k, v] of Object.entries(opts.set ?? {})) {
    if (v === "__DELETE__") base[k] = void 0;
    else base[k] = v;
  }
  return base;
}
function buildKeyRecord(facts, token) {
  return { peerToken: token, procStart: facts.procStart, pidDomain: facts.pidDomain };
}
function splitFrames(buffer) {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim().length > 0), rest };
}
function parseFrame(line) {
  try {
    const o = JSON.parse(line);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}
function verifyAuthFrame(line, expectedToken) {
  const f = parseFrame(line);
  if (!f || f.type !== "auth") return "not-auth";
  return f.token === expectedToken ? "ok" : "mismatch";
}
function extractMessageText(line) {
  const f = parseFrame(line);
  if (!f || f.type !== "user") return null;
  const msg = f.message;
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const content = msg.content;
  return typeof content === "string" ? content : null;
}
function extractWrapperAttrs(content) {
  const m = /<cross-session-message\b([^>]*)>/.exec(content ?? "");
  if (!m) return {};
  const attrs = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let g;
  while ((g = re.exec(m[1])) !== null) attrs[g[1]] = g[2];
  return attrs;
}
function isOwnRegistryFile(fileName, pid) {
  const base = fileName.replace(/\.key$/, "");
  const pidPart = base.split(".")[0];
  return pidPart === String(pid);
}
function shouldCleanupFile(fileName, content, pid) {
  if (isOwnRegistryFile(fileName, pid)) return true;
  if (fileName.endsWith(".key")) return false;
  if (content == null) return false;
  const f = parseFrame(content);
  return !!f && f[PROBE_MARKER] === PROBE_MARKER_VALUE;
}
function buildEvidenceEntry(label, kind, payload, nowMs = Date.now()) {
  return { ts: new Date(nowMs).toISOString(), tsMs: nowMs, label, kind, ...payload };
}
function readProcStart(pid, io = fs2) {
  if (io === fs2) {
    return readProcStat(pid)?.starttime ?? null;
  }
  try {
    return parseProcStart(io.readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}
function readPidDomain(io = fs2) {
  let machineId;
  try {
    machineId = io.readFileSync("/etc/machine-id", "utf8").trim();
  } catch {
    return null;
  }
  let inode;
  try {
    inode = parsePidNamespaceLink(io.readlinkSync("/proc/self/ns/pid"));
  } catch {
    inode = null;
  }
  if (!machineId || !inode) return null;
  return buildPidDomain(machineId, inode);
}
function detectCcVersion(home = os.homedir()) {
  try {
    const dir = path.join(home, ".local", "share", "claude", "versions");
    const vs = fs2.readdirSync(dir).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
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
function appendEvidence(evidencePath, entry) {
  try {
    fs2.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs2.appendFileSync(evidencePath, JSON.stringify(entry) + "\n");
  } catch {
  }
}
function keyFilePath(registryDir, pid, id) {
  return path.join(registryDir, `${pid}.${id}.key`);
}
function serve(opts) {
  const pid = process.pid;
  const procStart = readProcStart(pid);
  const pidDomain = readPidDomain();
  if (procStart == null || pidDomain == null) {
    console.error(`\u26D4 \u65E0\u6CD5\u8BFB\u53D6\u672C\u8FDB\u7A0B\u7684\u771F\u5B9E\u8EAB\u4EFD\u4E8B\u5B9E\uFF08procStart=${procStart} pidDomain=${pidDomain}\uFF09\u2014\u2014\u4E0D\u4F2A\u9020\uFF0C\u9000\u51FA`);
    process.exit(2);
  }
  const facts = {
    pid,
    procStart,
    pidDomain,
    cwd: process.cwd(),
    startedAtMs: Date.now(),
    sockPath: opts.sockPath,
    version: "probe",
    ccVersion: detectCcVersion() ?? "unknown"
  };
  const recordPath = path.join(opts.registryDir, `${pid}.json`);
  const kPath = keyFilePath(opts.registryDir, pid, opts.keyFileId);
  const cleanup = () => {
    try {
      if (fs2.existsSync(recordPath)) fs2.unlinkSync(recordPath);
    } catch {
    }
    try {
      if (fs2.existsSync(kPath)) fs2.unlinkSync(kPath);
    } catch {
    }
    try {
      if (fs2.existsSync(opts.sockPath)) fs2.unlinkSync(opts.sockPath);
    } catch {
    }
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "cleanup", {
      pid,
      removed: [recordPath, kPath, opts.sockPath]
    }));
  };
  if (opts.register) {
    fs2.mkdirSync(opts.registryDir, { recursive: true });
    const record = buildSessionRecord(facts, {
      agent: opts.agent,
      name: opts.name,
      kind: opts.kind,
      omit: opts.omit,
      set: opts.set
    });
    fs2.writeFileSync(recordPath, JSON.stringify(record));
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "register-record", {
      path: recordPath,
      record
    }));
  }
  if (opts.writeKey) {
    fs2.writeFileSync(kPath, JSON.stringify(buildKeyRecord(facts, opts.token)), { mode: 384 });
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "register-key", {
      path: kPath,
      peerTokenLen: opts.token.length,
      procStart,
      pidDomain
    }));
  }
  try {
    fs2.mkdirSync(path.dirname(opts.sockPath), { recursive: true });
    if (fs2.existsSync(opts.sockPath)) fs2.unlinkSync(opts.sockPath);
  } catch {
  }
  let connSeq = 0;
  const server = net.createServer((sock) => {
    connSeq += 1;
    const connId = connSeq;
    let buf = "";
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "connect", { connId }));
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => {
      buf += chunk;
      const { lines, rest } = splitFrames(buf);
      buf = rest;
      for (const line of lines) {
        const parsed = parseFrame(line);
        const authVerdict = verifyAuthFrame(line, opts.token);
        const wrapper = extractWrapperAttrs(extractMessageText(line) ?? "");
        appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "frame", {
          connId,
          rawLine: line,
          // ⛔ 原始字节（AC1 要求核对「实际到达的属性值」）
          parsed,
          authVerdict,
          wrapperAttrs: Object.keys(wrapper).length > 0 ? wrapper : void 0
        }));
      }
    });
    sock.on("end", () => {
      appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "end", { connId }));
    });
    sock.on("error", (e) => {
      appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "sock-error", { connId, error: e.message }));
    });
  });
  server.on("error", (e) => {
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "listen-error", { error: e.message, code: e.code }));
    console.error(`\u26D4 \u76D1\u542C\u5931\u8D25: ${e.message}`);
    cleanup();
    process.exit(2);
  });
  server.listen(opts.sockPath, () => {
    try {
      fs2.chmodSync(opts.sockPath, 384);
    } catch {
    }
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "listening", {
      sockPath: opts.sockPath,
      pid,
      recordPath,
      keyPath: kPath
    }));
    process.stdout.write(JSON.stringify({
      probe: "peer-identity-probe",
      status: "listening",
      pid,
      name: opts.name === void 0 ? `${DEFAULT_NAME_PREFIX}-${pid}` : opts.name,
      agent: opts.agent === void 0 ? DEFAULT_AGENT : opts.agent,
      sockPath: opts.sockPath,
      recordPath,
      keyPath: kPath,
      evidencePath: opts.evidencePath,
      label: opts.label
    }) + "\n");
  });
  const bye = () => {
    try {
      server.close();
    } catch {
    }
    cleanup();
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
  process.on("uncaughtException", (e) => {
    appendEvidence(opts.evidencePath, buildEvidenceEntry(opts.label, "uncaught", { error: String(e) }));
    bye();
  });
}
function registryDirOf(home) {
  return path.join(home, ".claude", "sessions");
}
function patchRecord(pid, omit, set) {
  const dir = registryDirOf(os.homedir());
  const p = path.join(dir, `${pid}.json`);
  const raw = fs2.readFileSync(p, "utf8");
  const rec = JSON.parse(raw);
  if (rec[PROBE_MARKER] !== PROBE_MARKER_VALUE) {
    console.error(`\u26D4 ${p} \u4E0D\u5E26\u672C\u63A2\u9488\u6807\u8BB0\u2014\u2014\u62D2\u7EDD\u6539\u5199\uFF08\u26D4 \u4E0D\u78B0\u975E\u672C\u63A2\u9488\u7684\u8BB0\u5F55\uFF09`);
    process.exit(3);
  }
  for (const k of omit) delete rec[k];
  for (const [k, v] of Object.entries(set)) {
    if (v === "__DELETE__") delete rec[k];
    else rec[k] = v;
  }
  rec.updatedAt = Date.now();
  fs2.writeFileSync(p, JSON.stringify(rec));
  console.error(`\u2705 patched ${p}\uFF08omit=${omit.join(",") || "-"} set=${Object.keys(set).join(",") || "-"}\uFF09`);
}
function cleanupAll() {
  const dir = registryDirOf(os.homedir());
  let entries;
  try {
    entries = fs2.readdirSync(dir);
  } catch {
    console.error("\uFF08\u65E0\u6CE8\u518C\u76EE\u5F55\uFF09");
    return;
  }
  const removed = [];
  const skipped = [];
  for (const f of entries) {
    if (!f.endsWith(".json") && !f.endsWith(".key")) continue;
    const p = path.join(dir, f);
    let content = null;
    try {
      content = fs2.readFileSync(p, "utf8");
    } catch {
      content = null;
    }
    if (shouldCleanupFile(f, content, -1)) {
      try {
        fs2.unlinkSync(p);
        removed.push(f);
      } catch {
      }
    } else {
      skipped.push(f);
    }
  }
  console.log(JSON.stringify({ removed, skipped }, null, 2));
}
function shutdown(pid) {
  const dir = registryDirOf(os.homedir());
  const p = path.join(dir, `${pid}.json`);
  let rec;
  try {
    rec = JSON.parse(fs2.readFileSync(p, "utf8"));
  } catch {
    console.error(`\u26D4 \u8BFB\u4E0D\u5230 ${p}`);
    process.exit(3);
  }
  if (rec[PROBE_MARKER] !== PROBE_MARKER_VALUE) {
    console.error(`\u26D4 ${p} \u4E0D\u662F\u672C\u63A2\u9488\u7684\u8BB0\u5F55\u2014\u2014\u62D2\u7EDD\uFF08\u26D4 \u4E0D kill \u522B\u7684\u4F1A\u8BDD\uFF09`);
    process.exit(3);
  }
  const target = Number(rec.pid);
  try {
    process.kill(target, "SIGTERM");
  } catch (e) {
    console.error(`\u26D4 kill(${target}) \u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(JSON.stringify({ signalled: target }));
}
function parseArgs(argv) {
  const cmd = argv[0] ?? "";
  const flags = /* @__PURE__ */ new Map();
  let cur = null;
  for (const a of argv.slice(1)) {
    if (a.startsWith("--")) {
      cur = a.slice(2);
      if (!flags.has(cur)) flags.set(cur, []);
    } else if (cur) flags.get(cur).push(a);
  }
  return { cmd, flags };
}
var USAGE = `usage:
  peer-identity-probe.ts serve   [--agent X] [--name X] [--kind X] [--omit a,b] [--set k=json]
                                 [--no-register] [--no-key] [--token HEX] [--sock PATH]
                                 [--evidence PATH] [--label L] [--registry DIR]
  peer-identity-probe.ts patch   --pid N [--omit a,b] [--set k=json]
  peer-identity-probe.ts shutdown --pid N
  peer-identity-probe.ts cleanup`;
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  const { cmd, flags } = parseArgs(argv);
  const one = (k) => flags.get(k)?.[0];
  const parseSet = () => {
    const out = {};
    for (const s of flags.get("set") ?? []) {
      const eq = s.indexOf("=");
      if (eq < 0) continue;
      const k = s.slice(0, eq);
      const v = s.slice(eq + 1);
      if (v === "__DELETE__") out[k] = "__DELETE__";
      else {
        try {
          out[k] = JSON.parse(v);
        } catch {
          out[k] = v;
        }
      }
    }
    return out;
  };
  const pidOf = () => {
    const n = Number(one("pid"));
    if (!Number.isInteger(n) || n <= 0) {
      console.error(USAGE);
      process.exit(1);
    }
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
        agent: flags.has("agent") ? one("agent") ?? "" : void 0,
        name: flags.has("name") ? one("name") ?? "" : void 0,
        kind: flags.has("kind") ? one("kind") ?? "" : void 0,
        omit: (one("omit") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        set: parseSet(),
        register: !flags.has("no-register"),
        writeKey: !flags.has("no-key"),
        token: one("token") ?? generatePeerToken(),
        keyFileId: one("keyid") ?? generateKeyFileId()
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
var isDirect = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try {
    return path.resolve(a1) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirect) main();
export {
  DEFAULT_AGENT,
  DEFAULT_EVIDENCE,
  DEFAULT_NAME_PREFIX,
  DEFAULT_SOCK_DIR,
  PROBE_MARKER,
  PROBE_MARKER_VALUE,
  appendEvidence,
  buildEvidenceEntry,
  buildKeyRecord,
  buildPidDomain,
  buildSessionRecord,
  detectCcVersion,
  extractMessageText,
  extractWrapperAttrs,
  generateKeyFileId,
  generatePeerToken,
  isOwnRegistryFile,
  parseFrame,
  parsePidNamespaceLink,
  parseProcStart,
  readPidDomain,
  readProcStart,
  shouldCleanupFile,
  splitFrames,
  verifyAuthFrame
};
