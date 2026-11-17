import assert from 'node:assert/strict';
import test from 'node:test';
import { expandHome, compactHome, expandAgentEnv } from '../lib/paths.mjs';
import { AcpDaemon } from '../lib/index.mjs';

test('home paths round-trip and leave unrelated paths and command names unchanged', () => {
  const home = process.platform === 'win32' ? 'C:\\Users\\example' : '/home/example';
  const expanded = expandHome('~/tools/agent', home);
  assert.equal(compactHome(expanded, home), '~/tools/agent');
  assert.equal(compactHome(home, home), '~');
  assert.equal(expandHome('agy', home), 'agy');
  assert.equal(expandHome('~another/agent', home), '~another/agent');
  assert.equal(compactHome(`${home}-other/agent`, home), `${home}-other/agent`);
});

test('discovery reads grouped model options and legacy ACP model catalogs', async () => {
  const daemon = new AcpDaemon({ id: 'test', name: 'Test agent' });
  daemon.getOrCreateAcpSession = async () => ({
    configOptions: [{ category: 'model', id: 'model-choice', options: [
      { value: 'model-one', name: 'First model' },
      { group: 'More models', options: [{ value: 'model-two', name: 'Second model' }] },
    ] }], availableModels: [],
  });
  assert.deepEqual((await daemon.discoverModels('test')).map(model => model.id), ['model-one', 'model-two']);
  daemon.getOrCreateAcpSession = async () => ({ configOptions: [], availableModels: [{ modelId: 'legacy', name: 'Legacy model' }] });
  assert.equal((await daemon.discoverModels('test'))[0].id, 'legacy');
});

test('agent config directories expand without altering unrelated environment values', () => {
  const home = process.platform === 'win32' ? 'C:\\Users\\example' : '/home/example';
  const env = { CODEX_HOME: '~/.codex', CLAUDE_CONFIG_DIR: '~\\.claude', PI_CODING_AGENT_DIR: '~/.pi/agent', NOTE: '~/literal', TOKEN: 'unchanged' };
  const expanded = expandAgentEnv(env, home);
  assert.equal(expanded.CODEX_HOME, expandHome('~/.codex', home));
  assert.equal(expanded.CLAUDE_CONFIG_DIR, expandHome('~/.claude', home));
  assert.equal(expanded.PI_CODING_AGENT_DIR, expandHome('~/.pi/agent', home));
  assert.equal(expanded.NOTE, env.NOTE);
  assert.equal(expanded.TOKEN, env.TOKEN);
  assert.equal(env.CODEX_HOME, '~/.codex');
});
