import readline from 'node:readline';
const protocol = process.env.TEST_PROTOCOL, action = process.env.TEST_ACTION;
const callbacks = new Map();let bridge;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line), method = m.method || m.type;
  if (callbacks.has(m.id) && (!m.method || m.type === 'extension_ui_response')) {
    const callback = callbacks.get(m.id);callbacks.delete(m.id);callback(m.result || m);continue;
  }
  if (!method || method === 'initialized') continue;
  const p = protocol === 'pi' ? m : m.params || {};
  const reply = result => send(protocol === 'pi' ? { type: 'response', id: m.id, command: method, success: true, data: result } : { jsonrpc: '2.0', id: m.id, result });
  if (method === 'initialize') reply({});
  else if (method === 'get_available_models') reply({ models: [{ id: 'model', provider: 'test' }] });
  else if (method === 'new_session' || method === 'set_model' || method === 'set_thinking_level' || method === 'session/set_model') reply({});
  else if (method === 'thread/start') {
    bridge = p.dynamicTools?.some(t => t.name === 'dsh_tool');reply({ thread: { id: 'native-session' } });
  } else if (method === 'session/new') { bridge = p.mcpServers?.[0];reply({ sessionId: 'native-session' }); }
  else if (['session/prompt', 'turn/start', 'prompt'].includes(method)) {
    if (protocol !== 'acp') reply(protocol === 'pi' ? { disposition: 'started' } : { turn: { id: 'turn' } });
    const finish = value => {
      const text = 'HOST_RESULT:' + JSON.stringify(value);
      if (protocol === 'pi') { send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });send({ type: 'agent_settled' }); }
      else if (protocol === 'codex') { send({ method: 'item/agentMessage/delta', params: { threadId: 'native-session', delta: text } });send({ method: 'turn/completed', params: { threadId: 'native-session', turn: { status: 'completed' } } }); }
      else { send({ method: 'session/update', params: { sessionId: 'native-session', update: { sessionUpdate: 'agent_message_chunk', content: { text } } } });reply({ stopReason: 'end_turn' }); }
    };
    const request = (method, params) => { callbacks.set('server-request', finish);send({ jsonrpc: '2.0', id: 'server-request', method, params: { sessionId: 'native-session', threadId: 'native-session', ...params } }); };
    if (action === 'bridge') {
      if (protocol === 'codex') {
        if (!bridge) throw new Error('Missing dynamic tool registration');
        request('item/tool/call', { tool: 'dsh_tool', arguments: { name: 'echo', arguments: { value: 'BRIDGE_OK' } } });
      } else {
        const env = protocol === 'pi' ? process.env : Object.fromEntries(bridge.env.map(e => [e.name, e.value]));
        fetch(env.DSH_BRIDGE_URL, { method: 'POST', headers: { authorization: `Bearer ${env.DSH_BRIDGE_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'dsh_tool', arguments: { name: 'echo', arguments: { value: 'BRIDGE_OK' } } } }) }).then(r => r.json()).then(finish).catch(error => finish({ error: error.message }));
      }
    } else if (protocol === 'pi') {
      callbacks.set('server-request', finish);
      send({ type: 'extension_ui_request', id: 'server-request', method: action === 'ask' ? 'select' : 'confirm', title: 'Choose action', message: 'Read file', options: ['A', 'B'] });
    } else if (protocol === 'codex') {
      request(action === 'ask' ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval', { command: 'read', questions: [{ id: 'q', question: 'Choose', options: [{ label: 'A' }, { label: 'B' }] }] });
    } else request('session/request_permission', { toolCall: { toolCallId: action === 'ask' ? 'interaction_q' : 'read', title: 'Choose action' }, options: [{ kind: 'allow_once', optionId: 'A', name: 'A' }, { kind: 'reject_once', optionId: 'B', name: 'B' }] });
  } else if (['abort', 'session/cancel', 'turn/interrupt'].includes(method)) { if (m.id !== undefined) reply({}); }
}
