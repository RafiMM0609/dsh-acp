import fs from 'node:fs';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
const protocol = process.env.TEST_PROTOCOL, file = process.env.TEST_NATIVE_FILE;
let rows = {};try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
let current, resumed = false;
const send = data => process.stdout.write(JSON.stringify(data) + '\n');
const config = () => ({ configOptions: [{ id: 'model', category: 'model', currentValue: 'model', options: [{ value: 'model' }] }] });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line), method = m.method || m.type, p = protocol === 'pi' ? m : m.params || {};
  const reply = result => send(protocol === 'pi' ? { type: 'response', id: m.id, command: method, success: true, data: result } : { id: m.id, result });
  if (!method || method === 'initialized') continue;
  if (method === 'initialize') reply({ agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } });
  else if (method === 'get_available_models') reply({ models: [{ id: 'model', provider: 'test' }] });
  else if (['session/new', 'thread/start', 'new_session'].includes(method)) {
    current = randomUUID();rows[current] = [];resumed = false;
    if (method === 'session/new') reply({ sessionId: current, ...config() });
    else if (method === 'thread/start') reply({ thread: { id: current } });
    else reply({ cancelled: false });
  } else if (['session/load', 'thread/resume', 'switch_session'].includes(method)) {
    current = p.sessionId || p.threadId || p.sessionPath.split('#').at(-1);resumed = true;
    if (!rows[current]) { send({ id: m.id, error: { message: 'Missing native history' } });continue; }
    if (method === 'thread/resume') reply({ thread: { id: current } });else reply(config());
  } else if (['session/set_model', 'session/set_config_option', 'set_model', 'set_thinking_level'].includes(method)) reply({});
  else if (method === 'get_state') reply({ sessionFile: `${file}#${current}`, isStreaming: false });
  else if (method === 'compact') reply({ compacted: true });
  else if (method === 'thread/compact/start') { reply({});send({ method: 'thread/compacted', params: { threadId: p.threadId } }); }
  else if (['session/prompt', 'turn/start', 'prompt'].includes(method)) {
    current = p.sessionId || p.threadId || current;
    const input = p.input || p.prompt;
    const message = protocol === 'pi' ? p.message : input[0].text;
    if (message === '/compact') { reply({ stopReason: 'end_turn' });continue; }
    rows[current].push(message);fs.writeFileSync(file, JSON.stringify(rows));
    const text = 'NATIVE:' + JSON.stringify({ id: current, history: rows[current], resumed, images: protocol === 'pi' ? (p.images || []).length : input.filter(v => v.type === 'image').length });
    if (protocol === 'pi') { reply({ disposition: 'started' });send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });send({ type: 'agent_settled' }); }
    else if (protocol === 'codex') { reply({ turn: { id: 'turn' } });send({ method: 'item/agentMessage/delta', params: { threadId: current, delta: text } });send({ method: 'turn/completed', params: { threadId: current, turn: { status: 'completed' } } }); }
    else {
      send({ method: 'session/update', params: { sessionId: current, update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact' }] } } });
      send({ method: 'session/update', params: { sessionId: current, update: { sessionUpdate: 'agent_message_chunk', content: { text } } } });reply({ stopReason: 'end_turn' });
    }
  }
}
