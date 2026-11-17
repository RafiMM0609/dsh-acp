import readline from 'node:readline';

for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.type === 'get_available_models') {
    process.stdout.write(JSON.stringify({
      id: message.id,
      type: 'response',
      command: 'get_available_models',
      success: true,
      data: { models: [{ id: 'pi-model-1', name: 'Pi Model 1', provider: 'test-prov' }] },
    }) + '\n');
  } else if (message.type === 'set_model') {
    process.stdout.write(JSON.stringify({
      id: message.id,
      type: 'response',
      command: 'set_model',
      success: true,
      data: { id: message.modelId, provider: message.provider },
    }) + '\n');
  } else if (message.type === 'set_thinking_level') {
    process.stdout.write(JSON.stringify({
      id: message.id,
      type: 'response',
      command: 'set_thinking_level',
      success: true,
    }) + '\n');
  } else if (message.type === 'new_session') {
    process.stdout.write(JSON.stringify({
      id: message.id,
      type: 'response',
      command: 'new_session',
      success: true,
      data: { cancelled: false },
    }) + '\n');
  } else if (message.type === 'prompt') {
    process.stdout.write(JSON.stringify({
      id: message.id,
      type: 'response',
      command: 'prompt',
      success: true,
      data: { disposition: 'started' },
    }) + '\n');
    process.stdout.write(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'Thinking...' },
    }) + '\n');
    process.stdout.write(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Echo: ' + message.message },
    }) + '\n');
    process.stdout.write(JSON.stringify({
      type: 'turn_end',
      message: { role: 'assistant', content: [], usage: { input: 10, output: 5, reasoning: 2 } },
    }) + '\n');
    process.stdout.write(JSON.stringify({
      type: 'agent_settled',
      aborted: false,
    }) + '\n');
  }
}
