import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** Resolve a user-entered path on the host running DSH, without shell expansion. */
export function expandHome(value, home = os.homedir()) {
  if (value === '~') return home;
  if (/^~[/\\]/.test(value)) return path.join(home, value.slice(2));
  return value;
}

/** Abbreviate only paths contained in the host home, preserving executable names. */
export function compactHome(value, home = os.homedir()) {
  const normalize = s => s.replaceAll('\\', '/').replace(/\/$/, '');
  const input = normalize(value);
  const root = normalize(home);
  const fold = s => process.platform === 'win32' ? s.toLowerCase() : s;
  if (fold(input) === fold(root)) return '~';
  if (fold(input).startsWith(fold(root) + '/')) return '~/' + input.slice(root.length + 1);
  return value;
}

/** Expand agent configuration directories before passing them to a child process. */
export function expandAgentEnv(env = {}, home = os.homedir()) {
  const directoryKeys = new Set(['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'ANTIGRAVITY_HOME', 'MUSE_CONFIG_DIR']);
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    key, directoryKeys.has(key.toUpperCase()) && typeof value === 'string' ? expandHome(value, home) : value,
  ]));
}

/** Run npm's Node entry point directly instead of spawning its Unix/Windows shim. */
export function resolveAgentLaunch(command, args = [], platform = process.platform) {
  command = expandHome(command);
  if (platform !== 'win32') return { command, args };
  let shim = command;
  if (!path.isAbsolute(shim)) {
    try {
      shim = execFileSync('where.exe', [shim], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim().split(/\r?\n/)[0];
    } catch { return { command, args }; }
  }
  const cmdShim = /\.cmd$/i.test(shim) ? shim : shim + '.cmd';
  try {
    const source = fs.readFileSync(cmdShim, 'utf8');
    const target = source.match(/"%dp0%[\\/]([^"\r\n]+\.(?:js|mjs|cjs))"/i)?.[1];
    if (target) {
      const entry = path.resolve(path.dirname(cmdShim), target);
      if (fs.existsSync(entry)) return { command: process.execPath, args: [entry, ...args] };
    }
  } catch {}
  return { command: fs.existsSync(cmdShim) ? cmdShim : command, args };
}
