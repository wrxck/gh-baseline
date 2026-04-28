import React from 'react';
import { render, Box, Text } from 'ink';

/**
 * TUI entrypoint. The full dashboard (built by Agent F) wires:
 *
 *   - A repo-scan dashboard (uses @matthesketh/ink-table for the report grid)
 *   - The interactive profile builder (uses @matthesketh/ink-form,
 *     ink-fuzzy-select, ink-modal, ink-tabs)
 *   - The audit-log viewer (uses @matthesketh/ink-scrollable-list)
 *   - A diff/apply confirmation flow (uses @matthesketh/ink-modal)
 *
 * All of these share the input dispatcher + viewport pattern that fleet uses,
 * so muscle-memory carries between projects.
 */
function App(): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>gh-baseline</Text>
      <Text dimColor>Interactive dashboard — scan, profile, apply, audit.</Text>
      <Box marginTop={1}>
        <Text>(Stub — Agent F implements the full dashboard.)</Text>
      </Box>
    </Box>
  );
}

export function launchTui(): void {
  const { waitUntilExit } = render(<App />);
  waitUntilExit().then(() => process.exit(0));
}
