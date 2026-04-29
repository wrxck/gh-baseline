import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import * as YAML from 'yaml';

import { read as readProfile } from '../profile-store.js';
import { useAppState } from '../state.js';

export function ProfileDetail(): React.JSX.Element {
  const state = useAppState();
  const id = state.selectedProfileId;

  const file = useMemo(() => (id ? readProfile(id) : null), [id]);

  if (!id) {
    return (
      <Box paddingX={1}>
        <Text color="red">No profile selected.</Text>
      </Box>
    );
  }
  if (!file) {
    return (
      <Box paddingX={1}>
        <Text color="red">Profile {id} not found or invalid.</Text>
      </Box>
    );
  }

  const yaml = YAML.stringify(file.profile);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text bold>Source:</Text> <Text dimColor>{file.source}</Text>
      </Text>
      <Box marginTop={1} />
      <Text>{yaml}</Text>
    </Box>
  );
}
