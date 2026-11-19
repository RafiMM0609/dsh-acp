import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function userHistory(messages) {
  const users = messages.filter(m => m.role === 'user').map(m => m.content);
  return { userCount: users.length, userDigest: digest(users), matches: record => record?.userCount === users.length - 1 && digest(users.slice(0, record.userCount)) === record.userDigest };
}
export function nativeKey(engine, provider, cwd, sessionId) {
  return digest({ provider, cwd, sessionId, command: engine.command, args: engine.args, protocol: engine.protocol,
    env: Object.fromEntries(Object.entries(engine.env || {}).sort(([a], [b]) => a.localeCompare(b))) });
}
/** Bounded local references only: credentials, prompts and tool results are never stored here. */
export class NativeSessions {
  constructor(file) { this.file = file;this.rows = {};this.loaded = false; }
  load() {
    if (this.loaded) return;this.loaded = true;
    try {
      if (fs.statSync(this.file).size > 1024 * 1024) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed.version === 1 && parsed.rows && typeof parsed.rows === 'object') this.rows = parsed.rows;
    } catch {}
  }
  get(key) { this.load();const row = this.rows[key];return row?.savedAt > Date.now() - 30 * 86400000 ? row : undefined; }
  set(key, value) {
    this.load();this.rows[key] = { ...value, savedAt: Date.now() };
    this.rows = Object.fromEntries(Object.entries(this.rows).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 200));
    this.save();
  }
  delete(key) { this.load();delete this.rows[key];this.save(); }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify({ version: 1, rows: this.rows }), { mode: 0o600 });fs.renameSync(temporary, this.file); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
  }
}
