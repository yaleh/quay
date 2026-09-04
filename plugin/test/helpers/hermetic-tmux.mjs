// hermetic-tmux.mjs — shared hermetic-tmux fixture helper, built on the tmux-session library
// (tasks/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe, STAGE 1/3).
//
// Every real tmux call in the repo's tests must be isolated by BOTH mandatory conditions:
//   - explicit `-S <private-socket>` (only -S overrides $TMUX), and
//   - $TMUX stripped from the child env ($TMUX overrides TMUX_TMPDIR).
// This helper makes both STRUCTURAL: the socket is selected by the two mechanisms that AGREE —
//   - env TMUX_TMPDIR=<sockDir> (the helper scripts' socket contract: a bare `tmux` in a child
//     script resolves to <sockDir>/tmux-<uid>/default), and
//   - the explicit `-S <sockPath>` every DIRECT call here passes (tmux materializes the SAME path
//     for that TMUX_TMPDIR) — so a lost -S arg ERRORS instead of falling back to the default server.
//
// The socket is per-test (mkdtemp'd, 0o700). cleanup() kills each session it started with
// `tmux kill-session -t <name>` (NEVER `kill-server` on a shared/unknown socket — kill-server's
// blast radius is decided by the environment) BEFORE rmSync: removing the tmpdir alone leaves the
// server alive as an orphan (删目录 ≠ 杀进程). On this private socket the server exits by itself
// once the last session is killed.
//
// Direct dependency on the library only — no hand-rolled spawnSync("tmux", ...) in here.

import { tmux } from "../../scripts/tmux-session.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * newHermeticTmux(prefix) → { tmp, sockDir, sockPath, env, started, tmx, newSession, capture, cleanup }
 *  - tmx(args)        — isolated tmux on this fixture's socket (explicit -S + $TMUX-stripped env).
 *  - newSession(name, cmd) — `tmux new-session -d -s <name> <cmd>` on the fixture socket; tracks the
 *                       name so cleanup() can kill it. Returns the normalized exec result.
 *  - capture(name)    — `tmux capture-pane -p -t <name>` on the fixture socket.
 *  - cleanup()        — kill-session each started session (never kill-server), then rmSync the tmpdir.
 *  - env              — the isolated child env (TMUX_TMPDIR=<sockDir>, $TMUX stripped). Pass this to
 *                       any helper script that shells out to bare `tmux` so it resolves to THIS socket.
 */
export function newHermeticTmux(prefix = "hermetic-") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sockDir = path.join(tmp, "sock");
  const socketBase = path.join(sockDir, `tmux-${process.getuid()}`);
  fs.mkdirSync(socketBase, { recursive: true, mode: 0o700 }); // tmux refuses a world-accessible socket dir
  const sockPath = path.join(socketBase, "default");
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  const started = new Set();
  return {
    tmp,
    sockDir,
    sockPath,
    env,
    started,
    tmx(args) {
      return tmux(args, { socket: sockPath, env });
    },
    newSession(name, cmd) {
      const r = tmux(["new-session", "-d", "-s", name, cmd], { socket: sockPath, env });
      if (r.status === 0) started.add(name); // only kill what actually started
      return r;
    },
    capture(name) {
      return tmux(["capture-pane", "-p", "-t", name], { socket: sockPath, env });
    },
    cleanup() {
      for (const name of started) {
        tmux(["kill-session", "-t", name], { socket: sockPath, env });
      }
      // Sweep any session the fixture itself spawned on this socket (invisible to `started`).
      const ls = tmux(["list-sessions", "-F", "#{session_name}"], { socket: sockPath, env });
      if (ls.status === 0 && ls.stdout.trim()) {
        for (const s of ls.stdout.trim().split("\n")) {
          if (s.trim()) tmux(["kill-session", "-t", s.trim()], { socket: sockPath, env });
        }
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}
