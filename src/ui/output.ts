import { writeSync } from 'node:fs';

const ESC = '\x1b[';

export const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,
};

export const icon = {
  ok: `${c.green}*${c.reset}`,
  warn: `${c.yellow}!${c.reset}`,
  err: `${c.red}x${c.reset}`,
  info: `${c.blue}-${c.reset}`,
  arrow: `${c.cyan}>${c.reset}`,
};

/** Pluggable writer so tests can capture output deterministically. */
export interface OutputSink {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const defaultSink: OutputSink = {
  stdout(text: string): void {
    writeSync(1, text);
  },
  stderr(text: string): void {
    writeSync(2, text);
  },
};

let activeSink: OutputSink = defaultSink;

/** Replace the active sink (returns the previous one for restoration). */
export function setOutputSink(sink: OutputSink): OutputSink {
  const prev = activeSink;
  activeSink = sink;
  return prev;
}

export function getOutputSink(): OutputSink {
  return activeSink;
}

function writeLine(stream: 'out' | 'err', text: string): void {
  if (stream === 'out') activeSink.stdout(text + '\n');
  else activeSink.stderr(text + '\n');
}

export function heading(text: string): void {
  writeLine('out', `\n${c.bold}${c.cyan}${text}${c.reset}`);
}

export function success(text: string): void {
  writeLine('out', `${icon.ok} ${text}`);
}

export function warn(text: string): void {
  writeLine('out', `${icon.warn} ${c.yellow}${text}${c.reset}`);
}

export function error(text: string): void {
  writeLine('err', `${icon.err} ${c.red}${text}${c.reset}`);
}

export function info(text: string): void {
  writeLine('out', `${icon.info} ${text}`);
}

export function plain(text: string): void {
  writeLine('out', text);
}

export function dim(text: string): string {
  return `${c.dim}${text}${c.reset}`;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] ?? '').length)),
  );

  const header = headers.map((h, i) => h.padEnd(widths[i] ?? h.length)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('--');

  writeLine('out', `  ${c.bold}${header}${c.reset}`);
  writeLine('out', `  ${c.dim}${sep}${c.reset}`);

  for (const row of rows) {
    const line = row
      .map((cell, i) => {
        const stripped = stripAnsi(cell);
        const pad = (widths[i] ?? stripped.length) - stripped.length;
        return cell + ' '.repeat(Math.max(0, pad));
      })
      .join('  ');
    writeLine('out', `  ${line}`);
  }
}
