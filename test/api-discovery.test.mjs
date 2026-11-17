import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AcpDaemon } from '../lib/index.mjs';
import { createAcpWebHandler } from '../lib/web-ui.mjs';

test('model discovery makes ACP requests and disposes the temporary agent', async () => {
  let disposed = false;
  let childExit;
  const handler = createAcpWebHandler({
    createDaemon(engine) {
      const daemon = new AcpDaemon(engine);
      const dispose = daemon.dispose.bind(daemon);
      daemon.dispose = () => {
        disposed = true;
        if (daemon.child) childExit = once(daemon.child, 'exit');
        dispose();
      };
      return daemon;
    },
  });
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acp/discover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        id: 'fixture', name: 'Fixture', command: process.execPath,
        args: [fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url))], env: {},
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.models[0].id, 'reported-model');
    assert.equal(disposed, true);
    assert.ok(childExit);
    await childExit;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('model discovery handles Pi RPC protocol', async () => {
  const handler = createAcpWebHandler({
    createDaemon(engine) {
      return new AcpDaemon(engine);
    },
  });
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acp/discover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        id: 'pi', name: 'Pi Agent', command: process.execPath,
        args: [fileURLToPath(new URL('./fixtures/pi-agent.mjs', import.meta.url))], env: {},
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.models[0].id, 'pi-model-1');
    assert.equal(data.models[0].name, 'Pi Model 1');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
