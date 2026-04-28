import { describe, expect, it } from 'vitest';

import { initialState, PB_MAX_STEP, PB_MIN_STEP, reducer } from './state.js';

describe('reducer', () => {
  it('NAVIGATE updates currentView and stashes previousView', () => {
    const next = reducer(initialState, { type: 'NAVIGATE', view: 'profileList' });
    expect(next.currentView).toBe('profileList');
    expect(next.previousView).toBe('dashboard');
  });

  it('NAVIGATE no-ops when view is already current', () => {
    const next = reducer(initialState, { type: 'NAVIGATE', view: 'dashboard' });
    expect(next).toBe(initialState);
  });

  it('GO_BACK returns to previousView', () => {
    const navigated = reducer(initialState, { type: 'NAVIGATE', view: 'profileList' });
    const back = reducer(navigated, { type: 'GO_BACK' });
    expect(back.currentView).toBe('dashboard');
    expect(back.previousView).toBe(null);
  });

  it('GO_BACK falls through to dashboard when no previousView is set', () => {
    const back = reducer(initialState, { type: 'GO_BACK' });
    // already on dashboard; no-op
    expect(back).toBe(initialState);
  });

  it('SET_SELECTED_PROFILE stores the id', () => {
    const next = reducer(initialState, { type: 'SET_SELECTED_PROFILE', id: 'oss-public' });
    expect(next.selectedProfileId).toBe('oss-public');
    const cleared = reducer(next, { type: 'SET_SELECTED_PROFILE', id: null });
    expect(cleared.selectedProfileId).toBe(null);
  });

  it('SET_SELECTED_REPO stores the repo', () => {
    const next = reducer(initialState, { type: 'SET_SELECTED_REPO', repo: 'wrxck/fleet' });
    expect(next.selectedRepo).toBe('wrxck/fleet');
  });

  it('SET_LOADING and SET_ERROR update flags', () => {
    const loading = reducer(initialState, { type: 'SET_LOADING', loading: true });
    expect(loading.loading).toBe(true);
    const errored = reducer(loading, { type: 'SET_ERROR', error: 'boom' });
    expect(errored.error).toBe('boom');
  });

  it('PB_SET_FIELD merges into pbDraft', () => {
    const a = reducer(initialState, { type: 'PB_SET_FIELD', key: 'id', value: 'oss-public' });
    const b = reducer(a, { type: 'PB_SET_FIELD', key: 'name', value: 'OSS' });
    expect(b.pbDraft).toEqual({ id: 'oss-public', name: 'OSS' });
  });

  it('PB_NEXT_STEP / PB_PREV_STEP are clamped', () => {
    let s = initialState;
    for (let i = 0; i < 20; i += 1) {
      s = reducer(s, { type: 'PB_NEXT_STEP' });
    }
    expect(s.pbStep).toBe(PB_MAX_STEP);
    for (let i = 0; i < 30; i += 1) {
      s = reducer(s, { type: 'PB_PREV_STEP' });
    }
    expect(s.pbStep).toBe(PB_MIN_STEP);
  });

  it('PB_RESET clears the draft and step (and accepts a starting draft)', () => {
    const a = reducer(initialState, { type: 'PB_SET_FIELD', key: 'id', value: 'x' });
    const advanced = reducer(a, { type: 'PB_NEXT_STEP' });
    const reset = reducer(advanced, { type: 'PB_RESET' });
    expect(reset.pbStep).toBe(1);
    expect(reset.pbDraft).toEqual({});

    const seeded = reducer(advanced, {
      type: 'PB_RESET',
      draft: { id: 'seed', name: 'Seed' },
    });
    expect(seeded.pbDraft).toEqual({ id: 'seed', name: 'Seed' });
    expect(seeded.pbStep).toBe(1);
  });
});
