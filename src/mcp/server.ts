import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export async function startMcpServer(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

  const server = new McpServer({
    name: 'gh-baseline',
    version: pkg.version,
  });

  // Tools are registered by Agent D in commands/ and actors/. The placeholder
  // below documents the contract: scan/diff/apply, all with dryRun defaults.

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
