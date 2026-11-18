import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AcpDaemon } from '../lib/index.mjs';
const fixture = fileURLToPath(new URL('./fixtures/cancel-agent.mjs', import.meta.url));
function daemon(protocol, extra = {}) {
  return new AcpDaemon({ id: protocol, command: process.execPath, args: [fixture],
    env: { TEST_PROTOCOL: protocol, ...extra } });
}
const options = signal => ({ sessionId: 'chat-a', model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }], signal });
async function firstText(stream) {
  for (;;) {
    const chunk = await stream.next();
    assert.equal(chunk.done, false);
    if (chunk.value.type === 'text-delta') return;
  }
}
for (const protocol of ['acp', 'codex']) {
  test(`${protocol}: Stop settles locally when agent never completes its cancelled turn`, { timeout: 5000 }, async () => {
    const d = daemon(protocol);
    const controller = new AbortController();
    const stream = d.stream(options(controller.signal));
    try {
      await firstText(stream);
      const blocked = stream.next();
      controller.abort();
      await assert.rejects(blocked, { name: 'AbortError' });
      assert.equal(d.activePromptHandlers.size, 0);
      assert.equal(d.activeTurnCompletedHandlers.size, 0);
      assert.equal(d.sessionMap.has('chat-a'), false);
      const calls = await d.request('test/cancellations', {});
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, protocol === 'codex' ? 'turn/interrupt' : 'session/cancel');
      assert.equal(calls[0].params[protocol === 'codex' ? 'threadId' : 'sessionId'], 'session-1');
      if (protocol === 'codex') {
        assert.ok(Object.hasOwn(calls[0], 'id'), 'interrupt must be a request');
        assert.equal(calls[0].params.turnId, 'turn-1');
      }
      assert.equal(d.pending.size, 0);
      // A cancelled generation is recycled once no other chat is using it.
      assert.equal((await d.getOrCreateAcpSession('chat-a')).acpSessionId, 'session-1');
    } finally { await stream.return(); d.dispose(); }
  });
}
test('Stop before dispatch does not start an agent', async () => {
  const d = daemon('acp');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(d.stream(options(controller.signal)).next(), { name: 'AbortError' });
  assert.equal(d.child, null);
});
test('Codex Stop before turn/start reply releases the pending request and completion waiter', { timeout: 5000 }, async () => {
  const d = daemon('codex', { TEST_HANG_START: '1' });
  const controller = new AbortController();
  const stream = d.stream(options(controller.signal));
  try {
    await firstText(stream);
    controller.abort();
    await assert.rejects(stream.next(), { name: 'AbortError' });
    assert.equal(d.pending.size, 0);
    assert.equal(d.activePromptHandlers.size, 0);
    assert.equal(d.activeTurnCompletedHandlers.size, 0);
  } finally { await stream.return(); d.dispose(); }
});
test('Codex interrupt request expires when the agent ignores it', { timeout: 5000 }, async () => {
  const d = daemon('codex', { TEST_IGNORE_INTERRUPT: '1' });
  const controller = new AbortController();
  const stream = d.stream(options(controller.signal));
  try {
    await firstText(stream);
    controller.abort();
    await assert.rejects(stream.next(), { name: 'AbortError' });
    assert.equal(d.activePromptHandlers.size, 0);
    assert.equal(d.activeTurnCompletedHandlers.size, 0);
    await new Promise(resolve => setTimeout(resolve, 2100));
    assert.equal(d.pending.size, 0);
  } finally { await stream.return(); d.dispose(); }
});

test('Stopping one chat preserves another chat on the shared provider process', { timeout: 5000 }, async () => {
  const d = daemon('codex');
  const a = new AbortController();
  const b = new AbortController();
  const streamA = d.stream(options(a.signal));
  const streamB = d.stream({ ...options(b.signal), sessionId: 'chat-b' });
  try {
    await firstText(streamA);
    await firstText(streamB);
    const child = d.child;
    a.abort();
    await assert.rejects(streamA.next(), { name: 'AbortError' });
    const sessionB = d.sessionMap.get('chat-b').acpSessionId;
    assert.equal(d.child, child);
    assert.equal(child.killed, false);
    assert.equal(d.activePromptHandlers.has(sessionB), true);
    assert.equal(d.activeTurnCompletedHandlers.has(sessionB), true);
    b.abort();
    await assert.rejects(streamB.next(), { name: 'AbortError' });
  } finally { await streamA.return(); await streamB.return(); d.dispose(); }
});
