/**
 * Management API for the native DSH ACP Settings panel.
 *
 * Tests, configures, and reloads ACP provider engines for the browser plugin.
 *
 * @module dsh-plugin-antigravity-acp/web-ui
 */

import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stopAgentProcess } from './process.mjs';
import { protocolKind } from './protocol.mjs';
import { expandHome, compactHome, expandAgentEnv, resolveAgentLaunch } from './paths.mjs';

const CONFIG_FILE_PATH = path.join(os.homedir(), '.dsh', 'acp-engines.json');

/**
 * Standard templates for popular ACP-compatible engines.
 */
export const ENGINE_PRESETS = [
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex Coding Agent via stdio JSON-RPC app-server',
    command: 'codex',
    args: ['app-server'],
    configDirVar: 'CODEX_HOME',
    defaultConfigDir: '~/.codex',
    infoCallout: 'We do not recommend managing multiple Codex accounts in T3 Code.',
    env: {},
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', contextWindow: 475000, defaultEffort: 'medium' },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra', contextWindow: 475000, defaultEffort: 'low' },
      { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', contextWindow: 475000, defaultEffort: 'low' },
    ],
  },
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude Code CLI via Agent Client Protocol',
    command: 'claude',
    args: ['acp'],
    configDirVar: 'CLAUDE_CONFIG_DIR',
    defaultConfigDir: '~/.claude',
    infoCallout: 'Custom Claude home and config directory keeps auth and settings separate.',
    env: {},
    models: [
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Thinking)', contextWindow: 200000, defaultEffort: 'high' },
    ],
  },
  {
    id: 'pi',
    name: 'Pi Agent',
    description: 'Pi Multi-Provider AI coding assistant via stdio RPC',
    command: process.platform === 'win32' ? 'pi.cmd' : 'pi',
    args: ['--mode', 'rpc', '--no-session'],
    configDirVar: 'PI_CODING_AGENT_DIR',
    defaultConfigDir: '~/.pi/agent',
    infoCallout: 'Connects to Pi coding assistant via stdio RPC interface.',
    env: {},
    models: [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek v4.1 Flash (Pi)', contextWindow: 1000000, defaultEffort: 'high' },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (Pi)', contextWindow: 200000, defaultEffort: 'high' },
      { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash (Pi)', contextWindow: 1000000, defaultEffort: 'high' },
      { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro (Pi)', contextWindow: 1048576, defaultEffort: 'high' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'Cursor Agent via Agent Client Protocol',
    command: 'cursor',
    args: ['--acp'],
    configDirVar: 'CURSOR_CONFIG_DIR',
    defaultConfigDir: '~/.cursor',
    infoCallout: 'Connects to Cursor agent via ACP stdio interface.',
    env: {},
    models: [
      { id: 'cursor-default', name: 'Cursor Default', contextWindow: 200000, defaultEffort: 'high' },
    ],
  },
  {
    id: 'grok',
    name: 'Grok',
    description: 'xAI Grok via Agent Client Protocol',
    command: 'grok',
    args: ['acp'],
    configDirVar: 'GROK_CONFIG_DIR',
    defaultConfigDir: '~/.grok',
    infoCallout: 'Connects to Grok CLI via ACP stdio interface.',
    env: {},
    models: [
      { id: 'grok-2', name: 'Grok 2', contextWindow: 131072, defaultEffort: 'high' },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'DeepSeek V4.1, Claude Fable 5.2, GPT-5.5, Kimi K3, Qwen4 via OpenCode ACP CLI',
    command: 'opencode',
    args: ['acp'],
    configDirVar: 'OPENCODE_CONFIG_DIR',
    defaultConfigDir: '~/.opencode',
    infoCallout: 'Connects to OpenCode using ACP stdio interface.',
    env: {},
    models: [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'claude-fable-5-2', name: 'Claude Fable 5.2 (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'gpt-5-5-preview', name: 'GPT-5.5 Preview (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'kimi-k3-max', name: 'Kimi K3 Max', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'qwen4-max', name: 'Qwen4 Max (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    description: 'Gemini 3.8 Flash, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B via Google Antigravity ACP',
    command: 'agy',
    args: ['acp', '--stdio', '--dangerously-skip-permissions'],
    configDirVar: 'ANTIGRAVITY_HOME',
    defaultConfigDir: '~/.antigravity',
    infoCallout: 'Connects to Google Antigravity using ACP stdio interface.',
    env: {},
    models: [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium Thinking)', contextWindow: 1048576, defaultEffort: 'medium' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low Thinking)', contextWindow: 1048576, defaultEffort: 'low' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', contextWindow: 1048576, defaultEffort: 'high' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', contextWindow: 1048576, defaultEffort: 'medium' },
    ],
  },
  {
    id: 'muse',
    name: 'Muse Code',
    description: 'Muse Code via Agent Client Protocol',
    command: 'muse',
    args: ['acp'],
    configDirVar: 'MUSE_CONFIG_DIR',
    defaultConfigDir: '~/.muse',
    infoCallout: 'Connects to Muse Code via ACP stdio interface.',
    env: {},
    models: [
      { id: 'muse-spark', name: 'Muse Spark', contextWindow: 131072, defaultEffort: 'high' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom provider',
    description: 'Any custom CLI or local daemon speaking stdio JSON-RPC / ACP',
    command: '',
    args: ['--stdio'],
    configDirVar: 'CONFIG_DIR',
    defaultConfigDir: '',
    infoCallout: 'Connects to any custom daemon via stdio ACP/JSON-RPC.',
    env: {},
    models: [
      { id: 'custom-model-1', name: 'Custom Model 1', contextWindow: 131072, defaultEffort: 'high' },
    ],
  },
];

/**
 * Load persistent engine configurations from ~/.dsh/acp-engines.json
 */
export function loadCustomEngines() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const data = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[acp-web] Failed to read persistent acp-engines.json:', err.message);
  }
  return {};
}

/**
 * Save persistent engine configurations to ~/.dsh/acp-engines.json
 */
export function saveCustomEngines(engines) {
  try {
    const dir = path.dirname(CONFIG_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(engines, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[acp-web] Failed to save persistent acp-engines.json:', err.message);
    return false;
  }
}

/**
 * Probe an ACP or JSON-RPC stdio daemon by performing a live initialize handshake.
 */
export async function probeEngine(command, args = [], env = {}, timeoutMs = 5000) {
  command = expandHome(command);
  const start = Date.now();
  return new Promise((resolve) => {
    let resolved = false;
    const isWindows = process.platform === 'win32';
    let resolvedCmd = command;
    let resolvedArgs = Array.isArray(args) ? [...args] : [];

    if (command === 'codex' || (resolvedArgs && resolvedArgs.includes('app-server'))) {
      if (resolvedArgs.length === 0 || (resolvedArgs.length === 1 && resolvedArgs[0] === 'acp')) {
        resolvedArgs = ['app-server'];
      }
      if (isWindows && command === 'codex') {
        const codexExe = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
        if (fs.existsSync(codexExe)) {
          resolvedCmd = codexExe;
        }
      }
    }

    const launch = resolveAgentLaunch(resolvedCmd, resolvedArgs);
    resolvedCmd = launch.command;
    resolvedArgs = launch.args;
    const isScript = isWindows && !resolvedCmd.toLowerCase().endsWith('.exe');

    let child;
    try {
      child = spawn(resolvedCmd, resolvedArgs, {
        shell: isScript,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...expandAgentEnv(env) },
      });
    } catch (err) {
      return resolve({ ok: false, error: `Failed to spawn: ${err.message}`, latencyMs: 0 });
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stopAgentProcess(child)
        resolve({ ok: false, error: `Probe timed out after ${timeoutMs}ms`, latencyMs: timeoutMs });
      }
    }, timeoutMs);

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message, latencyMs: Date.now() - start });
      }
    });

    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2048); });
    child.on('exit', code => {
      if (resolved) return;
      resolved = true;clearTimeout(timer);
      resolve({ ok: false, error: stderr.trim() || `Agent exited before handshake (code: ${code})`, latencyMs: Date.now() - start });
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id === 1) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            const latencyMs = Date.now() - start;
            stopAgentProcess(child)
            resolve({
              ok: !msg.error,
              latencyMs,
              result: msg.result,
              error: msg.error ? (msg.error.message || JSON.stringify(msg.error)) : undefined,
            });
          }
        }
        if (msg.type === 'response' && msg.command === 'get_state') {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            const latencyMs = Date.now() - start;
            stopAgentProcess(child)
            resolve({
              ok: Boolean(msg.success),
              latencyMs,
              result: msg.data,
              error: msg.error,
            });
          }
        }
      } catch {}
    });

    // Send ACP initialize request
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'dsh-acp-probe', version: '1.0.0' },
        capabilities: {},
      },
    }) + '\n';

    try {
      if (Array.isArray(args) && (args.includes('rpc') || args.includes('--mode'))) {
        child.stdin.write(JSON.stringify({ type: 'get_state' }) + '\n');
      } else {
        child.stdin.write(initReq);
      }
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        stopAgentProcess(child);
        resolve({ ok: false, error: `Failed to write stdin: ${err.message}`, latencyMs: 0 });
      }
    }
  });
}

