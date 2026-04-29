import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import React, { useReducer } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';

import { ToastProvider } from '@matthesketh/ink-toast';

import {
  AppDispatchContext,
  AppStateContext,
  initialState,
  reducer,
  type TuiState,
} from '../state.js';
import { ProfileBuilder } from './ProfileBuilder.js';

function makeState(overrides: Partial<TuiState> = {}): TuiState {
  return { ...initialState, ...overrides };
}

interface HarnessProps {
  initial?: Partial<TuiState>;
}

function Harness({ initial }: HarnessProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, makeState(initial));
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <ToastProvider>
          <ProfileBuilder />
        </ToastProvider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

let tempDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'gh-baseline-builder-'));
  prevEnv = process.env.GH_BASELINE_PROFILES_DIR;
  process.env.GH_BASELINE_PROFILES_DIR = tempDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.GH_BASELINE_PROFILES_DIR;
  else process.env.GH_BASELINE_PROFILES_DIR = prevEnv;
  rmSync(tempDir, { recursive: true, force: true });
});

// Strip line wrapping caused by terminal-size-driven layout, so substrings
// like "Step 1 of 10" remain matchable when the rendered title is split
// across two lines.
function clean(out: string | undefined): string {
  if (!out) return '';
  return out.replace(/\s+/g, ' ');
}

describe('<ProfileBuilder />', () => {
  it('renders step 1 (Identity) by default', () => {
    const { lastFrame } = render(<Harness />);
    const out = clean(lastFrame());
    // Body text is the most stable assertion target — the Rule title can be
    // chopped by terminal-width math.
    expect(out).toMatch(/Identity/);
    expect(out).toMatch(/lowercase, starts with letter/);
  });

  it('navigates forward and back with Tab and Shift-Tab', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write('\t');
    await new Promise((r) => setImmediate(r));
    expect(clean(lastFrame())).toMatch(/Metadata rules/);
    stdin.write('\t');
    await new Promise((r) => setImmediate(r));
    expect(clean(lastFrame())).toMatch(/Community files/);
    // ESC + [Z is the conventional shift-tab encoding.
    stdin.write('[Z');
    await new Promise((r) => setImmediate(r));
    expect(clean(lastFrame())).toMatch(/Metadata rules/);
  });

  it('export step writes a yaml file when the draft is valid', async () => {
    const draft = {
      id: 'my-profile',
      name: 'My Profile',
      description: 'Hello',
    };
    const { stdin, lastFrame } = render(<Harness initial={{ pbStep: 10, pbDraft: draft }} />);
    // Allow useEffect-registered useInput to attach before sending input.
    await new Promise((r) => setImmediate(r));
    expect(clean(lastFrame())).toMatch(/Press Enter \(or w\)/);
    // Press 'w' (alias for Enter on the export step) to trigger the export.
    stdin.write('w');
    await new Promise((r) => setImmediate(r));
    const expected = join(tempDir, 'my-profile.yaml');
    expect(existsSync(expected)).toBe(true);
    const content = readFileSync(expected, 'utf-8');
    expect(content).toMatch(/id: my-profile/);
    expect(content).toMatch(/name: My Profile/);
  });

  it('export step does not write a file when the draft is invalid', async () => {
    const draft = { id: 'BAD ID', name: '' };
    const { stdin } = render(<Harness initial={{ pbStep: 10, pbDraft: draft }} />);
    await new Promise((r) => setImmediate(r));
    stdin.write('w');
    for (let i = 0; i < 5; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
    // No file should land for an invalid draft (id contains a space).
    expect(existsSync(join(tempDir, 'BAD ID.yaml'))).toBe(false);
    expect(existsSync(join(tempDir, 'bad-id.yaml'))).toBe(false);
  });
});
