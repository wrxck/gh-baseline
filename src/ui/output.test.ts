import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultSink,
  setOutputSink,
  stripAnsi,
  success,
  warn,
  error,
  info,
  heading,
  table,
  plain,
  type OutputSink,
} from './output.js';

interface CapturedSink extends OutputSink {
  out: string[];
  err: string[];
}

function makeSink(): CapturedSink {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout(text: string): void {
      out.push(text);
    },
    stderr(text: string): void {
      err.push(text);
    },
  };
}

afterEach(() => {
  setOutputSink(defaultSink);
});

describe('output sink helpers', () => {
  it('routes success/info/heading/plain/table to stdout and error to stderr', () => {
    const sink = makeSink();
    setOutputSink(sink);
    success('it works');
    info('fyi');
    warn('hmm');
    error('nope');
    heading('section');
    plain('raw');
    table(['a', 'b'], [['x', 'y']]);

    const stdout = sink.out.join('');
    expect(stripAnsi(stdout)).toContain('* it works');
    expect(stripAnsi(stdout)).toContain('- fyi');
    expect(stripAnsi(stdout)).toContain('! hmm');
    expect(stripAnsi(stdout)).toContain('section');
    expect(stripAnsi(stdout)).toContain('raw');
    expect(stripAnsi(stdout)).toContain('a');
    expect(stripAnsi(stdout)).toContain('x');

    const stderr = sink.err.join('');
    expect(stripAnsi(stderr)).toContain('x nope');
  });
});
