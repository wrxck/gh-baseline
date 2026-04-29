import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { ScrollableList } from '@matthesketh/ink-scrollable-list';

import { readAudit, type AuditEntry } from '../../core/audit.js';

interface Row {
  entry: AuditEntry;
  index: number;
}

function safeReadAudit(): { rows: Row[]; error: string | null } {
  try {
    const entries = readAudit();
    return { rows: entries.map((entry, index) => ({ entry, index })), error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function AuditViewer(): React.JSX.Element {
  const { rows, error } = useMemo(safeReadAudit, []);
  const [cursor, setCursor] = useState(rows.length > 0 ? rows.length - 1 : 0);
  const [expanded, setExpanded] = useState(false);

  useInput((input, key) => {
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(Math.max(0, rows.length - 1), c + 1));
      setExpanded(false);
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      setExpanded(false);
      return;
    }
    if (key.return) {
      setExpanded((e) => !e);
    }
  });

  if (error) {
    return (
      <Box paddingX={1}>
        <Text color="red">Failed to read audit log: {error}</Text>
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Audit log is empty.</Text>
      </Box>
    );
  }

  const focused = rows[cursor]?.entry;

  return (
    <Box flexDirection="column" paddingX={1}>
      <ScrollableList<Row>
        items={rows}
        selectedIndex={cursor}
        maxVisible={15}
        renderItem={(row, selected) => (
          <Text color={selected ? 'cyan' : undefined}>
            {selected ? '> ' : '  '}
            <Text dimColor>{row.entry.ts}</Text> {row.entry.tool}{' '}
            <Text
              color={
                row.entry.result === 'ok'
                  ? 'green'
                  : row.entry.result === 'error'
                    ? 'red'
                    : 'yellow'
              }
            >
              {row.entry.result}
            </Text>
            {row.entry.repo ? <Text dimColor> {row.entry.repo}</Text> : null}
          </Text>
        )}
      />
      {expanded && focused ? (
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          <Text bold>Details</Text>
          <Text>tool: {focused.tool}</Text>
          <Text>ts: {focused.ts}</Text>
          <Text>result: {focused.result}</Text>
          <Text>dryRun: {String(focused.dryRun)}</Text>
          {focused.repo ? <Text>repo: {focused.repo}</Text> : null}
          {focused.error ? <Text color="red">error: {focused.error}</Text> : null}
          {focused.args !== undefined ? (
            <Text>args: {JSON.stringify(focused.args)}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
