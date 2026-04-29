import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { Rule } from '@matthesketh/ink-rule';
import { Modal } from '@matthesketh/ink-modal';
import { useToast } from '@matthesketh/ink-toast';

import {
  PB_MAX_STEP,
  PB_MIN_STEP,
  useAppDispatch,
  useAppState,
  type ProfileDraft,
} from '../state.js';
import { LocalProfileSchema, write as writeProfile } from '../profile-store.js';

const ID_REGEX = /^[a-z][a-z0-9-]{0,40}$/;

type MetadataRule = 'required' | 'optional' | 'forbidden';

interface MetadataRules {
  description: MetadataRule;
  homepage: MetadataRule;
  topics: MetadataRule;
  license: MetadataRule;
}

interface BranchProtection {
  requiredReviewers: number;
  requiredStatusChecks: string[];
  requireSignedCommits: boolean;
  allowForcePushes: boolean;
  requireConversationResolution: boolean;
}

const DEFAULT_METADATA: MetadataRules = {
  description: 'required',
  homepage: 'optional',
  topics: 'optional',
  license: 'required',
};

const DEFAULT_BRANCH_PROTECTION: BranchProtection = {
  requiredReviewers: 1,
  requiredStatusChecks: [],
  requireSignedCommits: false,
  allowForcePushes: false,
  requireConversationResolution: true,
};

function getString(draft: ProfileDraft, key: string, fallback = ''): string {
  const v = draft[key];
  return typeof v === 'string' ? v : fallback;
}

function getMetadata(draft: ProfileDraft): MetadataRules {
  const v = draft['metadata'];
  if (v && typeof v === 'object') {
    return { ...DEFAULT_METADATA, ...(v as Partial<MetadataRules>) };
  }
  return DEFAULT_METADATA;
}

function getBranchProtection(draft: ProfileDraft): BranchProtection {
  const v = draft['branchProtection'];
  if (v && typeof v === 'object') {
    const partial = v as Partial<BranchProtection>;
    return {
      ...DEFAULT_BRANCH_PROTECTION,
      ...partial,
      requiredStatusChecks: Array.isArray(partial.requiredStatusChecks)
        ? partial.requiredStatusChecks.filter((s): s is string => typeof s === 'string')
        : DEFAULT_BRANCH_PROTECTION.requiredStatusChecks,
    };
  }
  return DEFAULT_BRANCH_PROTECTION;
}

const STEP_TITLES: Record<number, string> = {
  1: 'Step 1 of 10 — Identity',
  2: 'Step 2 of 10 — Metadata rules',
  3: 'Step 3 of 10 — Community files',
  4: 'Step 4 of 10 — Branch protection (main)',
  5: 'Step 5 of 10 — Security features',
  6: 'Step 6 of 10 — Repo settings',
  7: 'Step 7 of 10 — Labels',
  8: 'Step 8 of 10 — CI policy',
  9: 'Step 9 of 10 — Review',
  10: 'Step 10 of 10 — Export',
};

interface IdentityStepProps {
  draft: ProfileDraft;
  onField: (key: string, value: unknown) => void;
}

function IdentityStep({ draft, onField }: IdentityStepProps): React.JSX.Element {
  const [field, setField] = useState<'id' | 'name' | 'description'>('id');
  const id = getString(draft, 'id');
  const name = getString(draft, 'name');
  const description = getString(draft, 'description');

  const idValid = id === '' || ID_REGEX.test(id);

  return (
    <Box flexDirection="column">
      <Text>
        ID{' '}
        <Text dimColor>(lowercase, starts with letter, &lt;= 41 chars)</Text>:
      </Text>
      <Box>
        <Text color={field === 'id' ? 'cyan' : undefined}>{field === 'id' ? '> ' : '  '}</Text>
        <TextInput
          value={id}
          focus={field === 'id'}
          onChange={(v: string) => onField('id', v)}
          onSubmit={() => setField('name')}
        />
      </Box>
      {!idValid ? (
        <Text color="red">Invalid id — must match /^[a-z][a-z0-9-]{'{0,40}'}$/</Text>
      ) : null}

      <Box marginTop={1}>
        <Text>Name:</Text>
      </Box>
      <Box>
        <Text color={field === 'name' ? 'cyan' : undefined}>{field === 'name' ? '> ' : '  '}</Text>
        <TextInput
          value={name}
          focus={field === 'name'}
          onChange={(v: string) => onField('name', v)}
          onSubmit={() => setField('description')}
        />
      </Box>

      <Box marginTop={1}>
        <Text>Description:</Text>
      </Box>
      <Box>
        <Text color={field === 'description' ? 'cyan' : undefined}>
          {field === 'description' ? '> ' : '  '}
        </Text>
        <TextInput
          value={description}
          focus={field === 'description'}
          onChange={(v: string) => onField('description', v)}
          onSubmit={() => setField('id')}
        />
      </Box>
    </Box>
  );
}

