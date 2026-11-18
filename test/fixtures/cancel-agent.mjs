import readline from 'node:readline';
const codex = process.env.TEST_PROTOCOL === 'codex';
const cancellations = [];
let session = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  const reply = result => send({ jsonrpc: '2.0', id: message.id, result });
  if (message.method === 'initialize') reply({});
  else if (message.method === 'initialized') continue;
  else if (message.method === 'session/new') reply({ sessionId: `session-${++session}` });
  else if (message.method === 'thread/start') reply({ thread: { id: `session-${++session}` } });
  else if (['session/set_config_option', 'session/set_model'].includes(message.method)) reply({});
  else if (message.method === 'session/prompt' || message.method === 'turn/start') {
    if (codex && !process.env.TEST_HANG_START) reply({ turn: { id: 'turn-1' } });
    setTimeout(() => send(codex ? {
      method: 'item/agentMessage/delta', params: { threadId: message.params.threadId, delta: 'started' },
    } : {
      method: 'session/update', params: { sessionId: message.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { text: 'started' } } },
    }), 10);
    // Deliberately never complete the prompt, including after cancellation.
  } else if (message.method === 'session/cancel' || message.method === 'turn/interrupt') {
    cancellations.push(message);
    if (codex && !process.env.TEST_IGNORE_INTERRUPT) reply({});
  } else if (message.method === 'test/cancellations') reply(cancellations);
  else throw new Error(`Unexpected method ${message.method}`);
}
