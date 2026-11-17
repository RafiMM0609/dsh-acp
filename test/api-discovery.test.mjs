import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

    // Test stream with mock Pi agent
    const daemon = new AcpDaemon({
      id: 'pi', name: 'Pi Agent', command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/pi-agent.mjs', import.meta.url))], env: {},
    });
    let collectedText = '';
    let collectedThought = '';
    for await (const chunk of daemon.stream({
      provider: 'pi',
      model: 'pi-model-1',
      messages: [{ role: 'user', content: 'Hello Pi' }],
    })) {
      if (chunk.type === 'text-delta') collectedText += chunk.text;
      if (chunk.type === 'reasoning-delta') collectedThought += chunk.text;
    }
    assert.equal(collectedThought, 'Thinking...');
    assert.equal(collectedText, 'Echo: Hello Pi');
    daemon.dispose();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('model discovery and streaming handles Codex JSON-RPC app-server protocol', async () => {
  const handler = createAcpWebHandler({
    createDaemon(engine) {
      return new AcpDaemon(engine);
    },
  });
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const fixturePath = fileURLToPath(new URL('./fixtures/codex-agent.mjs', import.meta.url));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acp/discover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        id: 'codex', name: 'Codex', command: process.execPath,
        args: [fixturePath], env: {},
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.models[0].id, 'gpt-6.1-sol');
    assert.equal(data.models[0].name, 'GPT-6.1-Sol');
    assert.equal(data.models[1].id, 'gpt-6-astra');

    // Test stream with mock codex agent
    const daemon = new AcpDaemon({
      id: 'codex', name: 'Codex', command: process.execPath,
      args: [fixturePath], env: {},
    });
    let collectedText = '';
    for await (const chunk of daemon.stream({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'Say PONG' }],
    })) {
      if (chunk.type === 'text-delta') collectedText += chunk.text;
    }
    assert.equal(collectedText, 'PONG');
    daemon.dispose();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Pi discovery runs npm Windows shims from absolute paths containing spaces', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi shim regression '));
  const entry = path.join(dir, 'agent.mjs');
  const shim = path.join(dir, 'pi.cmd');
  fs.copyFileSync(fileURLToPath(new URL('./fixtures/pi-agent.mjs', import.meta.url)), entry);
  fs.writeFileSync(shim, '@echo off\r\n"%_prog%" "%dp0%\\agent.mjs" %*\r\n');
  try {
    for (const command of [path.join(dir, 'pi'), shim]) {
      const daemon = new AcpDaemon({ id: 'pi', command, args: ['--mode', 'rpc'], env: {} });
      try {
        assert.equal((await daemon.discoverModels('pi'))[0]?.id, 'pi-model-1');
      } finally { daemon.dispose(); }
    }
  } finally {
    fs.unlinkSync(entry);
    fs.unlinkSync(shim);
    fs.rmdirSync(dir);
  }
});