/**
 * Scan system for installed ACP-compatible CLIs.
 */
export function scanSystemEngines() {
  const results = [];
  const candidates = [
    {
      id: 'antigravity',
      name: 'Google Antigravity',
      defaultPath: path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
      command: 'agy',
      args: ['acp', '--stdio', '--dangerously-skip-permissions'],
      presetId: 'antigravity',
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      defaultPath: null,
      command: 'opencode',
      args: ['acp'],
      presetId: 'opencode',
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      defaultPath: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      command: 'codex',
      args: ['app-server'],
      presetId: 'codex',
    },
    {
      id: 'pi',
      name: 'Pi Coding Agent',
      defaultPath: null,
      command: 'pi',
      args: ['--mode', 'rpc', '--no-session'],
      presetId: 'pi',
    },
    {
      id: 'claude',
      name: 'Anthropic Claude Code',
      defaultPath: null,
      command: 'claude',
      args: ['acp'],
      presetId: 'claude',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      defaultPath: null,
      command: 'cursor',
      args: ['--acp'],
      presetId: 'cursor',
    },
    {
      id: 'grok',
      name: 'Grok',
      defaultPath: null,
      command: 'grok',
      args: ['acp'],
      presetId: 'grok',
    },
    {
      id: 'muse',
      name: 'Muse Code',
      defaultPath: null,
      command: 'muse',
      args: ['acp'],
      presetId: 'muse',
    },
  ];

  for (const c of candidates) {
    let installed = false;
    let resolvedPath = null;

    if (c.defaultPath && fs.existsSync(c.defaultPath)) {
      installed = true;
      resolvedPath = c.defaultPath;
    } else {
      try {
        const out = process.platform === 'win32'
          ? execFileSync('where.exe', [c.command], { encoding: 'utf8', windowsHide: true, timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] })
          : execFileSync('/bin/sh', ['-c', 'command -v "$1"', 'dsh-acp', c.command], { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] });
        const matches = out.trim().split(/\r?\n/);
        const firstLine = matches.find(item => /\.(exe|cmd)$/i.test(item)) || matches[0];
        if (firstLine) {
          installed = true;
          resolvedPath = firstLine;
        }
      } catch {}
    }

    results.push({
      ...c,
      installed,
      resolvedPath: compactHome(resolvedPath || c.defaultPath || c.command),
    });
  }

  return results;
}

