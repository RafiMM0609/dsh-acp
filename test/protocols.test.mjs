import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { AcpDaemon, MultiAcpAdapter } from '../lib/index.mjs';
import { protocolKind, piModelRoutes } from '../lib/protocol.mjs';
const fixture = fileURLToPath(new URL('./fixtures/protocol-agent.mjs', import.meta.url));
const engine = (protocol, mode, extra = {}) => ({ id: `custom-${protocol}`, protocol, command: process.execPath, args: [fixture],
  env: { TEST_PROTOCOL: protocol, TEST_MODE: mode || '' }, ...extra });
const options = (sessionId = 'a', extra = {}) => ({ sessionId, model: 'model-a', messages: [{ role: 'user', content: sessionId }], ...extra });
async function collect(stream) { const chunks = [];for await (const chunk of stream) chunks.push(chunk);return chunks; }
const answer = chunks => JSON.parse(chunks.find(c => c.type === 'text-delta' && c.text.startsWith('ANSWER:')).text.slice(7));
async function firstText(stream) { for (;;) { const c = await stream.next();assert.equal(c.done, false);if (c.value.type === 'text-delta') return; } }
for (const protocol of ['acp', 'pi', 'codex']) {
  test(`${protocol}: native tool progress and interleaved reasoning use valid output blocks`, { timeout: 5000 }, async () => {
    const d = new AcpDaemon(engine(protocol));
    try {
      const chunks = await collect(d.stream(options()));
      const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('');
      assert.match(text, /Tool completed: read/);assert.match(text, /Tool failed: read/);
      let open;
      for (const c of chunks) {
        if (c.type === 'block-start') { assert.equal(open, undefined);open = c.index; }
        if (c.type.endsWith('-delta')) assert.equal(c.index, open);
        if (c.type === 'block-end') { assert.equal(c.index, open);open = undefined; }
      }
      assert.equal(open, undefined);assert.equal(chunks.at(-1).type, 'finish');
    } finally { d.dispose(); }
  });
  test(`${protocol}: process death settles the stream and clears all state`, { timeout: 5000 }, async () => {
    const d = new AcpDaemon(engine(protocol, 'crash'));
    try {
      await assert.rejects(collect(d.stream(options())), /terminated unexpectedly/);
      assert.equal(d.pending.size, 0);assert.equal(d.activeTurnCompletedHandlers.size, 0);
      assert.equal(d.activePromptHandlers.size, 0);assert.equal(d.sessionMap.size, 0);assert.equal(d.activeCalls.size, 0);
    } finally { d.dispose(); }
  });
  test(`${protocol}: silent turns time out locally`, { timeout: 5000 }, async () => {
    const d = new AcpDaemon(engine(protocol, 'silent', { inactivityTimeoutMs: 250 }));
    try {
      await assert.rejects(collect(d.stream(options())), /no progress/);
      if (protocol === 'codex') await d.request('test/stats', {}); // Drain the independent interrupt acknowledgement.
      assert.equal(d.pending.size, 0);assert.equal(d.activeCalls.size, 0);assert.equal(d.activeTurnCompletedHandlers.size, 0);
    } finally { d.dispose(); }
  });
  test(`${protocol}: missing startup response times out and closes its process`, { timeout: 5000 }, async () => {
    const d = new AcpDaemon(engine(protocol, 'ignore-init', { requestTimeoutMs: 200 }));
    try { await assert.rejects(collect(d.stream(options())), /timed out/);assert.equal(d.pending.size, 0);assert.equal(d.child, null); }
    finally { d.dispose(); }
  });
  test(`${protocol}: unsupported interaction fails explicitly, including colliding request IDs`, { timeout: 5000 }, async () => {
    const d = new AcpDaemon(engine(protocol, 'approval'));
    try { await assert.rejects(collect(d.stream(options())), /not support/);assert.equal(d.activePromptHandlers.size, 0); }
    finally { d.dispose(); }
  });
  test(`${protocol}: errors never become successful finish events`, { timeout: 5000 }, async () => {
    const d = new AcpDaemon(engine(protocol, 'error'));
    try { await assert.rejects(collect(d.stream(options())), /test turn failure/); }
    finally { d.dispose(); }
  });
  test(`${protocol}: excessive output is bounded`, { timeout: 5000 }, async () => {
    const d = new AcpDaemon(engine(protocol, 'flood', { maxOutputBytes: 1000 }));
    try { await assert.rejects(collect(d.stream(options())), /buffer limit/);assert.equal(d.activePromptHandlers.size, 0); }
    finally { d.dispose(); }
  });
}
test('Pi chats retain their own history and model across A-B-A and parallel turns', { timeout: 5000 }, async () => {
  const adapter = new MultiAcpAdapter({ pi: engine('pi') });
  const chat = (id, model, text = id) => collect(adapter.stream({ provider: 'pi', ...options(id, { model, messages: [{ role: 'user', content: text }] }) }));
  try {
    const [a, b] = await Promise.all([chat('a', 'model-a', 'A-only'), chat('b', 'model-b', 'B-only')]);
    assert.notEqual(answer(a).pid, answer(b).pid);
    const again = answer(await chat('a', 'model-a', 'A-next'));
    assert.deepEqual(again.history, ['A-only', 'A-next']);assert.equal(again.model, 'model-a');
    assert.equal(adapter.getProviderDaemons('pi').length, 2);
  } finally { adapter.dispose(); }
});
test('same-chat overlapping turns are rejected before dispatch', { timeout: 5000 }, async () => {
  const d = new AcpDaemon(engine('pi', 'hang')), controller = new AbortController();
  const stream = d.stream(options('a', { signal: controller.signal }));
  try {
    await firstText(stream);
    await assert.rejects(collect(d.stream(options('a'))), /already has an active turn/);
    controller.abort();await assert.rejects(stream.next(), { name: 'AbortError' });
    assert.equal(d.child, null);
  } finally { await stream.return();d.dispose(); }
});
test('Pi model routes preserve provider identity and reject ambiguous IDs', { timeout: 5000 }, async () => {
  const d = new AcpDaemon(engine('pi', 'duplicates'));
  try {
    await assert.rejects(collect(d.stream(options())), /unavailable or ambiguous/);
    const chunks = await collect(d.stream(options('a', { model: 'two/model-a' })));
    assert.equal(answer(chunks).model, 'model-a');
    assert.deepEqual(piModelRoutes([{ id: 'same', provider: 'one' }, { id: 'same', provider: 'two' }]).map(m => m.routeId), ['one/same', 'two/same']);
  } finally { d.dispose(); }
});
test('failed model selection does not send a prompt using another model', { timeout: 5000 }, async () => {
  for (const protocol of ['acp', 'pi']) {
    const d = new AcpDaemon(engine(protocol, 'reject-model'));
    try {
      await assert.rejects(collect(d.stream(options('a', { model: 'model-b' }))), /model denied/);
      assert.equal((await d.request('test/stats', {})).promptCount, 0);
    } finally { d.dispose(); }
  }
});
test('late Pi responses cannot resolve a newer request with the same command', () => {
  const d = new AcpDaemon(engine('pi'));let resolved = false;
  d.pending.set(2, { type: 'prompt', resolve: () => { resolved = true; }, reject() {} });
  d.handleMessage({ type: 'response', id: 1, command: 'prompt', success: true });
  assert.equal(resolved, false);d.dispose();
});
test('oversized protocol frames fail instead of retaining an unbounded line buffer', { timeout: 5000 }, async () => {
  const d = new AcpDaemon(engine('codex', 'flood', { maxFrameBytes: 512 }));
  try { await assert.rejects(collect(d.stream(options())), /frame exceeded/);assert.equal(d.child, null); }
  finally { d.dispose(); }
});
test('idle daemon eviction and the process cap never evict active chats', { timeout: 5000 }, async () => {
  const adapter = new MultiAcpAdapter({ pi: engine('pi', 'hang') }, { maxDaemons: 1, idleTimeoutMs: 50 });
  const controller = new AbortController(), stream = adapter.stream({ provider: 'pi', ...options('a', { signal: controller.signal }) });
  try {
    await firstText(stream);adapter.pruneIdleDaemons(Date.now() + 10000);
    assert.equal(adapter.daemons.size, 1);
    await assert.rejects(collect(adapter.stream({ provider: 'pi', ...options('b') })), /processes are busy/);
    controller.abort();await assert.rejects(stream.next(), { name: 'AbortError' });
    adapter.pruneIdleDaemons(Date.now() + 10000);assert.equal(adapter.daemons.size, 0);
  } finally { await stream.return();adapter.dispose(); }
});
test('ACP session cap recycles an idle process without stale session IDs', { timeout: 5000 }, async () => {
  const d = new AcpDaemon(engine('acp', '', { maxSessions: 2 }));
  try {
    const a = answer(await collect(d.stream(options('a'))));
    await collect(d.stream(options('b')));
    const c = answer(await collect(d.stream(options('c'))));
    assert.notEqual(c.pid, a.pid);assert.equal(d.sessionMap.size, 1);
  } finally { d.dispose(); }
});
test('anonymous requests use short-lived processes without pooled conversation history', { timeout: 5000 }, async () => {
  const adapter = new MultiAcpAdapter({ pi: engine('pi') });
  try {
    const request = { provider: 'pi', model: 'model-a', messages: [{ role: 'user', content: 'one-shot' }] };
    const [a, b] = await Promise.all([collect(adapter.stream(request)), collect(adapter.stream(request))]);
    assert.notEqual(answer(a).pid, answer(b).pid);assert.equal(adapter.daemons.size, 0);
  } finally { adapter.dispose(); }
});
test('protocol inference supports provider presets and custom IDs', () => {
  assert.equal(protocolKind({ id: 'pi-personal', presetId: 'pi' }), 'pi');
  assert.equal(protocolKind({ id: 'custom', args: ['app-server'] }), 'codex');
  assert.equal(protocolKind({ id: 'custom', args: ['acp'] }), 'acp');
});

