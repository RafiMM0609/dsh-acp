import readline from 'node:readline';
const protocol = process.env.TEST_PROTOCOL;
const mode = process.env.TEST_MODE;
let history = [], model = 'model-a', nextSession = 0, promptCount = 0;
const sessions = new Map();
const send = data => process.stdout.write(JSON.stringify(data) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line), method = m.method || m.type;
  if (!method || method === 'initialized' || method === 'extension_ui_response') continue;
  const p = protocol === 'pi' ? m : m.params || {};
  const reply = data => send(protocol === 'pi' ? { type: 'response', id: m.id, command: method, success: true, data }
    : { jsonrpc: '2.0', id: m.id, result: data });
  const reject = error => send(protocol === 'pi' ? { type: 'response', id: m.id, command: method, success: false, error }
    : { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: error } });
  if (['initialize', 'get_available_models'].includes(method)) {
    if (mode === 'ignore-init') continue;
    if (method === 'get_available_models') reply({ models: mode === 'duplicates'
      ? [{ id: 'model-a', provider: 'one' }, { id: 'model-a', provider: 'two' }]
      : [{ id: 'model-a', provider: 'test' }, { id: 'model-b', provider: 'test' }] });
    else reply({});
  } else if (method === 'session/new' || method === 'thread/start') {
    const id = `session-${++nextSession}`;sessions.set(id, []);
    reply(protocol === 'codex' ? { thread: { id } } : { sessionId: id, configOptions: [
      { id: 'native-model-option', category: 'model', currentValue: model, options: [{ value: 'model-a' }, { value: 'model-b' }] },
      { id: 'native-effort-option', category: 'thought_level', currentValue: 'high', options: [{ value: 'high' }, { value: 'medium' }] },
    ] });
  } else if (method === 'new_session') { history = [];reply({ cancelled: mode === 'cancel-new-session' }); }
  else if (method === 'set_model') { if (mode === 'reject-model') reject('model denied'); else { model = p.modelId;reply({}); } }
  else if (method === 'set_thinking_level') reply({});
  else if (method === 'get_state') reply({ isStreaming: false, isCompacting: false });
  else if (method === 'session/set_config_option') {
    if (mode === 'reject-model') reject('model denied');
    else if (p.configId === 'native-model-option') { model = p.value;reply({}); }
    else if (p.configId === 'native-effort-option') reply({});
    else reject('wrong configuration ID');
  } else if (method === 'test/stats') reply({ promptCount });
  else if (['session/cancel', 'turn/interrupt', 'abort'].includes(method)) { if (m.id !== undefined) reply({}); }
  else if (['session/prompt', 'turn/start', 'prompt'].includes(method)) {
    promptCount++;
    const sid = protocol === 'pi' ? 'pi-session' : p.threadId || p.sessionId;
    const turnId = `turn-${promptCount}`;
    const text = protocol === 'pi' ? p.message : (p.input || p.prompt)?.[0]?.text;
    const current = protocol === 'pi' ? history : sessions.get(sid);
    current.push(text);
    if (protocol !== 'acp') reply(protocol === 'codex' ? { turn: { id: turnId, status: 'inProgress' } } : { disposition: 'started' });
    const update = (type, text) => {
      if (protocol === 'pi') send({ type: 'message_update', assistantMessageEvent: { type: type === 'thought' ? 'thinking_delta' : 'text_delta', delta: text } });
      else if (protocol === 'codex') send({ method: type === 'thought' ? 'item/reasoning/summaryTextDelta' : 'item/agentMessage/delta', params: { threadId: sid, turnId, delta: text } });
      else send({ method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: type === 'thought' ? 'agent_thought_chunk' : 'agent_message_chunk', content: { text } } } });
    };
    const tool = (id, status) => {
      if (protocol === 'pi') send({ type: status === 'in_progress' ? 'tool_execution_start' : 'tool_execution_end', toolCallId: id, toolName: 'read', isError: status === 'failed', result: { content: [{ type: 'text', text: 'failed tool' }] } });
      else if (protocol === 'codex') send({ method: status === 'in_progress' ? 'item/started' : 'item/completed', params: { threadId: sid, turnId, item: { id, type: 'commandExecution', command: 'read', status: status === 'in_progress' ? 'inProgress' : status, exitCode: status === 'failed' ? 1 : 0 } } });
      else send({ method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: status === 'in_progress' ? 'tool_call' : 'tool_call_update', toolCallId: id, title: 'read', status } } });
    };
    setTimeout(() => {
      if (mode === 'silent') return;
      update('text', 'started');
      if (mode === 'crash') { setTimeout(() => process.exit(1), 10);return; }
      if (mode === 'hang') return;
      if (mode === 'approval') {
        if (protocol === 'pi') send({ type: 'extension_ui_request', id: 'question', method: 'select', title: 'Choose', options: ['A', 'B'] });
        else send({ id: m.id, method: protocol === 'codex' ? 'item/commandExecution/requestApproval' : 'session/request_permission', params: { sessionId: sid, threadId: sid, options: [] } });
        return;
      }
      if (mode === 'flood') { update('text', 'x'.repeat(2000));return; }
      if (mode === 'error') {
        if (protocol === 'pi') send({ type: 'turn_end', message: { stopReason: 'error', errorMessage: 'test turn failure' } });
        else if (protocol === 'codex') send({ method: 'turn/completed', params: { threadId: sid, turn: { status: 'failed', error: { message: 'test turn failure' } } } });
        else reject('test turn failure');
        return;
      }
      update('thought', 'thinking');tool('ok', 'in_progress');tool('ok', 'completed');
      update('thought', 'thinking again');tool('bad', 'in_progress');tool('bad', 'failed');
      update('text', 'ANSWER:' + JSON.stringify({ pid: process.pid, model, history: current }));
      if (protocol === 'pi') send(mode === 'legacy-end' ? { type: 'agent_end', messages: [] } : { type: 'agent_settled', aborted: false });
      else if (protocol === 'codex') send({ method: 'turn/completed', params: { threadId: sid, turn: { id: turnId, status: 'completed' } } });
      else reply({ stopReason: 'end_turn' });
    }, 15);
  } else reject(`Unexpected command ${method}`);
}
