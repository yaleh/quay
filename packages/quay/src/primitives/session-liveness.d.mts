// Type declarations for the byte-identical copy ./session-liveness.mjs (see PROVENANCE.md).
// See pty-frame.d.mts for why a sibling declaration file exists instead of in-body annotations.

/** `/proc/<pid>/stat` field 22 (starttime), counted from the LAST ')' so a comm with spaces works. */
export declare function readProcStat(
  pid: number | string,
): { starttime: string } | null;
/** This process's own PID-namespace fingerprint, e.g. "pid:[4026531836]". null when unreadable. */
export declare function localPidNamespace(): string | null;
/** null (not false) when we cannot tell (non-Linux, no /proc). */
export declare function isSamePidNamespace(pidDomain: string): boolean | null;
export declare function isPidAlive(
  pid: number,
  opts?: { expectedProcStart?: string | number | null; pidDomain?: string },
): boolean;
/** The transcript jsonl path convention's directory slug. */
export declare function slugifyCwd(cwd: string): string;
/** `~/.claude/projects/<slug(cwd)>/<sessionId>.jsonl`. */
export declare function transcriptPathFor(
  sessionId: string,
  cwd: string,
  opts?: { claudeHome?: string },
): string;
/** The transcript file's own mtime — never a self-reported field. null when unreadable. */
export declare function readTranscriptMtime(transcriptPath: string): number | null;
/** git's own last-commit timestamp for `cwd`. null when not a repo / no commits. */
export declare function readLastCommitAt(cwd: string): number | null;
export declare function computeLiveness(opts?: {
  pid?: number;
  procStart?: string | number | null;
  pidDomain?: string;
  sessionId?: string;
  cwd?: string;
}): { pidAlive: boolean; lastTranscriptWriteAt: number | null; lastCommitAt: number | null };
