import readline from 'node:readline';
for await (const line of readline.createInterface({ input: process.stdin })) {
  let message;
  try {
    message = JSON.parse(line);
    const response = await fetch(process.env.DSH_BRIDGE_URL, { method: 'POST',
      headers: { authorization: `Bearer ${process.env.DSH_BRIDGE_TOKEN}`, 'content-type': 'application/json' }, body: line });
    if (message.id !== undefined) {
      if (!response.ok) throw new Error(`DSH tool bridge HTTP ${response.status}`);
      process.stdout.write(JSON.stringify(await response.json()) + '\n');
    }
  } catch (error) {
    if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }) + '\n');
  }
}
