import React, { useReducer, useState } from 'react';
import { Box, render, Text, useApp } from 'ink';

import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';
import { ToastProvider } from '@matthesketh/ink-toast';
import { Viewport } from '@matthesketh/ink-viewport';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AppDispatchContext,
  AppStateContext,
  initialState,
  reducer,
  useAppState,
  type Dispatch,
} from './state.js';
import { Header } from './components/Header.js';
import { KeyHint } from './components/KeyHint.js';
import { Dashboard } from './views/Dashboard.js';
import { ProfileBuilder } from './views/ProfileBuilder.js';
import { ProfileList } from './views/ProfileList.js';
import { ProfileDetail } from './views/ProfileDetail.js';
import { AuditViewer } from './views/AuditViewer.js';

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/tui/app.js OR src/tui/app.tsx — go up two levels.
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function ViewRouter(): React.JSX.Element {
  const state = useAppState();
  switch (state.currentView) {
    case 'dashboard':
      return <Dashboard />;
    case 'profileBuilder':
      return <ProfileBuilder />;
    case 'profileList':
      return <ProfileList />;
    case 'profileDetail':
      return <ProfileDetail />;
    case 'auditViewer':
      return <AuditViewer />;
    default:
      return <Dashboard />;
  }
}

function HelpPanel(): React.JSX.Element {
  const lines: { keys: string; desc: string }[] = [
    { keys: 'q', desc: 'quit' },
    { keys: '?', desc: 'toggle this help' },
    { keys: 'Esc', desc: 'go back' },
    { keys: 'j / k or arrows', desc: 'navigate lists' },
    { keys: 'Enter', desc: 'select / advance' },
    { keys: 'Tab / Shift-Tab', desc: 'next / prev step (builder)' },
  ];
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Keybindings</Text>
      {lines.map((l) => (
        <Box key={l.keys}>
          <Box width={22}>
            <Text color="cyan">{l.keys}</Text>
          </Box>
          <Text dimColor>{l.desc}</Text>
        </Box>
      ))}
    </Box>
  );
}

interface ShellProps {
  version: string;
  showHelp: boolean;
  setShowHelp: (v: boolean | ((prev: boolean) => boolean)) => void;
  dispatch: Dispatch;
}

function Shell({ version, showHelp, setShowHelp, dispatch }: ShellProps): React.JSX.Element {
  const app = useApp();
  return (
    <InputDispatcher
      globalHandler={(input, key) => {
        if (input === 'q') {
          app.exit();
          return true;
        }
        if (input === '?') {
          setShowHelp((v) => !v);
          return true;
        }
        if (key.escape) {
          dispatch({ type: 'GO_BACK' });
          return true;
        }
      }}
    >
      <Viewport>
        <Box flexDirection="column">
          <Header version={version} />
          <Box flexGrow={1} flexDirection="column">
            {showHelp ? <HelpPanel /> : <ViewRouter />}
          </Box>
          <KeyHint />
        </Box>
      </Viewport>
    </InputDispatcher>
  );
}

interface AppProps {
  version: string;
}

function App({ version }: AppProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <ToastProvider>
          <Shell
            version={version}
            showHelp={showHelp}
            setShowHelp={setShowHelp}
            dispatch={dispatch}
          />
        </ToastProvider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function launchTui(): Promise<void> {
  const version = readPackageVersion();
  const { waitUntilExit } = render(<App version={version} />);
  return waitUntilExit().then(() => {
    process.exit(0);
  });
}
