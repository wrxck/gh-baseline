import React from 'react';
import { Box, Text } from 'ink';

import { useAppState, type ViewName } from '../state.js';

const HINTS: Record<ViewName, string> = {
  dashboard: 'j/k move  Enter select  q quit  ? help',
  profileBuilder:
    'Tab/→ next  Shift-Tab/← prev  Enter advance  Esc cancel  q quit',
  profileList: 'j/k move  Enter open  n new  e edit  Esc back  q quit',
  profileDetail: 'Esc back  q quit',
  auditViewer: 'j/k scroll  Enter expand  Esc back  q quit',
};

export function KeyHint(): React.JSX.Element {
  const state = useAppState();
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text dimColor>{HINTS[state.currentView]}</Text>
    </Box>
  );
}
