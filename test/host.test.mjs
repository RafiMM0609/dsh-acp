import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { once } from 'node:events';
import { MultiAcpAdapter } from '../lib/index.mjs';
import { createDshHost, answerInteraction } from '../lib/host.mjs';
import { ToolBridge } from '../lib/tool-bridge.mjs';
const fixture = fileURLToPath(new URL('./fixtures/host-agent.mjs', import.meta.url));
const tool = { name: 'echo', description: 'Echo text', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } };
async function collect(stream) { const chunks = [];for await (const chunk of stream) chunks.push(chunk);return chunks; }
const resultOf = chunks => JSON.parse(chunks.find(c => c.type === 'text-delta' && c.text.startsWith('HOST_RESULT:')).text.slice(12));
const config = (protocol, action, extra = {}) => ({ id: protocol, protocol, command: process.execPath, args: [fixture], env: { TEST_PROTOCOL: protocol, TEST_ACTION: action }, ...extra });
for (const protocol of ['acp', 'pi', 'codex']) {
  for (const action of ['approve', 'ask', 'bridge']) {
    test(`${protocol}: ${action} round-trip reaches only its DSH chat`, { timeout: 5000 }, async () => {
      const calls = [];
      const host = {
        async approve(id) { calls.push(['approve', id]);return 'allowed-once'; },
        async ask(id, questions) { calls.push(['ask', id]);return { answers: questions.map(q => ({ id: q.id, selected: ['B'] })) }; },
        async execute(id, name, args) { calls.push(['execute', id, name]);return { content: [{ type: 'text', text: args.value }], isError: false }; },
      };
      const adapter = new MultiAcpAdapter({ test: config(protocol, action) }, { host });
      try {
        const chunks = await collect(adapter.stream({ provider: 'test', sessionId: 'chat-A', model: 'model', tools: [tool], messages: [{ role: 'user', content: 'test' }] }));
        const result = resultOf(chunks);
        assert.equal(calls.length, 1);assert.equal(calls[0][1], 'chat-A');
        if (action === 'bridge') assert.match(JSON.stringify(result), /BRIDGE_OK/);
        else if (protocol === 'acp') assert.equal(result.outcome.optionId, action === 'ask' ? 'B' : 'A');
        else if (protocol === 'pi') assert.equal(action === 'ask' ? result.value : result.confirmed, action === 'ask' ? 'B' : true);
        else if (action === 'ask') assert.deepEqual(result.answers.q.answers, ['B']);
        else assert.equal(result.decision, 'accept');
      } finally { adapter.dispose(); }
    });
  }
  test(`${protocol}: slow human decisions pause inactivity timeout; Stop cancels them`, { timeout: 5000 }, async () => {
    let asked, release;
    const request = new Promise(resolve => { asked = resolve; });
    const host = { approve(_id, _detail, signal) { asked(signal);return new Promise(resolve => { release = resolve; }); } };
    const adapter = new MultiAcpAdapter({ test: config(protocol, 'approve', { inactivityTimeoutMs: 300 }) }, { host });
    const controller = new AbortController();
    const stream = adapter.stream({ provider: 'test', sessionId: 'a', model: 'model', messages: [{ role: 'user', content: 'test' }], signal: controller.signal });
    const pending = collect(stream);
    try {
      const signal = await request;
      await new Promise(resolve => setTimeout(resolve, 350));assert.equal(signal.aborted, false);
      controller.abort();await assert.rejects(pending, { name: 'AbortError' });
      assert.equal(signal.aborted, true);release('allowed-once');
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(adapter.getProviderDaemons('test')[0]?.clientRequests.size || 0, 0);
    } finally { release?.('cancelled');adapter.dispose(); }
  });
}
test('ACP cannot promote a one-shot grant to allow_always', async () => {
  let asked = false;
  const result = await answerInteraction({ approve() { asked = true;return 'allowed-once'; } }, 'a', 'acp', { method: 'session/request_permission', params: { options: [{ kind: 'allow_always', optionId: 'always' }] } });
  assert.equal(asked, false);assert.equal(result.outcome.outcome, 'cancelled');
});
test('the DSH host uses scoped services, tool admission, and executor guards', async () => {
  let disposed = false, invoked;
  const tools = { async resolve(context) { assert.equal(context.agent, agent);return { dispose() { disposed = true; } }; }, async execute(input) { invoked = input;return { results: [{ result: { content: [{ type: 'text', text: 'guarded' }], isError: false } }], additionalContexts: [] }; } };
  const agent = { ctx: { get: key => key === 'tools' ? tools : undefined }, session: {}, inject() {} };
  const host = createDshHost({ get: key => key === 'agents' ? { get: id => id === 'A' ? agent : undefined } : undefined });
  assert.equal((await host.execute('A', 'echo', {}, {}, new AbortController().signal)).content[0].text, 'guarded');
  assert.equal(invoked.agent, agent);assert.equal(disposed, true);
  await assert.rejects(host.execute('B', 'echo', {}, {}, new AbortController().signal), /no longer active/);
});
test('MCP credentials are chat-scoped, revoked on close, and cannot call unoffered tools', async () => {
  const hub = new ToolBridge({ async execute() { throw new Error('must not run'); } });
  const daemon = { sessionMap: new Map() }, binding = await hub.bind(daemon, 'A');
  binding.active = { signal: new AbortController().signal, tools: [tool], inFlight: 0, nextId: 0 };
  const call = async (token, name) => fetch(binding.url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'dsh_tool', arguments: { name, arguments: {} } } }) });
  try {
    assert.equal((await call('wrong', 'echo')).status, 401);
    assert.match(JSON.stringify(await (await call(binding.token, 'forbidden')).json()), /not offered/);
    binding.close();assert.equal((await call(binding.token, 'echo')).status, 401);
  } finally { hub.dispose(); }
});
test('the stdio MCP helper forwards authenticated protocol requests', { timeout: 5000 }, async () => {
  const hub = new ToolBridge({});const binding = await hub.bind({ sessionMap: new Map() }, 'A');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../lib/tool-bridge-stdio.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DSH_BRIDGE_URL: binding.url, DSH_BRIDGE_TOKEN: binding.token } });
  const lines = readline.createInterface({ input: child.stdout });
  try {
    const response = once(lines, 'line');child.stdin.write(JSON.stringify({ id: 1, method: 'tools/list' }) + '\n');
    assert.deepEqual(JSON.parse((await response)[0]).result.tools.map(t => t.name), ['dsh_list_tools', 'dsh_tool']);
  } finally { lines.close();child.kill();hub.dispose(); }
});

test('a DSH tool can conclude the outer turn without waiting for another native model response', { timeout: 5000 }, async () => {
  const adapter = new MultiAcpAdapter({ test: config('codex', 'bridge') }, { host: { async execute() { return { content: [{ type: 'text', text: 'PLAN_ACCEPTED' }], isError: false, concludesTurn: true }; } } });
  try {
    const chunks = await collect(adapter.stream({ provider: 'test', sessionId: 'A', model: 'model', tools: [tool], messages: [{ role: 'user', content: 'test' }] }));
    assert.match(chunks.filter(c => c.type === 'text-delta').map(c => c.text).join(''), /PLAN_ACCEPTED/);
    assert.equal(chunks.at(-1).type, 'finish');assert.equal(adapter.getProviderDaemons('test')[0].sessionMap.has('A'), false);
  } finally { adapter.dispose(); }
});
