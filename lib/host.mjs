import { randomUUID } from 'node:crypto';

/** Bind every operation to the requesting DSH agent and its own services/policies. */
export function createDshHost(ctx) {
  const agentFor = sessionId => {
    const agent = ctx.get('agents')?.get(sessionId);
    if (!agent) throw new Error('The requesting DSH chat is no longer active');
    return agent;
  };
  const serviceFor = (agent, name) => agent.ctx?.get(name) || ctx.get(name);
  return {
    async approve(sessionId, detail, signal) {
      const agent = agentFor(sessionId), approval = serviceFor(agent, 'approval');
      if (!approval) throw new Error('DSH approval service is unavailable');
      return approval.request({ agent, toolName: detail.toolName || 'external-agent', reason: detail.reason, signal });
    },
    async ask(sessionId, questions, signal) {
      const agent = agentFor(sessionId), service = serviceFor(agent, 'userQuestions');
      if (!service) throw new Error('DSH user-question service is unavailable');
      return service.ask({ agent, questions, signal });
    },
    async readImage(sessionId, ref, signal) {
      const agent = agentFor(sessionId), attachments = serviceFor(agent, 'attachments');
      if (!attachments) throw new Error('DSH attachment service is unavailable');
      if (ref.bytes > 8 * 1024 * 1024) throw new Error('Image exceeds the 8 MiB bridge limit');
      const image = await attachments.readImage(ref, signal);
      if (image.data.byteLength > 8 * 1024 * 1024) throw new Error('Image exceeds the 8 MiB bridge limit');
      return { data: Buffer.from(image.data).toString('base64'), mimeType: image.mediaType || ref.mediaType };
    },
    async maintenance(sessionId, action) { return agentFor(sessionId).runMaintenance(action); },
    async execute(sessionId, tool, args, modelSelection, signal) {
      const agent = agentFor(sessionId), tools = serviceFor(agent, 'tools');
      if (!tools) throw new Error('DSH tool service is unavailable');
      const toolSet = await tools.resolve({ agent, modelSelection, signal });
      try {
        const batch = await tools.execute({ agent, signal, toolSet,
          calls: [{ type: 'tool-call', id: `external-${randomUUID()}`, name: tool, arguments: JSON.stringify(args) }] });
        const result = batch.results[0]?.result;
        if (!result) throw new Error('DSH tool executor returned no result');
        for (const message of batch.additionalContexts || []) agent.inject(message);
        return { content: result.content, isError: result.isError, concludesTurn: batch.concluded };
      } finally { toolSet.dispose(); }
    },
  };
}

const review = (...values) => { const result = values.map(v => typeof v === 'string' ? v : JSON.stringify(v ?? '')).join('\n');if (result.length > 16000) throw new Error('Approval detail is too large to review safely');return result; };
const text = (value, size = 12000) => typeof value === 'string' ? value.slice(0, size) : JSON.stringify(value ?? '').slice(0, size);
function question(id, title, options) {
  if (options?.length > 50) throw new Error('Too many interaction choices');
  return { id: String(id), question: text(title), ...(options?.length ? { options: options.map(o => ({ label: text(typeof o === 'string' ? o : o.label), ...(o.description ? { description: text(o.description) } : {}) })) } : {}) };
}
function chosen(answer, id) {
  const item = answer?.answers?.find(item => item.id === String(id));
  return item ? [...(item.selected || []), ...(item.custom ? [item.custom] : [])] : [];
}

/** Translate wire interactions without broadening a one-shot decision into a persistent grant. */
export async function answerInteraction(host, sessionId, protocol, request, signal) {
  const p = request.params || request;
  const method = request.method;
  if (protocol === 'pi') {
    if (method === 'confirm') {
      const outcome = await host.approve(sessionId, { toolName: 'pi-confirm', reason: review(p.title, p.message) }, signal);
      return { type: 'extension_ui_response', id: p.id, confirmed: outcome === 'allowed-once' };
    }
    if (!['select', 'input', 'editor'].includes(method)) throw new Error(`Unsupported Pi interaction: ${method}`);
    const answer = await host.ask(sessionId, [question(p.id, p.title, p.options)], signal);
    const values = chosen(answer, p.id);
    if (!values.length) return { type: 'extension_ui_response', id: p.id, cancelled: true };
    if (method === 'select' && !p.options?.includes(values[0])) throw new Error('The selected Pi option was not offered');
    return { type: 'extension_ui_response', id: p.id, value: values[0] };
  }
  if (protocol === 'acp' && method === 'session/request_permission') {
    const options = p.options || [];
    if (new Set(options.map(o => o.optionId)).size !== options.length || options.length > 50) throw new Error('Invalid ACP permission choices');
    if (p.toolCall?.toolCallId?.startsWith('interaction_')) {
      const id = p.toolCall.toolCallId;
      const answer = await host.ask(sessionId, [question(id, p.toolCall.title || 'Choose an option', options.map(o => o.name))], signal);
      const values = chosen(answer, id);
      const option = options.find(o => o.name === values[0]);
      return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
    }
    // An allow_always option cannot represent DSH's one-shot approval outcome.
    const allow = options.find(o => o.kind === 'allow_once');
    if (!allow) return { outcome: { outcome: 'cancelled' } };
    const outcome = await host.approve(sessionId, { toolName: p.toolCall?.title || 'ACP tool',
      reason: review(p.toolCall?.title, p.toolCall?.rawInput || '') }, signal);
    const option = outcome === 'allowed-once' ? allow : options.find(o => o.kind === 'reject_once');
    return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
  }
  if (protocol === 'codex' && method === 'item/tool/requestUserInput') {
    const questions = p.questions || [];
    if (!questions.length || questions.length > 20 || questions.some(q => q.isSecret)) throw new Error('Unsupported Codex question batch');
    const answer = await host.ask(sessionId, questions.map(q => question(q.id, q.question, q.options)), signal);
    return { answers: Object.fromEntries(questions.map(q => [q.id, { answers: chosen(answer, q.id) }])) };
  }
  if (protocol === 'codex' && method === 'item/permissions/requestApproval') {
    const outcome = await host.approve(sessionId, { toolName: 'Codex turn permissions', reason: review('Grant the following permissions for this Codex turn only:', p.reason || '', p.permissions) }, signal);
    const requested = p.permissions || {};
    return { permissions: outcome === 'allowed-once' ? {
      ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {}), ...(requested.network ? { network: requested.network } : {}),
    } : {}, scope: 'turn', strictAutoReview: true };
  }
  if (protocol === 'codex' && ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'execCommandApproval', 'applyPatchApproval'].includes(method)) {
    const outcome = await host.approve(sessionId, { toolName: text(p.command || (method.includes('file') || method === 'applyPatchApproval' ? 'Codex file edit' : 'Codex command'), 512),
      reason: review(p.reason || '', p.command || p.changes || '') }, signal);
    const allowed = outcome === 'allowed-once' && (!p.availableDecisions || p.availableDecisions.includes('accept'));
    return { decision: ['execCommandApproval', 'applyPatchApproval'].includes(method) ? (allowed ? 'approved' : 'denied') : (allowed ? 'accept' : 'decline') };
  }
  throw new Error(`Unsupported agent interaction: ${method}`);
}
