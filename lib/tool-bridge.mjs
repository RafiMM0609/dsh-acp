import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BRIDGE_TOOLS = [
  { name: 'dsh_list_tools', description: 'List the tools supplied by this DSH chat and their argument schemas.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'dsh_tool', description: 'Execute a tool supplied by this DSH chat, under its permissions. Discover names and argument schemas with dsh_list_tools.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name', 'arguments'], additionalProperties: false } },
];
export const BRIDGE_INSTRUCTIONS = 'DSH tools are available through dsh_list_tools and dsh_tool (possibly prefixed by the MCP server name). Discover their schemas and execute them through that bridge. The external agent owns the tool loop; wait for tool results and user decisions before continuing. Never invent a tool result.';
async function asContent(result, host, sessionId, signal) {
  const content = [];let remaining = 512 * 1024;
  for (const part of result.content || []) {
    if (part.type === 'image' && part.attachment && host.readImage) {
      const image = await host.readImage(sessionId, part.attachment, signal);
      content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
    } else {
      const raw = part.type === 'text' ? part.text : '[Non-text tool output]';
      const bounded = Buffer.from(raw).subarray(0, remaining).toString();
      remaining = Math.max(0, remaining - Buffer.byteLength(bounded));
      content.push({ type: 'text', text: bounded });
      if (!remaining) { content.push({ type: 'text', text: '[Tool output truncated; use a ranged read.]' });break; }
    }
  }
  if (result.concludesTurn) content.push({ type: 'text', text: 'The DSH tool concluded this turn. Summarize its result and finish without taking further actions.' });
  return { content, isError: Boolean(result.isError) };
}

/** Local, authenticated, per-chat capability bridge; inactive turns have no callable tools. */
export class ToolBridge {
  constructor(host) { this.host = host;this.bindings = new Map();this.server = null;this.starting = null; }
  async start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      this.server = createServer((req, res) => { this.handle(req, res).catch(error => { if (!res.headersSent) res.writeHead(500);res.end(JSON.stringify({ error: error.message })); }); });
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
      this.server.unref();
    });
    return this.starting;
  }
  async bind(daemon, sessionId) {
    await this.start();
    daemon.bindings ||= new Map();
    if (daemon.bindings.has(sessionId)) return daemon.bindings.get(sessionId);
    const token = randomBytes(32).toString('hex');
    const binding = { sessionId, token, active: null, closed: false,
      url: `http://127.0.0.1:${this.server.address().port}/mcp`,
      close: () => { binding.closed = true;binding.active = null;this.bindings.delete(token);daemon.bindings.delete(sessionId); },
      call: (name, args) => this.call(binding, name, args),
    };
    binding.mcpServer = { name: 'dsh', command: process.execPath,
      args: [fileURLToPath(new URL('./tool-bridge-stdio.mjs', import.meta.url))],
      env: [{ name: 'DSH_BRIDGE_URL', value: binding.url }, { name: 'DSH_BRIDGE_TOKEN', value: token }],
    };
    this.bindings.set(token, binding);daemon.bindings.set(sessionId, binding);
    // A pre-existing native session did not have the bridge registered.
    daemon.sessionMap.delete(sessionId);
    return binding;
  }
  async call(binding, name, args) {
    const active = binding.active;
    if (binding.closed || !active || active.signal.aborted) throw new Error('The requesting chat has no active tool capability');
    if (name === 'dsh_list_tools') return { content: [{ type: 'text', text: JSON.stringify(active.tools) }] };
    if (name !== 'dsh_tool' || !active.tools.some(t => t.name === args?.name)) throw new Error('Tool was not offered to this chat');
    if (active.inFlight >= 8) throw new Error('Too many concurrent DSH tool calls');
    active.inFlight++;
    active.pause?.();
    const id = `dsh-${active.nextId++}`;
    active.progress?.({ sessionUpdate: 'tool_call', toolCallId: id, title: args.name, status: 'in_progress' });
    try {
      const result = await this.host.execute(binding.sessionId, args.name, args.arguments, active.modelSelection, AbortSignal.any([active.signal, AbortSignal.timeout(900000)]));
      active.progress?.({ sessionUpdate: 'tool_call_update', toolCallId: id, title: args.name, status: result.isError ? 'failed' : 'completed' });
      if (result.concludesTurn) active.progress?.({ sessionUpdate: 'host_turn_concluded', content: { text: result.content.filter(c => c.type === 'text').map(c => c.text).join('\n') } });
      return asContent(result, this.host, binding.sessionId, active.signal);
    } catch (error) {
      active.progress?.({ sessionUpdate: 'tool_call_update', toolCallId: id, title: args.name, status: 'failed', content: [{ text: error.message }] });
      return { content: [{ type: 'text', text: error.message }], isError: true };
    } finally { active.inFlight--;active.resume?.(); }
  }
  async handle(req, res) {
    const token = req.headers.authorization?.replace(/^Bearer /, ''), binding = this.bindings.get(token);
    const json = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' });res.end(JSON.stringify(data)); };
    if (!binding || req.url !== '/mcp' || req.headers.origin) return json(401, { error: 'Unauthorized' });
    if (req.method !== 'POST') return json(405, { error: 'POST required' });
    let raw = '';for await (const part of req) { raw += part;if (Buffer.byteLength(raw) > 1024 * 1024) return json(413, { error: 'Request too large' }); }
    let message;try { message = JSON.parse(raw); } catch { return json(400, { error: 'Invalid JSON' }); }
    if (message.id === undefined) { res.writeHead(202);res.end();return; }
    try {
      let result;
      if (message.method === 'initialize') result = { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dsh-agent-tools', version: '0.3.0' } };
      else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list') result = { tools: BRIDGE_TOOLS };
      else if (message.method === 'tools/call') result = await binding.call(message.params?.name, message.params?.arguments);
      else if (['resources/list', 'prompts/list'].includes(message.method)) result = { [message.method.split('/')[0]]: [] };
      else throw new Error('Unsupported MCP method');
      json(200, { jsonrpc: '2.0', id: message.id, result });
    } catch (error) { json(200, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }); }
  }
  dispose() { for (const binding of [...this.bindings.values()]) binding.close();this.server?.closeAllConnections();this.server?.close(); }
}
