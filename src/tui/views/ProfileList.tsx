import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { Table, type Column } from '@matthesketh/ink-table';

import { list as listProfiles } from '../profile-store.js';
import { useAppDispatch } from '../state.js';

interface Row {
  id: string;
  name: string;
  type: 'custom' | 'bundled';
  source: string;
}

const COLUMNS: Column<Row>[] = [
  { key: 'id', header: 'ID', width: 22 },
  { key: 'name', header: 'Name', width: 28 },
  { key: 'type', header: 'Type', width: 10 },
  { key: 'source', header: 'Source' },
];

export function ProfileList(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const rows = useMemo<Row[]>(() => {
    const files = listProfiles();
    return files.map((f) => {
      const name =
        typeof f.profile === 'object' &&
        f.profile !== null &&
        typeof (f.profile as { name?: unknown }).name === 'string'
          ? ((f.profile as { name: string }).name)
          : f.id;
      return {
        id: f.id,
        name,
        type: 'custom' as const,
        source: f.source,
      };
    });
  }, []);

  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(Math.max(0, rows.length - 1), c + 1));
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.return) {
      const row = rows[cursor];
      if (!row) return;
      dispatch({ type: 'SET_SELECTED_PROFILE', id: row.id });
      dispatch({ type: 'NAVIGATE', view: 'profileDetail' });
      return;
    }
    if (input === 'n') {
      dispatch({ type: 'PB_RESET' });
      dispatch({ type: 'NAVIGATE', view: 'profileBuilder' });
      return;
    }
    if (input === 'e') {
      const row = rows[cursor];
      if (!row) return;
      // Load existing into builder draft.
      const file = listProfiles().find((f) => f.id === row.id);
      if (!file) return;
      dispatch({
        type: 'PB_RESET',
        draft: file.profile as Record<string, unknown>,
      });
      dispatch({ type: 'SET_SELECTED_PROFILE', id: row.id });
      dispatch({ type: 'NAVIGATE', view: 'profileBuilder' });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {rows.length === 0 ? (
        <Text dimColor>
          No profiles yet — press <Text color="cyan">n</Text> to build one.
        </Text>
      ) : (
        <Table data={rows} columns={COLUMNS} selectedIndex={cursor} maxVisible={20} />
      )}
    </Box>
  );
}
