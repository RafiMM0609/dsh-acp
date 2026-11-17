import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Use the adjacent DSH checkout's React and DOM test dependencies.
const require = createRequire(new URL('../../deepseek-harness/packages/client/ui-renderer/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><head></head><body><div id="root"></div></body>', { url: 'http://localhost:3080/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

test('native Settings editor loads, validates, saves, toggles and disposes', async () => {
  let plugin;
  const calls = [];
  const engine = { id: 'example', name: 'Example ACP', command: '~/bin/agent', args: ['acp'], env: { API_TOKEN: 'existing-token' },
    models: [{ id: 'sample', name: 'Sample model', contextWindow: 200000 }], daemon: { running: false }, disabled: false };
  const data = { ok: true, engines: [engine], presets: [{ id: 'example', name: 'Example ACP', command: 'agent', args: ['acp'], models: [] }],
    installedScan: [{ id: 'example', installed: true, resolvedPath: '~/bin/detected-agent' }] };
  const fetch = async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith('/discover')) return { ok: true, json: async () => ({ ok: true, models: [{ id: 'discovered', name: 'Discovered model' }] }) };
    if (url.endsWith('/save')) Object.assign(engine, body);
    if (url.endsWith('/toggle')) engine.disabled = body.disabled;
    return { ok: true, json: async () => data };
  };
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: registration => { plugin = registration.factory(() => React); } }, confirm: () => true },
    document, fetch, AbortController,
  });
  const disposers = [];
  let component;
  plugin.apply({
    effect(callback) { const dispose = callback(); disposers.push(dispose); return dispose; },
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.section'); return callback(); },
      register(options, value) {
        assert.equal(options.id, 'acp-providers'); component = value;
        return () => { component = undefined; };
      },
    },
  });
  const root = createRoot(document.getElementById('root'));
  const click = async (text, index = 0) => {
    const button = [...document.querySelectorAll('button')].filter(node => node.textContent === text)[index];
    assert.ok(button, `button ${text} exists`);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  };
  const input = async (label, value) => {
    const node = [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label).querySelector('input,textarea');
    await act(async () => {
      const prototype = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const submit = async () => act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  try {
    await act(async () => root.render(React.createElement(component)));
    assert.match(document.body.textContent, /Example ACP/);
    assert.equal(document.querySelector('iframe'), null);
    await click('Edit');
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(document.querySelector('details').open, false);
    assert.equal([...document.querySelectorAll('label')].some(node => node.textContent.includes('Engine ID')), false);
    await click('Add model manually');
    await submit();
    assert.ok(document.querySelector('[role="alert"]'));
    assert.equal(calls.filter(call => call.url.endsWith('/save')).length, 0);
    await click('Remove model', 1);
    await click('Add argument');
    await input('Argument 2', '--debug');
    await click('Detect executable');
    await input('Executable', '~/bin/custom-agent');
    await click('Load models from agent');
    const modelChoice = document.querySelector('input[type="checkbox"]');
    await act(async () => modelChoice.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await click('Add variable');
    const variableInputs = [...document.querySelectorAll('label')].filter(node => node.querySelector('span')?.textContent === 'Variable name');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(variableInputs[1].querySelector('input'), 'EXTRA');
      variableInputs[1].querySelector('input').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await input('Display name', 'Edited ACP');
    await submit();
    const saved = calls.find(call => call.url.endsWith('/save'));
    assert.deepEqual(saved.body.args, ['acp', '--debug']);
    assert.equal(saved.body.name, 'Edited ACP');
    assert.equal(saved.body.command, '~/bin/custom-agent');
    assert.equal(saved.body.env.API_TOKEN, 'existing-token');
    assert.equal(saved.body.env.EXTRA, '');
    assert.equal(saved.body.models[0].contextWindow, 200000);
    assert.equal(saved.body.models[1].id, 'discovered');
    assert.match(document.body.textContent, /Edited ACP/);
    await click('Disable');
    assert.deepEqual(calls.find(call => call.url.endsWith('/toggle')).body, { id: 'example', disabled: true });
    assert.ok([...document.querySelectorAll('button')].find(node => node.textContent === 'Enable'));
    await click('Add provider');
    await input('Display name', 'Example');
    await input('Executable', 'new-agent');
    await submit();
    const added = calls.filter(call => call.url.endsWith('/save'))[1];
    assert.equal(added.body.id, 'example-2');
    assert.deepEqual(added.body.models, []);
  } finally {
    await act(async () => root.unmount());
    for (const dispose of disposers.reverse()) dispose?.();
    assert.equal(component, undefined);
    assert.equal(document.querySelector('style'), null);
  }
});
