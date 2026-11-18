/** Explicit wire protocol detection, including custom provider IDs. */
export function protocolKind(engine) {
  if (['acp', 'pi', 'codex'].includes(engine.protocol)) return engine.protocol;
  if (engine.args?.includes('app-server')) return 'codex';
  if (engine.args?.includes('rpc')) return 'pi';
  return ['pi', 'codex'].includes(engine.presetId || engine.id) ? (engine.presetId || engine.id) : 'acp';
}

export function piUpdate(event) {
  if (event.type === 'message_update') {
    const delta = event.assistantMessageEvent;
    if (delta?.type === 'text_delta' || delta?.type === 'thinking_delta') return {
      sessionUpdate: delta.type === 'text_delta' ? 'agent_message_chunk' : 'agent_thought_chunk', content: { text: delta.delta },
    };
  }
  if (['tool_execution_start', 'tool_execution_update', 'tool_execution_end'].includes(event.type)) return {
    sessionUpdate: event.type === 'tool_execution_start' ? 'tool_call' : 'tool_call_update',
    toolCallId: event.toolCallId, title: event.toolName,
    status: event.type === 'tool_execution_end' ? (event.isError ? 'failed' : 'completed') : 'in_progress',
    content: event.result?.content,
  };
  if (event.type === 'turn_end' && event.message?.usage) return { sessionUpdate: 'token_usage', usage: event.message.usage };
  return { sessionUpdate: 'heartbeat' };
}

export function codexUpdate(message) {
  const { method, params: p = {} } = message;
  if (method === 'item/agentMessage/delta') return { sessionUpdate: 'agent_message_chunk', content: { text: p.delta } };
  if (['item/reasoning/delta', 'item/reasoning/summaryTextDelta', 'item/reasoning/textDelta'].includes(method)) return {
    sessionUpdate: 'agent_thought_chunk', content: { text: p.delta },
  };
  if (method === 'thread/tokenUsage/updated') return { sessionUpdate: 'token_usage', usage: p.tokenUsage?.total };
  if (['item/started', 'item/completed'].includes(method) && p.item) {
    const item = p.item;
    if (!['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall', 'imageGeneration'].includes(item.type)) return { sessionUpdate: 'heartbeat' };
    const failed = ['failed', 'declined'].includes(item.status) || item.error || (item.exitCode != null && item.exitCode !== 0);
    return { sessionUpdate: method === 'item/started' ? 'tool_call' : 'tool_call_update', toolCallId: item.id,
      title: item.command || item.tool || item.type,
      status: method === 'item/started' ? 'in_progress' : failed ? 'failed' : 'completed',
      content: failed ? [{ text: item.error?.message || item.aggregatedOutput || '' }] : undefined };
  }
  // Output deltas still count as activity even when their content is not rendered.
  return { sessionUpdate: 'heartbeat' };
}

export function piModelRoutes(models) {
  const counts = new Map();
  for (const model of models) counts.set(model.id, (counts.get(model.id) || 0) + 1);
  return models.map(model => ({ ...model, routeId: counts.get(model.id) > 1 ? `${model.provider}/${model.id}` : model.id }));
}
