import { Type } from '@earendil-works/pi-ai';
export default function(pi) {
  const call = async (name, args, signal) => {
    const response = await fetch(process.env.DSH_BRIDGE_URL, { method: 'POST', signal,
      headers: { authorization: `Bearer ${process.env.DSH_BRIDGE_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    if (!response.ok) throw new Error(`DSH tool bridge HTTP ${response.status}`);
    const message = await response.json();if (message.error) throw new Error(message.error.message);
    return { ...message.result, details: {} };
  };
  pi.registerCommand('dsh-tool', { description: 'Run a DSH tool: /dsh-tool name JSON_arguments',
    handler: async (input, ctx) => {
      const match = input.trim().match(/^(\S+)(?:\s+([\s\S]+))?$/);
      if (!match) throw new Error('Usage: /dsh-tool name JSON_arguments');
      const result = await call('dsh_tool', { name: match[1], arguments: JSON.parse(match[2] || '{}') });
      ctx.ui.notify(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 4000), result.isError ? 'error' : 'info');
    },
  });
  pi.registerTool({ name: 'dsh_list_tools', label: 'DSH tools', description: 'List tools and argument schemas supplied by this DSH chat.',
    parameters: Type.Object({}), execute: (_id, args, signal) => call('dsh_list_tools', args, signal) });
  pi.registerTool({ name: 'dsh_tool', label: 'Run DSH tool', description: 'Execute a DSH tool under this chat permissions. Discover schemas using dsh_list_tools.',
    parameters: Type.Object({ name: Type.String(), arguments: Type.Record(Type.String(), Type.Unknown()) }),
    execute: (_id, args, signal) => call('dsh_tool', args, signal) });
}
