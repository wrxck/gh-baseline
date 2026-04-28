import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { buildAuditView } from '../commands/audit.js';
import { buildDoctorReport } from '../commands/doctor.js';
import { listProfiles } from '../commands/profiles.js';
import { assertRepoSlug } from '../core/validate.js';

/**
 * Register the supporting MCP tools owned by the CLI verbs surface
 * (doctor / audit / profiles list). Other tools (scan/apply) are registered
 * by their respective owners. Exported so tests can register against a fake
 * server.
 */
export function registerSupportTools(server: McpServer): void {
  server.registerTool(
    'gh_baseline_doctor',
    {
      description:
        'Run the gh-baseline doctor self-check. Returns config validity, auth/scopes, ' +
        'allowed-repo reachability, audit log size, and the configured rate limit.',
      inputSchema: {},
    },
    async () => {
      const report = await buildDoctorReport();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(report, null, 2),
          },
        ],
        structuredContent: report as unknown as Record<string, unknown>,
        isError: !report.ok,
      };
    },
  );

  server.registerTool(
    'gh_baseline_audit_tail',
    {
      description:
        'Return the most recent gh-baseline audit log entries. Optional `count` ' +
        '(default 20), `tool`, and `repo` filters.',
      inputSchema: {
        count: z.number().int().positive().max(1000).optional(),
        tool: z.string().optional(),
        repo: z
          .string()
          .optional()
          .refine(
            (v) => {
              if (v === undefined) return true;
              try {
                assertRepoSlug(v);
                return true;
              } catch {
                return false;
              }
            },
            { message: 'repo must be a valid owner/name slug' },
          ),
      },
    },
    async (args) => {
      const view = buildAuditView({
        tail: args.count ?? 20,
        ...(args.tool !== undefined ? { tool: args.tool } : {}),
        ...(args.repo !== undefined ? { repo: args.repo } : {}),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(view, null, 2) }],
        structuredContent: view as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'gh_baseline_list_profiles',
    {
      description:
        'List the profile metadata bundled with gh-baseline (id, name, description). ' +
        'Returns an empty list with a note if the profile registry has not been wired ' +
        'in this build.',
      inputSchema: {},
    },
    async () => {
      const all = await listProfiles();
      const payload =
        all.length === 0
          ? {
              profiles: [],
              note: 'profile registry not yet available — bundled profiles will appear once src/profiles/index.ts is published',
            }
          : { profiles: all };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}

export async function startMcpServer(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

  const server = new McpServer({
    name: 'gh-baseline',
    version: pkg.version,
  });

  registerSupportTools(server);
  // Other tools (scan/apply) are registered by their respective owners.

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
