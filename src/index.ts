#!/usr/bin/env node

import { run } from './cli.js';

run(process.argv).catch((err: unknown) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
});
