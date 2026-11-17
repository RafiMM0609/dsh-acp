import readline from 'node:readline';

for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.type === 'get_available_models') {
    process.stdout.write(JSON.stringify({
      type: 'response',
      command: 'get_available_models',
      success: true,
      data: { models: [{ id: 'pi-model-1', name: 'Pi Model 1', provider: 'test-prov' }] },
    }) + '\n');
  }
}
