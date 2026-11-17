import readline from 'node:readline';

for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  let result;
  if (message.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: {} };
  else if (message.method === 'session/new') result = { sessionId: 'test-session',
    models: { availableModels: [{ modelId: 'reported-model', name: 'Reported model' }] } };
  else throw new Error(`Unexpected request ${message.method}; discovery must not send a prompt`);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
}