interface MetadataStepProps {
  draft: ProfileDraft;
  onField: (key: string, value: unknown) => void;
}

function MetadataStep({ draft, onField }: MetadataStepProps): React.JSX.Element {
  const meta = getMetadata(draft);
  const fields = ['description', 'homepage', 'topics', 'license'] as const;
  const choices: MetadataRule[] = ['required', 'optional', 'forbidden'];

  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(fields.length - 1, c + 1));
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (input === ' ' || key.rightArrow || input === 'l') {
      const focusedField = fields[cursor];
      if (!focusedField) return;
      const current = meta[focusedField];
      const idx = choices.indexOf(current);
      const next = choices[(idx + 1) % choices.length] ?? 'optional';
      onField('metadata', { ...meta, [focusedField]: next });
      return;
    }
    if (key.leftArrow || input === 'h') {
      const focusedField = fields[cursor];
      if (!focusedField) return;
      const current = meta[focusedField];
      const idx = choices.indexOf(current);
      const next = choices[(idx - 1 + choices.length) % choices.length] ?? 'optional';
      onField('metadata', { ...meta, [focusedField]: next });
    }
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>j/k to move, Space/h/l to cycle</Text>
      {fields.map((f, i) => (
        <Text key={f} color={i === cursor ? 'cyan' : undefined}>
          {i === cursor ? '> ' : '  '}
          {f.padEnd(14)} <Text bold>{meta[f]}</Text>
        </Text>
      ))}
    </Box>
  );
}

interface BranchProtectionStepProps {
  draft: ProfileDraft;
  onField: (key: string, value: unknown) => void;
}

