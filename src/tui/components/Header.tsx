import React from 'react';
import { Box, Text } from 'ink';

import { useAppState, type ViewName } from '../state.js';

const VIEW_LABELS: Record<ViewName, string> = {
  dashboard: 'Dashboard',
  profileBuilder: 'Profile Builder',
  profileList: 'Profiles',
  profileDetail: 'Profile Detail',
  auditViewer: 'Audit Log',
};

export interface HeaderProps {
  version: string;
}

export function Header({ version }: HeaderProps): React.JSX.Element {
  const state = useAppState();
  const label = VIEW_LABELS[state.currentView];
  return (
    <Box borderStyle="single" paddingX={1} justifyContent="space-between">
      <Text>
        <Text bold color="cyan">
          gh-baseline
        </Text>{' '}
        <Text dimColor>v{version}</Text>
      </Text>
      <Text>
        <Text color="yellow">{label}</Text>
      </Text>
    </Box>
  );
}
