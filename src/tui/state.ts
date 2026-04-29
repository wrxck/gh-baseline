import React, { createContext, useContext } from 'react';

/**
 * The set of top-level views the TUI can render.
 */
export type ViewName =
  | 'dashboard'
  | 'profileBuilder'
  | 'profileList'
  | 'profileDetail'
  | 'auditViewer';

/**
 * In-progress profile draft state used by the profile-builder. Kept loose
 * (`Record<string, unknown>`) at the state layer because individual builder
 * steps own their own typed assertions before writing.
 */
export type ProfileDraft = Record<string, unknown>;

export interface TuiState {
  currentView: ViewName;
  previousView: ViewName | null;
  selectedProfileId: string | null;
  selectedRepo: string | null;
  loading: boolean;
  error: string | null;
  /** Profile-builder step (1..10). */
  pbStep: number;
  /** Profile-builder draft (partial, in-progress). */
  pbDraft: ProfileDraft;
}

export const initialState: TuiState = {
  currentView: 'dashboard',
  previousView: null,
  selectedProfileId: null,
  selectedRepo: null,
  loading: false,
  error: null,
  pbStep: 1,
  pbDraft: {},
};

export type Action =
  | { type: 'NAVIGATE'; view: ViewName }
  | { type: 'GO_BACK' }
  | { type: 'SET_SELECTED_PROFILE'; id: string | null }
  | { type: 'SET_SELECTED_REPO'; repo: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'PB_SET_FIELD'; key: string; value: unknown }
  | { type: 'PB_NEXT_STEP' }
  | { type: 'PB_PREV_STEP' }
  | { type: 'PB_RESET'; draft?: ProfileDraft };

export const PB_MIN_STEP = 1;
export const PB_MAX_STEP = 10;

export function reducer(state: TuiState, action: Action): TuiState {
  switch (action.type) {
    case 'NAVIGATE':
      if (action.view === state.currentView) return state;
      return {
        ...state,
        previousView: state.currentView,
        currentView: action.view,
      };
    case 'GO_BACK': {
      const prev = state.previousView ?? 'dashboard';
      if (prev === state.currentView) return state;
      return {
        ...state,
        currentView: prev,
        previousView: null,
      };
    }
    case 'SET_SELECTED_PROFILE':
      return { ...state, selectedProfileId: action.id };
    case 'SET_SELECTED_REPO':
      return { ...state, selectedRepo: action.repo };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'PB_SET_FIELD':
      return {
        ...state,
        pbDraft: { ...state.pbDraft, [action.key]: action.value },
      };
    case 'PB_NEXT_STEP':
      return {
        ...state,
        pbStep: Math.min(PB_MAX_STEP, state.pbStep + 1),
      };
    case 'PB_PREV_STEP':
      return {
        ...state,
        pbStep: Math.max(PB_MIN_STEP, state.pbStep - 1),
      };
    case 'PB_RESET':
      return {
        ...state,
        pbStep: 1,
        pbDraft: action.draft ?? {},
      };
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

export type Dispatch = (action: Action) => void;

export const AppStateContext = createContext<TuiState | null>(null);
export const AppDispatchContext = createContext<Dispatch | null>(null);

export function useAppState(): TuiState {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used inside <AppStateContext.Provider>');
  }
  return ctx;
}

export function useAppDispatch(): Dispatch {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) {
    throw new Error('useAppDispatch must be used inside <AppDispatchContext.Provider>');
  }
  return ctx;
}

export function useTui(): { state: TuiState; dispatch: Dispatch } {
  return { state: useAppState(), dispatch: useAppDispatch() };
}

// Re-export React so consumers don't need a separate import for context types.
export { React };
