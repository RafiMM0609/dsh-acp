import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
let session = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  const reply = result => send({ jsonrpc: '2.0', id: message.id, result });
  if (message.method === 'initialize') reply({});
  else if (message.method === 'session/new') {
    if (path.resolve(message.params.cwd) !== process.cwd()) throw new Error('Process cwd differs from session workspace');
    reply({ sessionId: `session-${++session}` });
  } else if (['session/set_config_option', 'session/set_model'].includes(message.method)) reply({});
  else if (message.method === 'session/prompt') {
    const update = value => send({ method: 'session/update', params: { sessionId: message.params.sessionId, update: value } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Read marker.txt', status: 'in_progress' });
    const marker = fs.readFileSync('marker.txt', 'utf8');
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'read', status: 'completed' });
    update({ sessionUpdate: 'tool_call', toolCallId: 'missing', title: 'Read absent.txt', status: 'in_progress' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'missing', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'File not found: absent.txt' } }] });
    update({ sessionUpdate: 'agent_message_chunk', content: { text: JSON.stringify({ cwd: process.cwd(), pid: process.pid, marker }) } });
    reply({ stopReason: 'end_turn' });
  } else throw new Error(`Unexpected method ${message.method}`);
}