test('Stopping Pi chat A leaves parallel chat B alive', { timeout: 5000 }, async () => {
  const adapter = new MultiAcpAdapter({ pi: engine('pi', 'hang') });
  const a = new AbortController(), b = new AbortController();
  const sa = adapter.stream({ provider: 'pi', ...options('a', { signal: a.signal }) });
  const sb = adapter.stream({ provider: 'pi', ...options('b', { signal: b.signal }) });
  try {
    await Promise.all([firstText(sa), firstText(sb)]);
    const db = adapter.getDaemon('pi', process.cwd(), 'b');
    a.abort();await assert.rejects(sa.next(), { name: 'AbortError' });
    assert.equal(db.child.killed, false);assert.equal(db.activeCalls.has('b'), true);
    b.abort();await assert.rejects(sb.next(), { name: 'AbortError' });
    assert.equal(db.child, null);
  } finally { await sa.return();await sb.return();adapter.dispose(); }
});

test('classic Pi agent_end finishes after verifying the runtime is idle', { timeout: 5000 }, async () => {
  const d = new AcpDaemon(engine('pi', 'legacy-end'));
  try { assert.equal(answer(await collect(d.stream(options()))).model, 'model-a'); }
  finally { d.dispose(); }
});

test('cancelled shared processes retire after grace when no other chat is active', { timeout: 5000 }, async () => {
  const d = new AcpDaemon(engine('acp', 'hang')), controller = new AbortController();
  const stream = d.stream(options('a', { signal: controller.signal }));
  try {
    await firstText(stream);const exited = once(d.child, 'exit');
    controller.abort();await assert.rejects(stream.next(), { name: 'AbortError' });
    await exited;assert.equal(d.child, null);assert.equal(d.pending.size, 0);
  } finally { await stream.return();d.dispose(); }
});

test('Pi never prompts a previous session when new_session is cancelled', { timeout: 5000 }, async () => {
  const d = new AcpDaemon(engine('pi', 'cancel-new-session'));
  try {
    await assert.rejects(collect(d.stream(options())), /cancelled creation/);
    assert.equal((await d.requestPi('test/stats')).promptCount, 0);
  } finally { d.dispose(); }
});
