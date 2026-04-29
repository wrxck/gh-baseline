import React, { useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { Rule } from '@matthesketh/ink-rule';

import { loadConfig, type Config } from '../../core/config.js';
import { readAudit, type AuditEntry } from '../../core/audit.js';
import { useAppDispatch, type ViewName } from '../state.js';

interface QuickAction {
  label: string;
  value: 'profileBuilder' | 'profileList' | 'auditViewer' | 'quit';
}

const ACTIONS: QuickAction[] = [
  { label: 'Build a new profile', value: 'profileBuilder' },
  { label: 'List profiles', value: 'profileList' },
  { label: 'View audit log', value: 'auditViewer' },
  { label: 'Quit', value: 'quit' },
];

function safeLoadConfig(): { config: Config | null; error: string | null } {
  try {
    return { config: loadConfig(), error: null };
  } catch (err) {
    return { config: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function safeReadAudit(): { entries: AuditEntry[]; error: string | null } {
  try {
    return { entries: readAudit({ tail: 5 }), error: null };
  } catch (err) {
    return { entries: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function Dashboard(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const app = useApp();

  const { config, error: configError } = useMemo(safeLoadConfig, []);
  const { entries, error: auditError } = useMemo(safeReadAudit, []);

  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(ACTIONS.length - 1, c + 1));
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.return) {
      const target = ACTIONS[cursor];
      if (!target) return;
      if (target.value === 'quit') {
        app.exit();
        return;
      }
      const view: ViewName = target.value;
      dispatch({ type: 'NAVIGATE', view });
    }
  });

  const allowedRepos = config?.allowedRepos.length ?? 0;
  const allowedOrgs = config?.allowedOrgs.length ?? 0;
  const defaultProfile = config?.defaultProfile ?? '(unknown)';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Rule title="Allowlist" />
      {configError ? (
        <Text color="red">Failed to load config: {configError}</Text>
      ) : (
        <Box flexDirection="column">
          <Text>
            Repos: <Text color="green">{allowedRepos}</Text>{' '}
            Orgs: <Text color="green">{allowedOrgs}</Text>
          </Text>
        </Box>
      )}

      <Box marginTop={1} />
      <Rule title="Default profile" />
      <Text>
        <Text color="cyan">{defaultProfile}</Text>
      </Text>

      <Box marginTop={1} />
      <Rule title="Recent audit" />
      {auditError ? (
        <Text color="red">Failed to read audit: {auditError}</Text>
      ) : entries.length === 0 ? (
        <Text dimColor>No audit entries yet.</Text>
      ) : (
        <Box flexDirection="column">
          {entries.map((entry, i) => (
            <Text key={`${entry.ts}-${i}`}>
              <Text dimColor>{entry.ts}</Text> {entry.tool}{' '}
              <Text color={entry.result === 'ok' ? 'green' : entry.result === 'error' ? 'red' : 'yellow'}>
                {entry.result}
              </Text>
              {entry.repo ? <Text dimColor> {entry.repo}</Text> : null}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1} />
      <Rule title="Quick actions" />
      <Box flexDirection="column">
        {ACTIONS.map((action, i) => (
          <Text key={action.value} color={i === cursor ? 'cyan' : undefined}>
            {i === cursor ? '> ' : '  '}
            {action.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
