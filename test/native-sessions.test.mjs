import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MultiAcpAdapter } from '../lib/index.mjs';
import { NativeSessions, nativeKey, userHistory } from '../lib/native-sessions.mjs';
const fixture = fileURLToPath(new URL('./fixtures/resume-agent.mjs', import.meta.url));
async function collect(stream) { const chunks = [];for await (const c of stream) chunks.push(c);return JSON.parse(chunks.find(c => c.type === 'text-delta' && c.text.startsWith('NATIVE:')).text.slice(7)); }
for (const protocol of ['acp', 'pi', 'codex']) {
  test(`${protocol}: resumes native context across restarts and rejects forked history`, { timeout: 8000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-native-'));
    const storeFile = path.join(dir, 'refs.json'), nativeFile = path.join(dir, 'native.json');
    const engine = { id: protocol, protocol, command: process.execPath, args: [fixture], env: { TEST_PROTOCOL: protocol, TEST_NATIVE_FILE: nativeFile } };
    const host = { maintenance(_id, fn) { return fn(new AbortController().signal); } };
    const make = () => new MultiAcpAdapter({ test: engine }, { host, nativeStore: new NativeSessions(storeFile) });
    const chat = (a, messages) => collect(a.stream({ provider: 'test', sessionId: 'chat', model: 'model', messages }));
    let adapter = make();
    try {
      const first = await chat(adapter, [{ role: 'user', content: 'one' }]);adapter.dispose();
      adapter = make();
      const second = await chat(adapter, [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'two' }]);
      assert.equal(second.resumed, true);assert.equal(second.id, first.id);assert.deepEqual(second.history, ['one', 'two']);
      assert.equal(adapter.nativeSessions('test')[0].resumable, true);
      await adapter.controlSession('test', 'chat', 'compact');
      const forked = await chat(adapter, [{ role: 'user', content: 'changed' }, { role: 'user', content: 'three' }]);
      assert.notEqual(forked.id, first.id);assert.equal(forked.resumed, false);
      await adapter.controlSession('test', 'chat', 'rebuild');assert.equal(adapter.nativeSessions('test').length, 0);
    } finally {
      adapter.dispose();for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));fs.rmdirSync(dir);
    }
  });
  test(`${protocol}: transports image attachments in the native format`, { timeout: 5000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-image-'));
    const engine = { id: protocol, protocol, command: process.execPath, args: [fixture], env: { TEST_PROTOCOL: protocol, TEST_NATIVE_FILE: path.join(dir, 'native.json') } };
    const adapter = new MultiAcpAdapter({ test: engine }, { host: { async readImage(id, ref) { assert.equal(id, 'chat');assert.equal(ref.attachmentId, 'image');return { data: 'aGVsbG8=', mimeType: 'image/png' }; } } });
    try {
      const result = await collect(adapter.stream({ provider: 'test', sessionId: 'chat', model: 'model', messages: [{ role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image', attachment: { attachmentId: 'image' } }] }] }));
      assert.equal(result.images, 1);
    } finally { adapter.dispose();for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));fs.rmdirSync(dir); }
  });
}
test('native references never persist credentials and auxiliary calls cannot reuse a chat process', async () => {
  const key = nativeKey({ command: 'cli', args: [], env: { TOKEN: 'secret' } }, 'p', '/workspace', 'a');
  assert.equal(key.includes('secret'), false);
  assert.notEqual(key, nativeKey({ command: 'cli', args: [], env: { TOKEN: 'other' } }, 'p', '/workspace', 'a'));
  const a = userHistory([{ role: 'user', content: 'a' }]);
  assert.equal(userHistory([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]).matches(a), true);
  assert.equal(userHistory([{ role: 'user', content: 'a' }]).matches(a), false);
});
