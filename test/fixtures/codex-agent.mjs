import readline from 'node:readline';

let initialized = false;
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.method === 'initialized') { initialized = true; continue; }
  if (message.method !== 'initialize' && !initialized) throw new Error('Missing initialized notification');
  let result;
  if (message.method === 'initialize') {
    if (!message.params.capabilities) throw new Error('Missing Codex capabilities');
    result = { userAgent: 'test-codex/1.0', codexHome: '/tmp/.codex' };
  } else if (message.method === 'model/list') {
    result = {
      data: [
        { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', modelContextWindow: 475000 },
        { id: 'gpt-6-astra', displayName: 'GPT-6-Astra', modelContextWindow: 475000 },
      ],
    };
  } else if (message.method === 'thread/start') {
    result = { thread: { id: 'test-thread-id', model: 'gpt-6.1-sol' } };
  } else if (message.method === 'turn/start') {
    if (message.params.effort !== 'medium') throw new Error('Missing turn effort');
    result = { turn: { id: 'test-turn-id', status: 'inProgress' } };
    setTimeout(() => {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { threadId: message.params.threadId, turnId: 'test-turn-id', delta: 'PONG' },
      }) + '\n');
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId: message.params.threadId, turn: { id: 'test-turn-id', status: 'completed' } },
      }) + '\n');
    }, 10);
  } else {
    throw new Error(`Unexpected request ${message.method}`);
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
}
