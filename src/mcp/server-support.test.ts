import { describe, expect, it } from 'vitest';

import { z } from 'zod';

import { registerSupportTools } from './server.js';

interface RegisteredTool {
  name: string;
  config: { description?: string; inputSchema?: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => Promise<unknown>;
}

/**
 * Minimal fake of `McpServer` that captures registerTool calls so we can
 * assert on the registration shape without booting a real stdio transport.
 */
function makeFakeServer(): {
  tools: RegisteredTool[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asMcp: any;
} {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    asMcp: {
      registerTool(
        name: string,
        config: RegisteredTool['config'],
        handler: RegisteredTool['handler'],
      ) {
        tools.push({ name, config, handler });
        return { name };
      },
    },
  };
}

describe('registerSupportTools', () => {
  it('registers doctor / audit_tail / list_profiles', () => {
    const { tools, asMcp } = makeFakeServer();
    registerSupportTools(asMcp);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'gh_baseline_audit_tail',
      'gh_baseline_doctor',
      'gh_baseline_list_profiles',
    ]);
  });

  it('audit_tail input schema includes count/tool/repo', () => {
    const { tools, asMcp } = makeFakeServer();
    registerSupportTools(asMcp);
    const tail = tools.find((t) => t.name === 'gh_baseline_audit_tail');
    expect(tail).toBeDefined();
    const schema = tail!.config.inputSchema!;
    expect(Object.keys(schema).sort()).toEqual(['count', 'repo', 'tool']);
  });

  it('audit_tail tool filter rejects strings over 100 chars and empty strings', () => {
    const { tools, asMcp } = makeFakeServer();
    registerSupportTools(asMcp);
    const tail = tools.find((t) => t.name === 'gh_baseline_audit_tail');
    const toolFilter = tail!.config.inputSchema!.tool as z.ZodTypeAny;
    expect(toolFilter.safeParse('').success).toBe(false);
    expect(toolFilter.safeParse('a'.repeat(101)).success).toBe(false);
    expect(toolFilter.safeParse('mcp.gh_baseline_scan_repo').success).toBe(true);
  });

  it('audit_tail repo filter rejects strings over 140 chars', () => {
    const { tools, asMcp } = makeFakeServer();
    registerSupportTools(asMcp);
    const tail = tools.find((t) => t.name === 'gh_baseline_audit_tail');
    const repoFilter = tail!.config.inputSchema!.repo as z.ZodTypeAny;
    expect(repoFilter.safeParse('a'.repeat(141)).success).toBe(false);
    expect(repoFilter.safeParse('acme/widgets').success).toBe(true);
  });

  it('list_profiles handler returns a JSON payload (empty registry note)', async () => {
    const { tools, asMcp } = makeFakeServer();
    registerSupportTools(asMcp);
    const list = tools.find((t) => t.name === 'gh_baseline_list_profiles');
    expect(list).toBeDefined();
    const result = (await list!.handler({})) as {
      content: { type: string; text: string }[];
      structuredContent: { profiles: unknown[]; note?: string };
    };
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(Array.isArray(result.structuredContent.profiles)).toBe(true);
    // Without Agent B's profiles index landed, we expect the empty-with-note shape.
    if (result.structuredContent.profiles.length === 0) {
      expect(result.structuredContent.note).toMatch(/profile registry/);
    }
  });
});
