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
