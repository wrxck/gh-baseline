import React, { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';

import {
  AppDispatchContext,
  AppStateContext,
  initialState,
  reducer,
} from '../state.js';
import { Dashboard } from './Dashboard.js';

function Harness(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <Dashboard />
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

function clean(out: string | undefined): string {
  if (!out) return '';
  return out.replace(/\s+/g, ' ');
}

describe('<Dashboard />', () => {
  it('renders without crashing and surfaces audit + allowlist info', () => {
    const { lastFrame } = render(<Harness />);
    const out = clean(lastFrame());
    expect(out.length).toBeGreaterThan(0);
    // Body content (the Rule titles get chopped by terminal-width math, so
    // assert on the non-Rule lines instead).
    expect(out).toMatch(/Repos:/);
    expect(out).toMatch(/Orgs:/);
    expect(out).toMatch(/(No audit entries yet|ok|error|dry-run)/);
  });

  it('lists the four quick actions', () => {
    const { lastFrame } = render(<Harness />);
    const out = clean(lastFrame());
    expect(out).toMatch(/Build a new profile/);
    expect(out).toMatch(/List profiles/);
    expect(out).toMatch(/View audit log/);
    expect(out).toMatch(/Quit/);
  });
});