function BranchProtectionStep({
  draft,
  onField,
}: BranchProtectionStepProps): React.JSX.Element {
  const bp = getBranchProtection(draft);
  type FieldKey =
    | 'requiredReviewers'
    | 'requiredStatusChecks'
    | 'requireSignedCommits'
    | 'allowForcePushes'
    | 'requireConversationResolution';

  const fields: { key: FieldKey; label: string; kind: 'number' | 'csv' | 'toggle' }[] = [
    { key: 'requiredReviewers', label: 'Required reviewers', kind: 'number' },
    { key: 'requiredStatusChecks', label: 'Required status checks (CSV)', kind: 'csv' },
    { key: 'requireSignedCommits', label: 'Require signed commits', kind: 'toggle' },
    { key: 'allowForcePushes', label: 'Allow force pushes', kind: 'toggle' },
    {
      key: 'requireConversationResolution',
      label: 'Require conversation resolution',
      kind: 'toggle',
    },
  ];

  const [cursor, setCursor] = useState(0);
  const [reviewersText, setReviewersText] = useState(String(bp.requiredReviewers));
  const [checksText, setChecksText] = useState(bp.requiredStatusChecks.join(','));

  const focused = fields[cursor];

  useInput((input, key) => {
    if (key.downArrow || (input === 'j' && focused?.kind === 'toggle')) {
      setCursor((c) => Math.min(fields.length - 1, c + 1));
      return;
    }
    if (key.upArrow || (input === 'k' && focused?.kind === 'toggle')) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (focused?.kind === 'toggle' && (input === ' ' || key.return)) {
      const current = bp[focused.key] as boolean;
      onField('branchProtection', { ...bp, [focused.key]: !current });
    }
  });

  const update = (key: FieldKey, value: unknown): void => {
    onField('branchProtection', { ...bp, [key]: value });
  };

  return (
    <Box flexDirection="column">
      <Text dimColor>j/k to move, Space toggles, Enter submits text fields</Text>
      {fields.map((f, i) => {
        const selected = i === cursor;
        if (f.kind === 'toggle') {
          const v = bp[f.key] as boolean;
          return (
            <Text key={f.key} color={selected ? 'cyan' : undefined}>
              {selected ? '> ' : '  '}
              {f.label.padEnd(34)} <Text bold>{v ? 'yes' : 'no'}</Text>
            </Text>
          );
        }
        if (f.kind === 'number') {
          return (
            <Box key={f.key}>
              <Text color={selected ? 'cyan' : undefined}>{selected ? '> ' : '  '}</Text>
              <Text>{f.label.padEnd(34)} </Text>
              <TextInput
                value={reviewersText}
                focus={selected}
                onChange={(v: string) => {
                  const filtered = v.replace(/[^0-9]/g, '');
                  setReviewersText(filtered);
                }}
                onSubmit={(v: string) => {
                  const n = Number.parseInt(v || '0', 10);
                  if (Number.isFinite(n) && n >= 0) update('requiredReviewers', n);
                }}
              />
            </Box>
          );
        }
        // csv
        return (
          <Box key={f.key}>
            <Text color={selected ? 'cyan' : undefined}>{selected ? '> ' : '  '}</Text>
            <Text>{f.label.padEnd(34)} </Text>
            <TextInput
              value={checksText}
              focus={selected}
              onChange={(v: string) => setChecksText(v)}
              onSubmit={(v: string) => {
                const checks = v
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0);
                update('requiredStatusChecks', checks);
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
}

interface ReviewStepProps {
  draft: ProfileDraft;
}

function ReviewStep({ draft }: ReviewStepProps): React.JSX.Element {
  const meta = getMetadata(draft);
  const bp = getBranchProtection(draft);
  return (
    <Box flexDirection="column">
      <Rule title="Identity" />
      <Text>id: {getString(draft, 'id', '(not set)')}</Text>
      <Text>name: {getString(draft, 'name', '(not set)')}</Text>
      <Text>description: {getString(draft, 'description', '(not set)')}</Text>
      <Box marginTop={1} />
      <Rule title="Metadata rules" />
      <Text>description: {meta.description}</Text>
      <Text>homepage: {meta.homepage}</Text>
      <Text>topics: {meta.topics}</Text>
      <Text>license: {meta.license}</Text>
      <Box marginTop={1} />
      <Rule title="Branch protection (main)" />
      <Text>required reviewers: {bp.requiredReviewers}</Text>
      <Text>required status checks: {bp.requiredStatusChecks.join(', ') || '(none)'}</Text>
      <Text>require signed commits: {bp.requireSignedCommits ? 'yes' : 'no'}</Text>
      <Text>allow force pushes: {bp.allowForcePushes ? 'yes' : 'no'}</Text>
      <Text>require conversation resolution: {bp.requireConversationResolution ? 'yes' : 'no'}</Text>
    </Box>
  );
}

interface ExportResult {
  ok: boolean;
  message: string;
  path?: string;
}

function performExport(draft: ProfileDraft): ExportResult {
  const validated = LocalProfileSchema.safeParse(draft);
  if (!validated.success) {
    return {
      ok: false,
      message: `Validation failed: ${validated.error.issues.map((i) => i.message).join('; ')}`,
    };
  }
  try {
    const path = writeProfile(validated.data, 'yaml');
    return { ok: true, message: `Wrote ${path}`, path };
  } catch (err) {
    return {
      ok: false,
      message: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

interface ExportStepProps {
  result: ExportResult | null;
}

function ExportStep({ result }: ExportStepProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {result ? (
        <Text color={result.ok ? 'green' : 'red'}>{result.message}</Text>
      ) : (
        <Text dimColor>Press Enter (or w) to write the profile.</Text>
      )}
      <Text dimColor>Target: ~/.config/gh-baseline/profiles/&lt;id&gt;.yaml</Text>
    </Box>
  );
}

export function ProfileBuilder(): React.JSX.Element {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  useInput((input, key) => {
    if (confirmCancel) {
      if (input === 'y') {
        dispatch({ type: 'PB_RESET' });
        dispatch({ type: 'NAVIGATE', view: 'dashboard' });
      } else if (input === 'n' || key.escape) {
        setConfirmCancel(false);
      }
      return;
    }
    if (key.tab && !key.shift) {
      dispatch({ type: 'PB_NEXT_STEP' });
      return;
    }
    if (key.shift && key.tab) {
      dispatch({ type: 'PB_PREV_STEP' });
      return;
    }
    // On the export step, Enter / 'w' triggers the write.
    if (state.pbStep === PB_MAX_STEP && (key.return || input === 'w')) {
      const r = performExport(state.pbDraft);
      setExportResult(r);
      toast(r.message, r.ok ? 'success' : 'error');
      return;
    }
    // Avoid stealing right/left arrows from sub-components — those are scoped.
    if (key.escape) {
      setConfirmCancel(true);
    }
  });

  const onField = (key: string, value: unknown): void => {
    dispatch({ type: 'PB_SET_FIELD', key, value });
  };

  const draft = state.pbDraft;
  const stepTitle = STEP_TITLES[state.pbStep] ?? `Step ${state.pbStep}`;
  const minStep = PB_MIN_STEP;
  const maxStep = PB_MAX_STEP;
  const canPrev = state.pbStep > minStep;
  const canNext = state.pbStep < maxStep;

  const stepBody = useMemo(() => {
    switch (state.pbStep) {
      case 1:
        return <IdentityStep draft={draft} onField={onField} />;
      case 2:
        return <MetadataStep draft={draft} onField={onField} />;
      case 3:
        return (
          <Box flexDirection="column">
            <Text dimColor>
              Community files (CONTRIBUTING / COC / SECURITY / PR template / issue templates /
              CODEOWNERS) — Tab/Shift-Tab to skip.
            </Text>
            <Text dimColor>{/* TODO(builder): step 3 full UI */}Stub.</Text>
          </Box>
        );
      case 4:
        return <BranchProtectionStep draft={draft} onField={onField} />;
      case 5:
        return (
          <Box flexDirection="column">
            <Text dimColor>
              Security features (Dependabot alerts/updates, secret scanning, push protection,
              vulnerability reporting) — Tab/Shift-Tab to skip.
            </Text>
            <Text dimColor>{/* TODO(builder): step 5 full UI */}Stub.</Text>
          </Box>
        );
      case 6:
        return (
          <Box flexDirection="column">
            <Text dimColor>
              Repo settings (squash/merge/rebase, auto-merge, deleteBranchOnMerge, default
              branch) — Tab/Shift-Tab to skip.
            </Text>
            <Text dimColor>{/* TODO(builder): step 6 full UI */}Stub.</Text>
          </Box>
        );
      case 7:
        return (
          <Box flexDirection="column">
            <Text dimColor>
              Labels (curated default set; add via n, remove via d) — Tab/Shift-Tab to skip.
            </Text>
            <Text dimColor>{/* TODO(builder): step 7 full UI */}Stub.</Text>
          </Box>
        );
      case 8:
        return (
          <Box flexDirection="column">
            <Text dimColor>
              CI policy (testWorkflow, codeQL, dependabotConfig — required/optional/forbidden) —
              Tab/Shift-Tab to skip.
            </Text>
            <Text dimColor>{/* TODO(builder): step 8 full UI */}Stub.</Text>
          </Box>
        );
      case 9:
        return <ReviewStep draft={draft} />;
      case 10:
        return <ExportStep result={exportResult} />;
      default:
        return <Text>Unknown step.</Text>;
    }
    // The hook deps intentionally include the draft object reference and step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pbStep, draft]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Rule title={stepTitle} />
      <Box marginTop={1} />
      {stepBody}
      <Box marginTop={1} />
      <Text dimColor>
        {canPrev ? '[Shift-Tab] Prev  ' : ''}
        {canNext ? '[Tab] Next  ' : ''}
        [Esc] Cancel
      </Text>

      <Modal visible={confirmCancel} title="Cancel builder?" borderColor="red">
        <Box flexDirection="column">
          <Text>Discard the in-progress profile? (y/n)</Text>
        </Box>
      </Modal>
    </Box>
  );
}
