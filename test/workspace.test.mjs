import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { AcpDaemon, MultiAcpAdapter, apply } from '../lib/index.mjs';
import { createAcpWebHandler } from '../lib/web-ui.mjs';
const engine = { id: 'workspace', name: 'Workspace test', command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/workspace-agent.mjs', import.meta.url))], env: {} };
function workspace(marker) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh workspace '));
  fs.writeFileSync(path.join(dir, 'marker.txt'), marker);
  return dir;
}
function removeWorkspace(dir) { fs.unlinkSync(path.join(dir, 'marker.txt')); fs.rmdirSync(dir); }
async function chat(adapter, sessionId, extra = {}) {
  const chunks = [];
  for await (const chunk of adapter.stream({ provider: 'workspace', model: 'test-model', sessionId,
    messages: [{ role: 'user', content: 'Read marker.txt' }], ...extra })) chunks.push(chunk);
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text);
  return { result: JSON.parse(text.find(part => part.startsWith('{'))), text: text.join('') };
}
test('DSH session metadata selects the process workspace; parallel workspaces stay separate', { timeout: 5000 }, async () => {
  const a = workspace('workspace-A'), b = workspace('workspace-B');
  const serverCwd = process.cwd();
  let adapter;
  const cleanups = [];
  apply({
    get(key) { return key === 'sessions' ? { get: id => ({ header: { cwd: id === 'a' ? a : b } }) } : undefined; },
    llm: { registerAdapter(_keys, value) { adapter = value; return () => {}; } },
    inject() {}, effect(fn) { cleanups.push(fn()); },
  }, { engines: { workspace: engine } });
  try {
    const [resultA, resultB] = await Promise.all([chat(adapter, 'a'), chat(adapter, 'b')]);
    assert.equal(resultA.result.marker, 'workspace-A');
    assert.equal(resultB.result.marker, 'workspace-B');
    assert.notEqual(resultA.result.pid, resultB.result.pid);
    assert.equal(resultA.result.cwd.toLowerCase(), a.toLowerCase());
    assert.equal(process.cwd(), serverCwd, 'DSH global cwd must stay unchanged');
    assert.equal((await chat(adapter, 'a')).result.pid, resultA.result.pid, 'same workspace reuses its process');
    assert.equal(adapter.getProviderDaemons('workspace').length, 2);
    assert.match(resultA.text, /Tool in_progress: Read marker.txt/);
    assert.match(resultA.text, /Tool completed: Read marker.txt/);
    assert.match(resultA.text, /Tool failed: Read absent.txt/);
    assert.match(resultA.text, /File not found: absent.txt/);
  } finally {
    const exits = adapter.getProviderDaemons('workspace').filter(d => d.child).map(d => once(d.child, 'exit'));
    for (const cleanup of cleanups) cleanup();
    await Promise.all(exits);
    removeWorkspace(a); removeWorkspace(b);
  }
});
test('provider status aggregates workspace processes and restart disposes all of them', { timeout: 5000 }, async () => {
  const a = workspace('A'), b = workspace('B');
  const adapter = new MultiAcpAdapter({ workspace: engine, other: { ...engine, id: 'other' } });
  const handler = createAcpWebHandler({ adapter });
  const server = createServer(handler);server.listen(0, '127.0.0.1');await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/acp`;
  try {
    await Promise.all([chat(adapter, 'a', { cwd: a }), chat(adapter, 'b', { cwd: b })]);
    adapter.getDaemon('other', a);
    const data = await (await fetch(`${base}/engines`)).json();
    assert.equal(data.engines.find(e => e.id === 'workspace').daemon.processCount, 2);
    const exits = adapter.getProviderDaemons('workspace').map(d => once(d.child, 'exit'));
    const response = await fetch(`${base}/restart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'workspace' }) });
    assert.equal((await response.json()).ping.ok, true);
    await Promise.all(exits);
    assert.equal(adapter.getProviderDaemons('workspace').length, 0);
    assert.equal(adapter.getProviderDaemons('other').length, 1);
  } finally { adapter.dispose(); await new Promise(resolve => server.close(resolve)); removeWorkspace(a); removeWorkspace(b); }
});
test('a daemon cannot silently reuse a process from another workspace', async () => {
  const d = new AcpDaemon(engine, os.tmpdir());
  await assert.rejects(d.getOrCreateAcpSession('a', process.cwd()), /another workspace/);
  assert.equal(d.child, null);
});