/**
 * Parse JSON body from HTTP request.
 */
async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache, no-store',
  });
  res.end(JSON.stringify(data));
}

/**
 * Creates the management handler served under `/api/acp/*`.
 */
export function createAcpWebHandler(context) {
  const { adapter, getRegistration, setRegistration, ctx } = context;

  return async function handleAcpRequest(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const p = url.pathname.replace(/^\/api\/acp(?=\/|$)/, '/acp/api');

      // GET /acp/api/engines -> Live engine status & models
      if (req.method === 'GET' && p === '/acp/api/engines') {
        const enginesList = [];
        const persistentConfig = loadCustomEngines();

        for (const [key, engine] of Object.entries(adapter.engines)) {
          const daemons = adapter.getProviderDaemons(key);
          const running = daemons.filter(daemon => daemon.child && !daemon.child.killed && daemon.child.exitCode === null);
          const daemon = running[0] || daemons[0];
          const isAlive = running.length > 0;
          const isCustom = Boolean(persistentConfig[key]);

          enginesList.push({
            id: key,
            name: engine.name || key,
            command: compactHome(engine.command),
            args: engine.args || [],
            env: engine.env || {},
            models: engine.models || [],
            disabled: Boolean(engine.disabled),
            isCustom,
            daemon: {
              running: Boolean(isAlive),
              pid: isAlive ? daemon.child.pid : null,
              hasChild: daemons.some(daemon => Boolean(daemon.child)),
              processCount: running.length,
              lastPing: daemon?.lastPing || null,
              latencyMs: daemon?.lastLatencyMs || null,
            },
          });
        }

        return sendJson(res, 200, {
          ok: true,
          hostname: os.hostname(),
          engines: enginesList,
          presets: ENGINE_PRESETS.map(preset => ({ ...preset, command: preset.id === 'antigravity' ? 'agy' : preset.command })),
          installedScan: scanSystemEngines(),
        });
      }

      if (req.method === 'GET' && p === '/acp/api/sessions') {
        const id = url.searchParams.get('provider');
        if (!adapter.engines[id]) return sendJson(res, 404, { error: 'Unknown provider' });
        return sendJson(res, 200, { ok: true, sessions: adapter.nativeSessions(id) });
      }
      if (req.method === 'POST' && p === '/acp/api/session-control') {
        const { provider, sessionId, action } = await parseJsonBody(req);
        if (typeof provider !== 'string' || typeof sessionId !== 'string' || !['compact', 'rebuild'].includes(action)) return sendJson(res, 400, { error: 'Provider, sessionId and action are required' });
        const controller = new AbortController();
        const closed = () => controller.abort(new DOMException('Client disconnected', 'AbortError'));
        res.once('close', closed);
        try { return sendJson(res, 200, { ok: true, result: await adapter.controlSession(provider, sessionId, action, controller.signal) }); }
        finally { res.removeListener('close', closed); }
      }

      if (req.method === 'POST' && p === '/acp/api/discover') {
        const engine = await parseJsonBody(req);
        if (typeof engine.command !== 'string' || !engine.command.trim() || !Array.isArray(engine.args)
          || !engine.args.every(arg => typeof arg === 'string')) {
          return sendJson(res, 400, { ok: false, error: 'Choose an executable and valid launch arguments.' });
        }
        const daemon = context.createDaemon(engine);
        let timer;
        let cancel;
        try {
          const interrupted = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Model discovery timed out. Check the agent sign-in and executable.')), 15000);
            cancel = () => reject(new Error('Model discovery cancelled.'));
            res.once('close', cancel);
          });
          const models = await Promise.race([daemon.discoverModels(engine.id), interrupted]);
          return sendJson(res, 200, { ok: true, models });
        } finally {
          clearTimeout(timer);
          res.removeListener('close', cancel);
          daemon.dispose();
        }
      }

      // POST /acp/api/probe -> Run live handshake probe
      if (req.method === 'POST' && p === '/acp/api/probe') {
        const body = await parseJsonBody(req);
        const { command, args, env } = body;
        if (!command) {
          return sendJson(res, 400, { ok: false, error: 'Command executable is required' });
        }
        const result = await probeEngine(command, args || [], env || {}, 6000);
        return sendJson(res, 200, result);
      }

      // POST /acp/api/save -> Add or update engine config
      if (req.method === 'POST' && p === '/acp/api/save') {
        const body = await parseJsonBody(req);
        const { id, name, command, args, env, models, disabled, accentColor, autoCompactTokens, compactIdleThreads, presetId, configDir, configDirVar } = body;

        if (!id || !command) {
          return sendJson(res, 400, { ok: false, error: 'Engine ID and command are required' });
        }

        const engineKey = String(id).trim().toLowerCase();
        const mergedEnv = env && typeof env === 'object' ? { ...env } : {};
        if (configDirVar && configDir) {
          mergedEnv[configDirVar] = configDir;
        }

        const updatedEngine = {
          id: engineKey,
          protocol: protocolKind({ ...body, id: engineKey }),
          ...Object.fromEntries(['requestTimeoutMs', 'inactivityTimeoutMs', 'maxOutputBytes', 'maxFrameBytes', 'maxSessions'].flatMap(key => {
            const value = body[key] ?? adapter.engines[engineKey]?.[key];
            return Number.isSafeInteger(value) && value > 0 ? [[key, value]] : [];
          })),
          name: name?.trim() || `ACP (${engineKey})`,
          command: String(command).trim(),
          args: Array.isArray(args) ? args : String(args || '').split(' ').filter(Boolean),
          env: mergedEnv,
          models: Array.isArray(models) ? models : [],
          disabled: Boolean(disabled),
          accentColor: accentColor || undefined,
          autoCompactTokens: autoCompactTokens ? (Number(autoCompactTokens) || autoCompactTokens) : undefined,
          compactIdleThreads: compactIdleThreads || undefined,
          presetId: presetId || undefined,
          configDir: configDir || undefined,
          configDirVar: configDirVar || undefined,
        };

        // Update in adapter
        adapter.disposeProvider(engineKey);
        adapter.engines[engineKey] = updatedEngine;

        // Persist to ~/.dsh/acp-engines.json
        const persistent = loadCustomEngines();
        persistent[engineKey] = updatedEngine;
        saveCustomEngines(persistent);

        // Update Cordis LLM adapter registrations
        const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
        const reg = getRegistration();
        if (reg?.replace) {
          try {
            reg.replace(activeKeys);
          } catch (e) {
            console.warn('[acp-web] Error replacing LLM adapter routes:', e.message);
          }
        }

        return sendJson(res, 200, { ok: true, engine: updatedEngine });
      }

      // POST /acp/api/toggle -> Toggle enabled/disabled state
      if (req.method === 'POST' && p === '/acp/api/toggle') {
        const body = await parseJsonBody(req);
        const { id, disabled } = body;
        const engine = adapter.engines[id];
        if (!engine) {
          return sendJson(res, 404, { ok: false, error: `Engine "${id}" not found` });
        }

        engine.disabled = Boolean(disabled);

        if (engine.disabled) {
          adapter.disposeProvider(id);
        }

        // Persist
        const persistent = loadCustomEngines();
        if (persistent[id]) {
          persistent[id].disabled = engine.disabled;
          saveCustomEngines(persistent);
        }

        // Update LLM routes
        const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
        const reg = getRegistration();
        if (reg?.replace) {
          try {
            reg.replace(activeKeys);
          } catch (e) {
            console.warn('[acp-web] Error updating routes on toggle:', e.message);
          }
        }

        return sendJson(res, 200, { ok: true, id, disabled: engine.disabled });
      }

      // POST /acp/api/restart -> Restart engine daemon
      if (req.method === 'POST' && p === '/acp/api/restart') {
        const body = await parseJsonBody(req);
        const { id } = body;
        adapter.disposeProvider(id);

        // Ensure started & measure ping
        const engine = adapter.engines[id];
        let pingResult = null;
        if (engine && !engine.disabled) {
          pingResult = await probeEngine(engine.command, engine.args, engine.env, 6000);
        }

        return sendJson(res, 200, { ok: true, id, ping: pingResult });
      }

      // POST /acp/api/delete -> Delete engine
      if (req.method === 'POST' && p === '/acp/api/delete') {
        const body = await parseJsonBody(req);
        const { id } = body;

        adapter.disposeProvider(id);
        delete adapter.engines[id];

        // Persist delete
        const persistent = loadCustomEngines();
        delete persistent[id];
        saveCustomEngines(persistent);

        // Update LLM routes
        const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
        const reg = getRegistration();
        if (reg?.replace) {
          try {
            reg.replace(activeKeys);
          } catch (e) {
            console.warn('[acp-web] Error updating routes on delete:', e.message);
          }
        }

        return sendJson(res, 200, { ok: true, id });
      }

      // 404 for unknown /acp route
      return sendJson(res, 404, { error: 'not_found', path: p });
    } catch (err) {
      console.error('[acp-web] Handler error:', err);
      return sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  };
}
