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

test('native Settings editor loads, validates, saves, toggles and disposes 3-step wizard', async () => {
  let plugin;
  const calls = [];
  const engine = {
    id: 'example', name: 'Example ACP', command: '~/bin/agent', args: ['acp'],
    configDirVar: 'CONFIG_DIR', configDir: '~/.config', accentColor: '#3b82f6',
    env: { API_TOKEN: 'existing-token' },
    models: [{ id: 'sample', name: 'Sample model', contextWindow: 200000 }],
    daemon: { running: false }, disabled: false,
  };
  const data = {
    ok: true,
    hostname: 'test-host',
    engines: [engine],
    presets: [
      { id: 'codex', name: 'Codex', command: 'codex', args: ['app-server'], configDirVar: 'CODEX_HOME', defaultConfigDir: '~/.codex', infoCallout: 'Codex note', models: [] },
      { id: 'claude', name: 'Claude', command: 'claude', args: ['acp'], configDirVar: 'CLAUDE_CONFIG_DIR', defaultConfigDir: '~/.claude', infoCallout: 'Claude note', models: [] },
      { id: 'custom', name: 'Custom provider', command: '', args: ['--stdio'], configDirVar: 'CONFIG_DIR', defaultConfigDir: '', models: [] },
    ],
    installedScan: [{ id: 'example', installed: true, resolvedPath: '~/bin/detected-agent' }],
  };
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
    const button = [...document.querySelectorAll('button, .dsh-acp-step, .dsh-acp-preset-card')].filter(node => node.textContent.includes(text))[index];
    assert.ok(button, `element with text "${text}" exists`);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  };
  const input = async (label, value) => {
    const node = [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select');
    assert.ok(node, `input for label "${label}" exists`);
    await act(async () => {
      const prototype = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype
        : node.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      node.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  };
  const submit = async () => act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));

  try {
    await act(async () => root.render(React.createElement(component)));
    assert.match(document.body.textContent, /Example ACP/);
    assert.equal(document.querySelector('iframe'), null);

    // 1. Edit existing provider -> Opens at Step 2 (Identity)
    await click('Edit');
    assert.ok(document.querySelector('.dsh-acp-wizard-dialog'));
    assert.match(document.querySelector('.dsh-acp-dialog-title').textContent, /Edit provider/);
    assert.match(document.querySelector('.dsh-acp-dialog-subtitle').textContent, /test-host/);

    // Verify Identity fields
    const labelInput = [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === 'Label')?.querySelector('input');
    assert.equal(labelInput.value, 'Example ACP');
    const idInput = [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === 'Instance ID')?.querySelector('input');
    assert.equal(idInput.disabled, true); // Instance ID disabled when editing

    // Navigate to Step 3 (Config) via 'Next' button
    await click('Next');
    assert.ok(document.querySelector('.dsh-acp-models-section'));
    assert.equal(document.querySelector('details').open, false);

    // Model validation test on Step 3
    await click('Add model manually');
    await submit();
    assert.ok(document.querySelector('[role="alert"]'));
    assert.equal(calls.filter(call => call.url.endsWith('/save')).length, 0);

    // Fix empty model and configure args
    await click('Remove model', 1);
    await click('Add argument');
    await input('Argument 2', '--debug');
    await click('Detect executable');
    await input('Binary path', '~/bin/custom-agent');
    await input('CONFIG_DIR path', '~/.custom-config');
    await input('Auto-compact after', '400000');
    await input('Compact idle threads', 'after-return');

    // Load models from agent via discovery
    await click('Load models from agent');
    const modelChoice = document.querySelector('input[type="checkbox"]');
    assert.ok(modelChoice);
    await act(async () => modelChoice.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));

    // Add env variable in Advanced section
    await click('Add variable');
    const variableInputs = [...document.querySelectorAll('label')].filter(node => node.querySelector('span')?.textContent === 'Variable name');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(variableInputs[1].querySelector('input'), 'EXTRA');
      variableInputs[1].querySelector('input').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });

    // Navigate back to Step 2 (Identity) and update Label
    await click('Back');
    await input('Label', 'Edited ACP');

    // Return to Step 3 and save
    await click('Next');
    await submit();

    const saved = calls.find(call => call.url.endsWith('/save'));
    assert.ok(saved);
    assert.equal(saved.body.name, 'Edited ACP');
    assert.equal(saved.body.command, '~/bin/custom-agent');
    assert.equal(saved.body.configDir, '~/.custom-config');
    assert.equal(saved.body.env.CONFIG_DIR, '~/.custom-config');
    assert.equal(saved.body.env.API_TOKEN, 'existing-token');
    assert.equal(saved.body.env.EXTRA, '');
    assert.equal(saved.body.models[0].contextWindow, 200000);
    assert.equal(saved.body.models[1].id, 'discovered');
    assert.match(document.body.textContent, /Edited ACP/);

    // 2. Test Toggle enable/disable
    await click('Disable');
    assert.deepEqual(calls.find(call => call.url.endsWith('/toggle')).body, { id: 'example', disabled: true });
    assert.ok([...document.querySelectorAll('button')].find(node => node.textContent === 'Enable'));

    // 3. Test Add Provider 3-step wizard flow
    await click('Add provider');
    assert.ok(document.querySelector('.dsh-acp-wizard-dialog'));
    assert.match(document.querySelector('.dsh-acp-dialog-title').textContent, /Add provider/);

    // Step 1: Provider selection
    assert.ok(document.querySelector('.dsh-acp-presets-grid'));
    assert.match(document.body.textContent, /Codex/);
    assert.match(document.body.textContent, /Claude/);

    // Select Claude preset
    await click('Claude');
    assert.ok(document.querySelector('.dsh-acp-preset-card.selected'));
    assert.match(document.querySelector('.dsh-acp-callout').textContent, /Claude note/);

    // Advance to Step 2 (Identity)
    await click('Continue');

    // Verify Step 2 pre-filled values
    const newLabel = [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === 'Label')?.querySelector('input');
    assert.equal(newLabel.value, 'Claude');
    await input('Label', 'Claude 3.7 Work');
    await input('Instance ID', 'claude-work');

    // Advance to Step 3 (Config)
    await click('Next');

    // Verify Step 3 pre-filled from preset
    const binaryInput = [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === 'Binary path')?.querySelector('input');
    assert.equal(binaryInput.value, 'claude');
    const configDirInput = [...document.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === 'CLAUDE_CONFIG_DIR path')?.querySelector('input');
    assert.equal(configDirInput.value, '~/.claude');

    // Submit new provider
    await submit();

    const added = calls.filter(call => call.url.endsWith('/save'))[1];
    assert.ok(added);
    assert.equal(added.body.id, 'claude-work');
    assert.equal(added.body.name, 'Claude 3.7 Work');
    assert.equal(added.body.command, 'claude');
    assert.equal(added.body.env.CLAUDE_CONFIG_DIR, '~/.claude');
  } finally {
    await act(async () => root.unmount());
    for (const dispose of disposers.reverse()) dispose?.();
    assert.equal(component, undefined);
    assert.equal(document.querySelector('style'), null);
  }
});
