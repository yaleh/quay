// cli/mcp.ts — `quay mcp` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

// DIR-007: Core's own MCP server — the "MCP projection -> Agent" binding
// (quay-proposal.md §5). Aggregates every Provider currently
// `enabled: true` in .quay/config.yml behind a single MCP endpoint, so
// an Agent (Claude Code) registers `quay mcp` once instead of each
// Provider's own `<provider> mcp` separately. No subcommand token or
// flags — mirrors quay-native/quay-github's own `mcp` subcommand shape.
export async function handleMcp() {
  const { startMcpServer } = await import("../mcp-server.ts");
  await startMcpServer();
  return;
}
