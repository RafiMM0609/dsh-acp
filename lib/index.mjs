/**
 * Generic Multi-Engine Agent Client Protocol (ACP) adapter for DeepSeek Harness (DSH).
 *
 * Implements the DSH LlmAdapter contract and manages multiple ACP server daemons
 * over stdio JSON-RPC (inspired by T3 Code packages/provider-acp and packages/provider-acp-registry).
 *
 * Supports:
 *  - Google Antigravity (Gemini 3.8 Flash, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B)
 *  - Anthropic Claude Code ACP
 *  - OpenAI Codex ACP
 *  - Custom third-party ACP servers
 *
 * @module dsh-plugin-antigravity-acp
 */

import { fileURLToPath } from 'node:url';
import { NativeSessions, nativeKey, userHistory } from './native-sessions.mjs';
import { createDshHost, answerInteraction } from './host.mjs';
import { ToolBridge, BRIDGE_TOOLS, BRIDGE_INSTRUCTIONS } from './tool-bridge.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stopAgentProcess } from './process.mjs';
import { protocolKind, piUpdate, codexUpdate, piModelRoutes } from './protocol.mjs';
import { expandHome, expandAgentEnv, resolveAgentLaunch } from './paths.mjs';
import {
  createAcpWebHandler,
  loadCustomEngines,
} from './web-ui.mjs';

export const name = 'dsh-plugin-antigravity-acp';
export const inject = ['llm'];

const DEFAULT_AGY_PATH = process.platform === 'win32' ? '~/AppData/Local/agy/bin/agy.exe' : 'agy';

const positiveLimit = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback;
const RUNTIME_LIMITS = { requestTimeoutMs: 30000, inactivityTimeoutMs: 180000, maxOutputBytes: 8 * 1024 * 1024, maxFrameBytes: 4 * 1024 * 1024, maxSessions: 128 };

export const DEFAULT_ANTIGRAVITY_MODELS = [
  {
    id: 'gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash (High Thinking)',
    description: 'Google Antigravity Gemini 3.8 Flash with high reasoning effort',
    contextWindow: 1048576,
    defaultEffort: 'high',
  },
  {
    id: 'gemini-3.8-flash-medium',
    name: 'Gemini 3.8 Flash (Medium Thinking)',
    description: 'Google Antigravity Gemini 3.8 Flash with medium reasoning effort',
    contextWindow: 1048576,
    defaultEffort: 'medium',
  },
  {
    id: 'gemini-3.8-flash-low',
    name: 'Gemini 3.8 Flash (Low Thinking)',
    description: 'Google Antigravity Gemini 3.8 Flash with low reasoning effort',
    contextWindow: 1048576,
    defaultEffort: 'low',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    description: 'Anthropic Claude Sonnet 4.6 via Google Antigravity ACP',
    contextWindow: 1048576,
    defaultEffort: 'high',
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 (Thinking)',
    description: 'Anthropic Claude Opus 4.6 via Google Antigravity ACP',
    contextWindow: 1048576,
    defaultEffort: 'high',
  },
  {
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B (Medium)',
    description: 'OpenAI GPT-OSS 120B via Google Antigravity ACP',
    contextWindow: 1048576,
    defaultEffort: 'medium',
  },
];

/**
 * Standard-Schema v1 configuration validator.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'acp-multi-adapter',
    validate(raw) {
      const engines = {};

      if (raw?.engines && typeof raw.engines === 'object') {
        for (const [key, eng] of Object.entries(raw.engines)) {
          if (!key || !eng || typeof eng !== 'object') continue;
          engines[key] = {
            id: key,
            name: typeof eng.name === 'string' ? eng.name : `ACP (${key})`,
            command: typeof eng.command === 'string' ? eng.command : (key === 'antigravity' ? DEFAULT_AGY_PATH : key),
            protocol: protocolKind({ ...eng, id: key }),
            presetId: eng.presetId,
            ...Object.fromEntries(Object.entries(RUNTIME_LIMITS).map(([name, fallback]) => [name, positiveLimit(eng[name], fallback)])),
            args: Array.isArray(eng.args) ? eng.args : protocolKind({ ...eng, id: key }) === 'pi' ? ['--mode', 'rpc', '--no-session'] : protocolKind({ ...eng, id: key }) === 'codex' ? ['app-server'] : ['acp'],
            env: eng.env && typeof eng.env === 'object' ? eng.env : {},
            models: Array.isArray(eng.models) && eng.models.length > 0
              ? eng.models
              : (key === 'antigravity' ? DEFAULT_ANTIGRAVITY_MODELS : []),
          };
        }
      }

      // Backward-compatible fallback: ensure antigravity is always present
      if (!engines.antigravity) {
        engines.antigravity = {
          id: 'antigravity',
          name: typeof raw?.providerName === 'string' ? raw.providerName : 'Google Antigravity (ACP)',
          command: typeof raw?.executablePath === 'string' ? raw.executablePath : DEFAULT_AGY_PATH,
          args: [
            'acp',
            '--stdio',
            ...(raw?.dangerouslySkipPermissions !== false ? ['--dangerously-skip-permissions'] : []),
            ...(Array.isArray(raw?.extraArgs) ? raw.extraArgs : []),
          ],
          env: {},
          models: DEFAULT_ANTIGRAVITY_MODELS,
        };
      }

      return {
        value: {
          engines,
        },
      };
    },
  },
};

// Shared daemon startup can outlive an individual cancelled caller.
function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason || new DOMException('Stopped', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

class AsyncQueue {
  constructor() {
    this.items = [];
    this.resolvers = [];
  }

  push(item) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve(item);
    } else {
      this.items.push(item);
    }
  }

  async next() {
    if (this.items.length > 0) {
      return this.items.shift();
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

/**
 * Manages one ACP child process instance (e.g. agy acp, claude --acp, codex-acp).
 */
export class AcpDaemon {
  constructor(engine, cwd) {
    this.engine = engine;
    this.cwd = cwd ? path.resolve(expandHome(cwd)) : null;
    this.child = null;
    this.msgId = 1;
    this.pending = new Map();
    this.activePromptHandlers = new Map(); // sessionId / threadId -> handler function
    this.activeTurnCompletedHandlers = new Map(); // threadId -> resolve function
    this.sessionMap = new Map(); // dshSessionId -> { acpSessionId, currentModel, currentEffort, configOptions, isCodex, isPi }
    this.piModelsCache = new Map();
    this.currentPiSessionId = null;
    this.initialized = false;
    this.initPromise = null;
    this.lastLatencyMs = null;
    this.lastPing = null;
    this.activeCalls = new Map();
    this.lastUsedAt = Date.now();
    this.ownerSessionId = null;
    this.createdSessions = 0;
    this.recycleRequired = false;
    this.controlRequests = new Set();
    this.piSettleTimer = null;
    this.recycleTimer = null;
    this.bindings = new Map();
    this.clientRequests = new Map();
    this.sessionCommands = new Map();
    this.compactionWaiters = new Map();
    this.requestTimeoutMs = positiveLimit(engine.requestTimeoutMs, RUNTIME_LIMITS.requestTimeoutMs);
    this.inactivityTimeoutMs = positiveLimit(engine.inactivityTimeoutMs, RUNTIME_LIMITS.inactivityTimeoutMs);
    this.maxOutputBytes = positiveLimit(engine.maxOutputBytes, RUNTIME_LIMITS.maxOutputBytes);
  }

  get isCodex() { return protocolKind(this.engine) === 'codex'; }
  get isPi() { return protocolKind(this.engine) === 'pi'; }
  get busy() { return this.activeCalls.size > 0 || this.pending.size > 0 || this.compactionWaiters.size > 0; }

  fail(error) {
    clearTimeout(this.piSettleTimer);
    clearTimeout(this.recycleTimer);
    for (const binding of [...this.bindings.values()]) binding.close();
    for (const call of this.activeCalls.values()) call.controller.abort(error);
    for (const req of [...this.pending.values()]) req.reject(error);
    for (const entry of this.activeTurnCompletedHandlers.values()) entry.reject(error);
    for (const waiter of this.compactionWaiters.values()) waiter.reject(error);
    this.compactionWaiters.clear();this.sessionCommands.clear();
    this.pending.clear();
    this.activeTurnCompletedHandlers.clear();
    this.activePromptHandlers.clear();
    this.sessionMap.clear();
    this.createdSessions = 0;
    this.recycleRequired = false;
    this.piModelsCache.clear();
    this.currentPiSessionId = null;
    this.initialized = false;
    this.initPromise = null;
  }

  failSession(sessionId, error) {
    for (const call of this.activeCalls.values()) {
      if (!sessionId || call.nativeSessionId === sessionId) call.controller.abort(error);
    }
  }

  async answerClientRequest(request, pi = false) {
    const nativeId = request.params?.sessionId || request.params?.threadId || (pi ? this.currentPiSessionId : undefined);
    const entry = [...this.activeCalls].find(([, call]) => call.nativeSessionId === nativeId)
      || (this.activeCalls.size === 1 ? [...this.activeCalls][0] : undefined);
    if (!this.host || !entry) throw new Error('No active DSH chat can answer this agent interaction');
    const [sessionId, call] = entry, child = this.child;
    const key = `${pi ? 'pi' : 'rpc'}:${request.id}`;
    if (this.clientRequests.has(key) || this.clientRequests.size >= 32) throw new Error('Too many pending agent interactions');
    const signal = AbortSignal.any([call.signal, AbortSignal.timeout(this.engine.interactionTimeoutMs || 900000)]);
    this.clientRequests.set(key, call);
    call.pause();
    try {
      let result;
      if (!pi && request.method === 'item/tool/call') {
        const binding = this.bindings.get(sessionId), p = request.params;
        if (!binding) throw new Error('DSH tool bridge is unavailable in this chat');
        const args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments;
        const tool = await waitWithSignal(binding.call(p.tool, args), signal);
        result = { success: !tool.isError, contentItems: tool.content.map(c => c.type === 'image' ? { type: 'inputImage', imageUrl: `data:${c.mimeType};base64,${c.data}` } : { type: 'inputText', text: c.text }) };
      } else result = await waitWithSignal(answerInteraction(this.host, sessionId, pi ? 'pi' : this.isCodex ? 'codex' : 'acp', request, signal), signal);
      signal.throwIfAborted();
      if (this.child === child) child.stdin.write(JSON.stringify(pi ? result : { jsonrpc: '2.0', id: request.id, result }) + '\n');
    } catch (error) {
      if (this.child === child) {
        child.stdin.write(JSON.stringify(pi ? { type: 'extension_ui_response', id: request.id, cancelled: true }
          : request.method === 'session/request_permission' ? { jsonrpc: '2.0', id: request.id, result: { outcome: { outcome: 'cancelled' } } }
          : { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: error.message } }) + '\n');
      }
      if (!call.signal.aborted) call.controller.abort(error);
    } finally { this.clientRequests.delete(key);call.resume(); }
  }

  handleMessage(data) {
    if (this.isPi) {
      if (data.type === 'response') {
        let req = this.pending.get(data.id);
        if (data.id === undefined) {
          const candidates = [...this.pending.values()].filter(r => r.type === data.command);
          if (candidates.length === 1) req = candidates[0];
        }
        if (req) data.success === false ? req.reject(new Error(data.error || 'Pi command failed')) : req.resolve(data.data ?? data);
        return;
      }
      if (data.type === 'extension_ui_request') {
        if (data.method === 'notify') this.activePromptHandlers.get(this.currentPiSessionId)?.({ sessionUpdate: 'agent_message_chunk', content: { text: `\n${String(data.message || '').slice(0, 4000)}\n` } });
        if (this.host && ['select', 'confirm', 'input', 'editor'].includes(data.method)) {
          this.answerClientRequest(data, true).catch(error => this.failSession(this.currentPiSessionId, error));
          return;
        }
        if (['select', 'confirm', 'input', 'editor'].includes(data.method)) {
          this.notifyPi('extension_ui_response', { id: data.id, cancelled: true });
          this.failSession(this.currentPiSessionId, new Error('Pi requested interactive input; this DSH adapter does not support that dialog yet.'));
        }
        return;
      }
      const sid = this.currentPiSessionId;
      if (['message_end', 'turn_end'].includes(data.type) && ['error', 'aborted'].includes(data.message?.stopReason)) {
        this.failSession(sid, new Error(data.message.errorMessage || `Pi turn ${data.message.stopReason}`));
        return;
      }
      const update = piUpdate(data);
      if (update.sessionUpdate === 'token_usage') {
        this.piUsage ||= {};
        for (const [key, value] of Object.entries(update.usage)) {
          if (typeof value === 'number') this.piUsage[key] = (this.piUsage[key] || 0) + value;
        }
        update.usage = { ...this.piUsage };
      }
      this.activePromptHandlers.get(sid)?.(update);
      if (data.type === 'agent_end') {
        const entry = this.activeTurnCompletedHandlers.get(sid);
        const call = [...this.activeCalls.values()].find(c => c.nativeSessionId === sid);
        const check = async () => {
          if (!entry || this.activeTurnCompletedHandlers.get(sid) !== entry) return;
          try {
            const state = await this.requestPi('get_state', {}, call?.signal);
            if (this.activeTurnCompletedHandlers.get(sid) !== entry) return;
            if (!state.isStreaming && !state.isCompacting) {
              this.activeTurnCompletedHandlers.delete(sid);
              entry.resolve(data);
            } else {
              this.piSettleTimer = setTimeout(check, 250);this.piSettleTimer.unref?.();
            }
          } catch (error) { entry.reject(error); }
        };
        clearTimeout(this.piSettleTimer);
        this.piSettleTimer = setTimeout(check, 100);this.piSettleTimer.unref?.();
      }
      if (data.type === 'agent_settled') {
        clearTimeout(this.piSettleTimer);
        const entry = this.activeTurnCompletedHandlers.get(sid);
        this.activeTurnCompletedHandlers.delete(sid);
        if (data.aborted) entry?.reject(new DOMException('Pi run aborted', 'AbortError'));
        else entry?.resolve(data);
      }
      return;
    }
    // A server request is not a response, even when its ID collides with ours.
    if (data.method && data.id !== undefined) {
      if (this.host) {
        this.answerClientRequest(data).catch(error => this.failSession(data.params?.sessionId || data.params?.threadId, error));
        return;
      }
      const permission = data.method === 'session/request_permission';
      this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: data.id,
        ...(permission ? { result: { outcome: { outcome: 'cancelled' } } }
          : { error: { code: -32601, message: `Unsupported client request: ${data.method}` } }),
      }) + '\n');
      this.failSession(data.params?.sessionId || data.params?.threadId,
        new Error(`Agent requested ${data.method}; the required client interaction is not supported by this adapter.`));
      return;
    }
    if (!data.method && data.id !== undefined) {
      const req = this.pending.get(data.id);
      if (req) data.error ? req.reject(new Error(data.error.message || JSON.stringify(data.error))) : req.resolve(data.result);
      return;
    }
    if (data.method === 'session/update') {
      if (data.params?.update?.sessionUpdate === 'available_commands_update') this.sessionCommands.set(data.params.sessionId, data.params.update.availableCommands || []);
      this.activePromptHandlers.get(data.params?.sessionId)?.(data.params?.update);
    }
    else if (this.isCodex && data.method) {
      const sid = data.params?.threadId;
      if (data.method === 'thread/compacted' || (data.method === 'item/completed' && data.params?.item?.type === 'contextCompaction')) {
        const waiter = this.compactionWaiters.get(sid);
        if (data.params?.item?.status === 'failed') waiter?.reject(new Error('Codex compaction failed'));
        else waiter?.resolve({ compacted: true });
      }
      this.activePromptHandlers.get(sid)?.(codexUpdate(data));
      if (data.method === 'turn/completed') {
        const entry = this.activeTurnCompletedHandlers.get(sid);
        this.activeTurnCompletedHandlers.delete(sid);
        const turn = data.params?.turn;
        if (turn?.error || turn?.status === 'failed') entry?.reject(new Error(turn.error?.message || 'Codex turn failed'));
        else if (turn?.status === 'interrupted') entry?.reject(new DOMException('Codex turn interrupted', 'AbortError'));
        else entry?.resolve(turn);
      } else if (data.method === 'error' && !data.params?.willRetry) {
        const error = new Error(data.params?.error?.message || 'Codex agent error');
        this.compactionWaiters.get(sid)?.reject(error);
        this.failSession(sid, error);
      }
    }
  }

  async ensureStarted() {
    if (this.child && !this.child.killed && this.initialized) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (this.child) {
        try { this.child.kill(); } catch {}
      }

      const cwd = this.cwd ??= process.cwd();
      const isWindows = process.platform === 'win32';
      let cmd = expandHome(this.engine.command || '');
      if (isWindows && cmd === 'codex') {
        const codexExe = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
        if (fs.existsSync(codexExe)) {
          cmd = codexExe;
        }
      }
      let args = [...(this.engine.args || [])];
      if (this.engine.id === 'codex') {
        if (!args || args.length === 0 || (args.length === 1 && args[0] === 'acp')) {
          args = ['app-server'];
        }
      }
      if (this.engine.id === 'pi') {
        if (!args || args.length === 0 || (args.length === 1 && args[0] === 'acp')) {
          args = ['--mode', 'rpc', '--no-session'];
        }
      }
      const piBinding = this.isPi ? [...this.bindings.values()][0] : null;
      if (piBinding) args.push('--extension', fileURLToPath(new URL('./pi-host-extension.mjs', import.meta.url)));
      const launch = resolveAgentLaunch(cmd, args);
      cmd = launch.command;
      args = launch.args;
      const isScriptOrName = isWindows && !cmd.toLowerCase().endsWith('.exe');

      const child = this.child = spawn(cmd, args, {
        cwd,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: isScriptOrName,
        env: {
          ...process.env,
          ...expandAgentEnv(this.engine.env),
          ...(piBinding ? { DSH_BRIDGE_URL: piBinding.url, DSH_BRIDGE_TOKEN: piBinding.token } : {}),
          PYTHONUNBUFFERED: '1',
        },
      });

      const failed = error => {
        if (this.child !== child) return;
        this.child = null;
        this.fail(error);
        stopAgentProcess(child);
      };
      child.on('error', failed);
      child.stdin.on('error', failed);
      child.on('exit', (code, signal) => failed(new Error(`ACP server "${this.engine.id}" terminated unexpectedly (code: ${code}, signal: ${signal})`)));
      let wireBuffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        wireBuffer += chunk;
        const limit = positiveLimit(this.engine.maxFrameBytes, RUNTIME_LIMITS.maxFrameBytes);
        let newline;
        while ((newline = wireBuffer.indexOf('\n')) !== -1) {
          const line = wireBuffer.slice(0, newline);
          wireBuffer = wireBuffer.slice(newline + 1);
          if (Buffer.byteLength(line) > limit) { failed(new Error('Agent protocol frame exceeded the size limit')); return; }
          let data;
          try { data = JSON.parse(line); } catch { continue; }
          if (!data || typeof data !== 'object') continue;
          try { this.handleMessage(data); } catch (error) { failed(error); return; }
          if (this.child !== child) return;
        }
        if (Buffer.byteLength(wireBuffer) > limit) {
          wireBuffer = '';
          failed(new Error('Agent protocol frame exceeded the size limit'));
        }
      });

      // Handshake initialize
      if (this.isPi) {
        const t0 = Date.now();
        const res = await this.requestPi('get_available_models');
        for (const model of piModelRoutes(res?.models || [])) {
          this.piModelsCache.set(`${model.provider}/${model.id}`, model);
          this.piModelsCache.set(model.routeId, model);
        }
        this.lastLatencyMs = Date.now() - t0;
        this.lastPing = Date.now();
        this.initialized = true;
        return;
      }

      const t0 = Date.now();
      this.initializeResult = await this.request('initialize', {
        protocolVersion: 1,
        ...(this.isCodex ? { capabilities: this.host ? { experimentalApi: true } : {} } : { clientCapabilities: {} }),
        clientInfo: { name: 'deepseek-harness', version: '0.2.2' },
      });
      if (this.isCodex) this.notify('initialized', {});
      this.lastLatencyMs = Date.now() - t0;
      this.lastPing = Date.now();

      this.initialized = true;
    })();

    try { return await this.initPromise; }
    catch (error) { this.dispose(error); throw error; }
  }

  requestPi(type, payload = {}, signal) {
    return this.request(type, payload, signal);
  }

  notifyPi(type, payload = {}) {
    if (!this.child || this.child.killed) return;
    const message = JSON.stringify({ type, ...payload }) + '\n';
    this.child.stdin.write(message);
  }

  request(method, params, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Stopped', 'AbortError'));
    const id = this.isPi ? String(this.msgId++) : this.msgId++;
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(signal.reason || new DOMException('Stopped', 'AbortError'));
      };
      this.pending.set(id, {
        resolve: value => { cleanup(); resolve(value); },
        reject: error => { cleanup(); reject(error); }, method, type: this.isPi ? method : undefined,
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (!['session/prompt', 'compact'].includes(method)) {
        timer = setTimeout(() => { cleanup(); reject(new Error(`${method} timed out after ${this.requestTimeoutMs}ms`)); }, this.requestTimeoutMs);
        timer.unref?.();
      }
      try {
        this.child.stdin.write(JSON.stringify(this.isPi ? { id, type: method, ...params } : { jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  notify(method, params) {
    if (!this.child || this.child.killed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.child.stdin.write(payload);
  }

  async getOrCreateAcpSession(dshSessionId, cwd, signal, history) {
    signal?.throwIfAborted();
    const effectiveCwd = path.resolve(expandHome(cwd || this.cwd || process.cwd()));
    if (this.cwd && this.cwd !== effectiveCwd) {
      throw new Error('This agent process belongs to another workspace. Use a workspace-specific daemon.');
    }
    this.cwd = effectiveCwd;
    const key = dshSessionId || 'default-session';
    if (this.isPi && this.ownerSessionId && this.ownerSessionId !== key) throw new Error('Pi RPC requires a dedicated process for each chat.');
    if (this.isPi) this.ownerSessionId = key;
    if (this.recycleRequired && this.activeCalls.size <= 1 && this.controlRequests.size) {
      await waitWithSignal(Promise.allSettled([...this.controlRequests]), signal);
    }
    if (this.recycleRequired || (!this.sessionMap.has(key) && this.createdSessions >= positiveLimit(this.engine.maxSessions, RUNTIME_LIMITS.maxSessions))) {
      if (this.activeCalls.size > 1 || this.pending.size) throw new Error('Agent session limit reached while other chats are active. Retry after they finish.');
      const child = this.child;
      this.child = null;
      this.initialized = false;
      this.initPromise = null;
      for (const [id, binding] of this.bindings) if (id !== key) binding.close();
      this.sessionMap.clear();
      this.sessionCommands.clear();
      this.createdSessions = 0;
      this.recycleRequired = false;
      this.stopChild(child);
    }
    try {
      await waitWithSignal(this.ensureStarted(), signal);
    } catch (error) {
      if (!this.initialized) this.dispose(error);
      throw error;
    }
    signal?.throwIfAborted();
    if (this.sessionMap.has(key)) {
      const existing = this.sessionMap.get(key);
      if (!history || !existing.history || history.matches(existing.history)) return existing;
      this.sessionMap.delete(key);
    }
    const savedKey = this.nativeStore ? nativeKey(this.engine, this.provider, this.cwd, key) : null;
    const saved = savedKey && this.nativeStore.get(savedKey);
    const canResume = saved && history?.matches(saved);

    if (this.isPi) {
      const info = {
        acpSessionId: key,
        currentModel: null,
        currentEffort: null,
        configOptions: [],
        availableModels: [],
        isNew: true,
        isPi: true,
        savedKey,
        resumeFile: canResume ? saved.file : undefined,
      };
      this.sessionMap.set(key, info);
      return info;
    }

    if (this.isCodex) {
      let res;
      if (canResume && saved.id) {
        try { res = await this.request('thread/resume', { threadId: saved.id, cwd: effectiveCwd, ...(this.bindings.has(key) ? { dynamicTools: BRIDGE_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } : {}) }, signal); }
        catch { signal?.throwIfAborted(); }
      }
      const resumed = Boolean(res?.thread?.id);
      res ||= await this.request('thread/start', {
        cwd: effectiveCwd,
        ...(this.bindings.has(key) ? { dynamicTools: BRIDGE_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } : {}),
      }, signal);
      const threadId = res?.thread?.id;
      if (!threadId) throw new Error('Codex did not return a thread ID');
      this.createdSessions++;
      const info = {
        acpSessionId: threadId,
        currentModel: res?.thread?.model || 'gpt-6.1-sol',
        currentEffort: res?.thread?.reasoningEffort || 'medium',
        configOptions: [],
        availableModels: [],
        isNew: !resumed,
        savedKey,
        isCodex: true,
      };
      this.sessionMap.set(key, info);
      return info;
    }

    let res, resumed = false;
    if (canResume && saved.id && this.initializeResult?.agentCapabilities?.loadSession) {
      try {
        const loaded = await this.request('session/load', { sessionId: saved.id, cwd: effectiveCwd,
          mcpServers: this.bindings.has(key) ? [this.bindings.get(key).mcpServer] : [] }, signal);
        res = { ...loaded, sessionId: saved.id };resumed = true;
      } catch { signal?.throwIfAborted(); }
    }
    res ||= await this.request('session/new', {
      cwd: effectiveCwd,
      mcpServers: this.bindings.has(key) ? [this.bindings.get(key).mcpServer] : [],
    }, signal);

    if (!res?.sessionId) throw new Error('ACP agent did not return a session ID');
    this.createdSessions++;
    const info = {
      acpSessionId: res.sessionId,
      currentModel: res.configOptions?.find(o => o.category === 'model' || o.id === 'model')?.currentValue ?? res.models?.currentModelId ?? null,
      currentEffort: res.configOptions?.find(o => o.category === 'thought_level')?.currentValue ?? null,
      configOptions: res.configOptions || [],
      availableModels: res.models?.availableModels || [],
      isNew: !resumed,
      savedKey,
      isCodex: false,
    };
    this.sessionMap.set(key, info);
    return info;
  }

  async discoverModels(provider) {
    if (this.engine.id === 'pi' || this.engine.args?.includes('rpc') || this.isPi) {
      return this.discoverPiModels(provider);
    }
    if (this.isCodex) {
      await this.ensureStarted();
      const res = await this.request('model/list', {});
      const list = res?.data || [];
      return list.map((m) => ({
        provider,
        id: m.id || m.model,
        name: m.displayName || m.model || m.id,
        description: m.description || `${m.displayName || m.id} via Codex`,
        contextWindow: m.modelContextWindow || 475000,
        inputModalities: this.host?.readImage ? ['text', 'image'] : ['text'],
      }));
    }
    const session = await this.getOrCreateAcpSession('discovery-session');
    const options = session.configOptions || [];
    const modelConfig = options.find((o) => o.category === 'model' || o.id === 'model' || o.id === 'model_name');
    if (modelConfig && Array.isArray(modelConfig.options)) {
      const flatten = entries => entries.flatMap(entry => Array.isArray(entry.options) ? flatten(entry.options) : [entry]);
      return flatten(modelConfig.options).filter(opt => typeof opt.value === 'string').map((opt) => ({
        provider,
        id: opt.value,
        name: opt.name || opt.value,
        description: opt.description || `Model ${opt.name || opt.value} via ${this.engine.name}`,
        inputModalities: this.host?.readImage ? ['text', 'image'] : ['text'],
      }));
    }
    return session.availableModels.filter(model => typeof model.modelId === 'string').map(model => ({
      provider, id: model.modelId, name: model.name || model.modelId, description: model.description,
    }));
  }

  async discoverPiModels(provider) {
    await this.ensureStarted();
    return [...new Set(this.piModelsCache.values())].map(model => ({
      provider, id: model.routeId, name: model.name || model.id,
      description: `${model.name || model.id} via ${model.provider}`,
      contextWindow: model.contextWindow || 200000, inputModalities: this.host?.readImage ? ['text', 'image'] : ['text'],
    }));
  }

  async *stream(options) {
    options.signal?.throwIfAborted();
    const key = options.sessionId || `oneshot-${this.msgId++}`;
    if (this.activeCalls.has(key)) throw new Error('This chat already has an active turn. Stop it before sending another message.');
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let timer, paused = 0, closed = false;
    const touch = () => {
      clearTimeout(timer);
      if (paused || closed) return;
      timer = setTimeout(() => controller.abort(new Error(`Agent made no progress for ${this.inactivityTimeoutMs}ms`)), this.inactivityTimeoutMs);
      timer.unref?.();
    };
    const call = { controller, signal, touch, nativeSessionId: null,
      pause: () => { paused++;clearTimeout(timer); },
      resume: () => { paused = Math.max(0, paused - 1);if (!paused) touch(); },
    };
    this.activeCalls.set(key, call);
    const binding = this.bindings.get(key);
    if (binding) binding.active = { signal, tools: structuredClone(options.tools || []), inFlight: 0, nextId: 0,
      modelSelection: { provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort },
      pause: call.pause, resume: call.resume,
      progress: update => this.activePromptHandlers.get(call.nativeSessionId)?.(update),
    };
    touch();
    this.lastUsedAt = Date.now();
    try { yield* this.streamTurn({ ...options, sessionId: key, signal }); }
    finally {
      const wasAborted = signal.aborted;
      closed = true;
      controller.abort(new DOMException('Agent turn closed', 'AbortError'));
      clearTimeout(timer);
      if (binding) binding.active = null;
      this.activeCalls.delete(key);
      if (this.isPi) clearTimeout(this.piSettleTimer);
      this.lastUsedAt = Date.now();
      // Do not leave cancelled remote sessions accumulating in a reused process.
      if (wasAborted) this.recycleRequired = true;
      // Pi owns its process; stopping it cannot interrupt another chat.
      if (this.isPi && wasAborted) this.dispose(signal.reason);
      else if (this.recycleRequired && this.activeCalls.size === 0 && this.child) {
        const child = this.child;
        clearTimeout(this.recycleTimer);
        this.recycleTimer = setTimeout(() => {
          if (this.child === child && this.recycleRequired && !this.busy) this.dispose();
        }, 2100);
        this.recycleTimer.unref?.();
      }
    }
  }

  async *streamTurn(options) {
    const dshSessionId = options.sessionId || 'default-session';
    const cwd = options.cwd || this.cwd || process.cwd();
    options.signal?.throwIfAborted();
    const history = this.nativeStore ? userHistory(options.messages || []) : null;
    const sessionInfo = await this.getOrCreateAcpSession(dshSessionId, cwd, options.signal, history);
    const acpSessionId = sessionInfo.acpSessionId;
    this.activeCalls.get(dshSessionId).nativeSessionId = acpSessionId;

    if (this.isPi) {
      this.currentPiSessionId = acpSessionId;
      this.piUsage = null;
      if (sessionInfo.resumeFile) {
        try { const loaded = await this.requestPi('switch_session', { sessionPath: sessionInfo.resumeFile }, options.signal);if (loaded?.cancelled) throw new Error('Pi declined resume');sessionInfo.isNew = false; }
        catch { options.signal?.throwIfAborted(); }
        delete sessionInfo.resumeFile;
      }
      if (sessionInfo.isNew) {
        const created = await this.requestPi('new_session', {}, options.signal);
        if (created?.cancelled) throw new Error('Pi cancelled creation of the isolated chat session');
      }
    }

    // Handle model and thought level configuration
    let targetModel = options.model;
    let targetThoughtLevel = 'high';

    if (this.isCodex) {
      targetThoughtLevel = options.reasoningEffort || 'medium';
    } else if (this.isPi) {
      targetThoughtLevel = options.reasoningEffort || 'high';
      const selected = this.piModelsCache.get(targetModel);
      if (!selected) throw new Error(`Pi model "${targetModel}" is unavailable or ambiguous. Reload models from the agent.`);
      if (sessionInfo.currentModel !== targetModel) {
        await this.requestPi('set_model', { provider: selected.provider, modelId: selected.id }, options.signal);
        sessionInfo.currentModel = targetModel;
      }
      if (sessionInfo.currentEffort !== targetThoughtLevel) {
        await this.requestPi('set_thinking_level', { level: targetThoughtLevel }, options.signal);
        sessionInfo.currentEffort = targetThoughtLevel;
      }
    } else {
      const optionsList = sessionInfo.configOptions || [];
      const modelOption = optionsList.find(o => o.category === 'model' || o.id === 'model');
      const effortOption = optionsList.find(o => o.category === 'thought_level' || o.category === 'reasoning_effort');
      const values = entries => (entries || []).flatMap(o => o.options ? values(o.options) : [o.value]);
      if (targetModel.startsWith('gemini-3.8-flash-') && !values(modelOption?.options).includes(targetModel)) {
        const suffix = targetModel.split('-').at(-1);
        if (['low', 'medium', 'high'].includes(suffix)) {
          targetThoughtLevel = suffix;
          targetModel = 'gemini-3.8-flash';
        }
      }
      if (options.reasoningEffort) targetThoughtLevel = options.reasoningEffort;
      if (targetModel && sessionInfo.currentModel !== targetModel) {
        if (modelOption) await this.request('session/set_config_option', { sessionId: acpSessionId, configId: modelOption.id, value: targetModel }, options.signal);
        else await this.request('session/set_model', { sessionId: acpSessionId, modelId: targetModel }, options.signal);
        sessionInfo.currentModel = targetModel;
      }
      if (effortOption && sessionInfo.currentEffort !== targetThoughtLevel) {
        if (!values(effortOption.options).includes(targetThoughtLevel)) throw new Error(`Unsupported reasoning effort: ${targetThoughtLevel}`);
        await this.request('session/set_config_option', { sessionId: acpSessionId, configId: effortOption.id, value: targetThoughtLevel }, options.signal);
        sessionInfo.currentEffort = targetThoughtLevel;
      }
    }

    options.signal?.throwIfAborted();

    // Native tool bridging is separate from DSH's LLM tool-schema contract.
    const messages = options.messages || [];
    if (messages.some(message => Array.isArray(message.content) && message.content.some(part => !['text', 'image', 'reasoning', 'tool-call', 'tool-addition', 'tool-removal'].includes(part.type)))) {
      throw new Error('Unsupported content block in the external-agent request');
    }
    const lastUserMessage = messages[messages.length - 1];
    let userText = '';
    if (lastUserMessage && lastUserMessage.content) {
      if (typeof lastUserMessage.content === 'string') {
        userText = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage.content)) {
        userText = lastUserMessage.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
      }
    }

    const imageBlocks = [];
    const imageMessages = sessionInfo.isNew ? messages : [lastUserMessage];
    for (const message of imageMessages) for (const part of Array.isArray(message?.content) ? message.content : []) {
      if (part.type !== 'image') continue;
      if (part.offloaded) { userText += `\n[Image ${part.attachment?.name || part.attachment?.attachmentId} was offloaded; use the DSH tools to read it.]`;continue; }
      if (!this.host?.readImage) throw new Error('This host cannot read DSH image attachments');
      if (!this.isPi && !this.isCodex && this.initializeResult?.agentCapabilities?.promptCapabilities?.image !== true) throw new Error('The ACP agent does not support image input');
      if (imageBlocks.length >= 8) throw new Error('At most eight images can be sent in one external-agent turn');
      imageBlocks.push(await this.host.readImage(dshSessionId, part.attachment, options.signal));
    }
    let promptText = userText;
    if (this.bindings.has(dshSessionId)) promptText += `\n\n${BRIDGE_INSTRUCTIONS}`;
    const effectiveSystem = options.system || messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')).join('\n');
    if (effectiveSystem && sessionInfo.system !== effectiveSystem) {
      promptText = `[System instructions]:\n${effectiveSystem}\n\n${promptText}`;
      sessionInfo.system = effectiveSystem;
    }
    if (sessionInfo.isNew && messages.length > 1) {
      // Include prior turns for seamless context handoff
      const history = messages
        .slice(0, -1)
        .filter(m => m.role !== 'system')
        .map((m) => {
          const role = (m.role || 'user').toUpperCase();
          const t = typeof m.content === 'string'
            ? m.content
            : (m.content || []).map(b => b.type === 'text' ? b.text : b.type === 'tool-call' ? `[Tool call ${b.name}: ${b.arguments}]` : b.type === 'tool-addition' || b.type === 'tool-removal' ? `[${b.type}: ${b.toolName}]` : '').filter(Boolean).join(' ');
          return `[${role}]: ${t}`;
        })
        .join('\n\n');
      promptText = `[Context from previous turns]:\n${history}\n\n[User]:\n${promptText}`;
    }
    if (!this.isCodex && /^\s*\/[a-z]/i.test(userText)) promptText = userText;
    sessionInfo.isNew = false;

    // Setup streaming queue
    const queue = new AsyncQueue();
    let activeBlock = null;
    let nextBlockIndex = 0;
    let tokenUsage = null;
    const toolStates = new Map();

    let outputBytes = 0, hostConcluded = false;
    const updateHandler = (update) => {
      if (!update) return;
      this.activeCalls.get(dshSessionId)?.touch();
      const bytes = Buffer.byteLength(update.content?.text || '');
      outputBytes += bytes;
      if (outputBytes > this.maxOutputBytes || queue.items.length > 4096) {
        this.activeCalls.get(dshSessionId)?.controller.abort(new Error('Agent output exceeded the stream buffer limit'));
        return;
      }
      const type = update.sessionUpdate;
      if (type === 'host_turn_concluded') {
        queue.push({ kind: 'concluded', text: update.content?.text || 'DSH tool concluded this turn.' });
        return;
      }
      if (type === 'agent_thought_chunk' && update.content?.text) {
        queue.push({ kind: 'thought', text: update.content.text });
      } else if (type === 'agent_message_chunk' && update.content?.text) {
        queue.push({ kind: 'text', text: update.content.text });
      } else if (type === 'token_usage' && update.usage) {
        tokenUsage = update.usage;
      } else if (type === 'tool_call' || type === 'tool_call_update') {
        const rawId = String(update.toolCallId || update.title || update.name || 'tool');
        if (rawId.length > 512) {
          this.activeCalls.get(dshSessionId)?.controller.abort(new Error('Agent tool identifier exceeded the size limit'));
          return;
        }
        const id = Buffer.from(rawId).toString();
        const previous = toolStates.get(id);
        const title = Buffer.from(String(update.title || update.name || previous?.title || 'tool').slice(0, 512)).toString();
        if (!previous && toolStates.size >= 1024) {
          this.activeCalls.get(dshSessionId)?.controller.abort(new Error('Agent exceeded the per-turn tool limit'));
          return;
        }
        const status = update.status || previous?.status || 'in_progress';
        toolStates.set(id, { title, status });
        if (!previous || previous.title !== title || previous.status !== status) {
          const rawDetail = status === 'failed' && Array.isArray(update.content)
            ? update.content.map(part => part.content?.text || part.text || '').filter(Boolean).join(' ').slice(0, 1000)
            : '';
          const detail = Buffer.from(rawDetail).toString();
          queue.push({ kind: 'tool', text: `\n> *[Tool ${status}: ${title}]*${detail ? ` ${detail}` : ''}\n` });
        }
      }
    };

    this.activePromptHandlers.set(acpSessionId, updateHandler);

    const promptController = new AbortController();
    if (options.signal?.aborted) promptController.abort(options.signal.reason);
    else options.signal?.addEventListener('abort', () => promptController.abort(options.signal.reason), { once: true });
    const promptSignal = promptController.signal;
    let turnId;
    let rejectTurn;
    let cancelled = false;
    let promptPromise;
    if (this.isCodex) {
      const turnCompletedPromise = new Promise((resolve, reject) => {
        rejectTurn = reject;
        this.activeTurnCompletedHandlers.set(acpSessionId, { resolve, reject });
      });

      const startPromise = this.request('turn/start', {
        threadId: acpSessionId,
        input: [{ type: 'text', text: promptText }, ...imageBlocks.map(image => ({ type: 'image', url: `data:${image.mimeType};base64,${image.data}` }))],
        model: targetModel || 'gpt-6.1-sol',
        effort: targetThoughtLevel || 'medium',
      }, promptSignal).then(result => {
        turnId = result?.turn?.id;
        return result;
      });
      promptPromise = Promise.all([startPromise, turnCompletedPromise]).then(([, turn]) => turn);
    } else if (this.isPi) {
      let resolveTurn;
      const turnCompletedPromise = new Promise((resolve, reject) => {
        resolveTurn = resolve;
        rejectTurn = reject;
        this.activeTurnCompletedHandlers.set(acpSessionId, { resolve, reject });
      });

      const startPromise = this.requestPi('prompt', { message: promptText, ...(imageBlocks.length ? { images: imageBlocks.map(image => ({ type: 'image', data: image.data, mimeType: image.mimeType })) } : {}) }, promptSignal).then(result => {
        if (result?.disposition === 'handled') resolveTurn({ handled: true });
        return result;
      });
      promptPromise = Promise.all([startPromise, turnCompletedPromise]).then(([, turn]) => turn);

    } else {
      promptPromise = this.request('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text: promptText }, ...imageBlocks.map(image => ({ type: 'image', data: image.data, mimeType: image.mimeType }))],
      }, promptSignal);
    }

    let finished = false;
    let promptResult = null;
    promptPromise
      .then((res) => {
        if (cancelled) return;
        promptResult = res;
        finished = true;
        queue.push({ kind: 'done' });
      })
      .catch((err) => {
        if (cancelled) return;
        finished = true;
        queue.push({ kind: 'error', error: err });
      });

    // Finish locally even when the agent ignores cancellation.
    const abortHandler = () => {
      if (cancelled || finished) return;
      cancelled = true;
      const error = options.signal?.reason || new DOMException('Stopped', 'AbortError');
      promptController.abort(error);
      this.activePromptHandlers.delete(acpSessionId);
      this.activeTurnCompletedHandlers.delete(acpSessionId);
      // A cancelled remote turn may still be running; never reuse its session.
      this.sessionMap.delete(dshSessionId);
      rejectTurn?.(error);
      queue.items.length = 0;
      queue.push({ kind: 'error', error });
      try {
        if (this.isCodex && turnId) {
          const interrupt = this.request('turn/interrupt', { threadId: acpSessionId, turnId }, AbortSignal.timeout(2000));
          this.controlRequests.add(interrupt);
          interrupt.catch(() => {}).finally(() => this.controlRequests.delete(interrupt));
        } else if (this.isPi) {
          this.notifyPi('abort', {});
        } else if (!this.isCodex) {
          this.notify('session/cancel', { sessionId: acpSessionId });
        }
      } catch {}
    };
    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
      if (options.signal.aborted) abortHandler();
    }

    try {
      while (!finished || queue.items.length > 0) {
        options.signal?.throwIfAborted();
        const item = await queue.next();
        options.signal?.throwIfAborted();
        if (!item) break;

        if (item.kind === 'concluded') {
          hostConcluded = true;cancelled = true;finished = true;
          this.sessionMap.delete(dshSessionId);this.recycleRequired = true;
          if (sessionInfo.savedKey) this.nativeStore?.delete(sessionInfo.savedKey);
          if (activeBlock) yield { type: 'block-end', index: activeBlock.index, block: { type: activeBlock.type, text: activeBlock.text } };
          activeBlock = { type: 'text', index: nextBlockIndex++, text: item.text };
          yield { type: 'block-start', index: activeBlock.index, blockType: 'text' };
          yield { type: 'text-delta', index: activeBlock.index, text: item.text };
          if (this.isPi) this.notifyPi('abort');
          else if (this.isCodex && turnId) this.request('turn/interrupt', { threadId: acpSessionId, turnId }, AbortSignal.timeout(2000)).catch(() => {});
          else if (!this.isCodex) this.notify('session/cancel', { sessionId: acpSessionId });
          break;
        }
        if (['thought', 'text', 'tool'].includes(item.kind)) {
          const blockType = item.kind === 'thought' ? 'reasoning' : 'text';
          if (activeBlock && activeBlock.type !== blockType) {
            yield { type: 'block-end', index: activeBlock.index, block: { type: activeBlock.type, text: activeBlock.text } };
            activeBlock = null;
          }
          if (!activeBlock) {
            activeBlock = { type: blockType, index: nextBlockIndex++, text: '' };
            yield { type: 'block-start', index: activeBlock.index, blockType };
          }
          activeBlock.text += item.text;
          yield { type: blockType === 'reasoning' ? 'reasoning-delta' : 'text-delta', index: activeBlock.index, text: item.text };
        } else if (item.kind === 'error') throw item.error;
        else if (item.kind === 'done') break;
      }
      if (activeBlock) {
        yield { type: 'block-end', index: activeBlock.index, block: { type: activeBlock.type, text: activeBlock.text } };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '' } };
      }

      // Yield token usage if available
      if (promptResult && promptResult.usage) {
        const u = promptResult.usage;
        yield {
          type: 'usage',
          usage: {
            inputTokens: u.inputTokens ?? u.input ?? 0,
            outputTokens: (u.outputTokens ?? u.output ?? 0) + (u.thoughtTokens ?? u.reasoning ?? 0),
            totalTokens: u.totalTokens ?? ((u.inputTokens ?? u.input ?? 0) + (u.outputTokens ?? u.output ?? 0)),
            reasoningTokens: u.thoughtTokens ?? u.reasoning ?? 0,
            cachedInputTokens: u.cacheRead ?? 0,
          },
        };
      } else if (tokenUsage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: tokenUsage.inputTokens ?? tokenUsage.input ?? 0,
            outputTokens: this.isCodex ? (tokenUsage.outputTokens ?? 0) : (tokenUsage.outputTokens ?? tokenUsage.output ?? 0),
            totalTokens: tokenUsage.totalTokens ?? ((tokenUsage.inputTokens ?? tokenUsage.input ?? 0) + (tokenUsage.outputTokens ?? tokenUsage.output ?? 0)),
            reasoningTokens: tokenUsage.reasoningOutputTokens ?? tokenUsage.reasoning ?? 0,
            cachedInputTokens: tokenUsage.cachedInputTokens ?? tokenUsage.cacheRead ?? 0,
          },
        };
      }

      if (history && !hostConcluded) {
        sessionInfo.history = { userCount: history.userCount, userDigest: history.userDigest };
        let file;
        if (this.isPi) { try { file = (await this.requestPi('get_state', {}, options.signal)).sessionFile; } catch { options.signal?.throwIfAborted(); } }
        if (sessionInfo.savedKey && (!this.isPi || file)) this.nativeStore.set(sessionInfo.savedKey, {
          id: acpSessionId, ...(file ? { file } : {}), ...sessionInfo.history,
        });
      }
      yield { type: 'finish', reason: { kind: 'stop' } };
    } finally {
      promptController.abort();
      rejectTurn?.(new DOMException('Stream closed', 'AbortError'));
      queue.items.length = 0;
      toolStates.clear();
      this.activePromptHandlers.delete(acpSessionId);
      this.activeTurnCompletedHandlers.delete(acpSessionId);
      if (options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  async compact(sessionId, signal) {
    const session = this.sessionMap.get(sessionId);
    if (!session) throw new Error('Start this chat once before compacting its native session');
    if (this.busy) throw new Error('Wait for the active agent turn to finish before compacting');
    const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
    if (this.isPi) return this.requestPi('compact', {}, deadline);
    if (!this.isCodex) {
      if (!this.sessionCommands.get(session.acpSessionId)?.some(command => command.name === 'compact')) throw new Error('This ACP agent has not advertised a compact command');
      return this.request('session/prompt', { sessionId: session.acpSessionId, prompt: [{ type: 'text', text: '/compact' }] }, deadline);
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes;reject = no; });
    const completion = waitWithSignal(promise, deadline);
    completion.catch(() => {});
    this.compactionWaiters.set(session.acpSessionId, { resolve, reject });
    try { await this.request('thread/compact/start', { threadId: session.acpSessionId }, deadline);return await completion; }
    finally { reject(new DOMException('Compaction closed', 'AbortError'));this.compactionWaiters.delete(session.acpSessionId); }
  }

  dispose(error = new Error('Agent process disposed')) {
    const child = this.child;
    this.child = null;
    this.fail(error);
    this.stopChild(child);
  }

  stopChild(child) { stopAgentProcess(child); }

}

/**
 * Multi-Engine ACP Adapter implementing DSH LlmAdapter.
 */
export class MultiAcpAdapter {
  constructor(engines = {}, { resolveSessionCwd, host, nativeStore, maxDaemons = 16, idleTimeoutMs = 600000 } = {}) {
    this.engines = engines;
    this.daemons = new Map();
    this.resolveSessionCwd = resolveSessionCwd;
    this.host = host;
    this.nativeStore = nativeStore;
    this.toolBridge = host ? new ToolBridge(host) : null;
    this.maxDaemons = positiveLimit(maxDaemons, 16);
    this.idleTimeoutMs = positiveLimit(idleTimeoutMs, 600000);
    this.sweepTimer = null;
    this.nextRequestId = 0;
  }

  getDaemon(provider, cwd = process.cwd(), sessionId, oneShot = false) {
    const workspace = path.resolve(expandHome(cwd));
    const engine = this.engines[provider];
    if (!engine) throw new Error(`Unknown ACP engine provider "${provider}"`);
    const key = JSON.stringify([provider, process.platform === 'win32' ? workspace.toLowerCase() : workspace,
      protocolKind(engine) === 'pi' || oneShot ? [oneShot ? 'oneshot' : 'chat', sessionId || '@catalog'] : null]);
    this.pruneIdleDaemons();
    if (!this.daemons.has(key)) {
      if (this.daemons.size >= this.maxDaemons) {
        const idle = [...this.daemons].filter(([, d]) => !d.busy).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
        if (!idle) throw new Error('All agent processes are busy. Finish a chat before starting another.');
        idle[1].dispose(); this.daemons.delete(idle[0]);
      }
      const daemon = new AcpDaemon(engine, workspace);
      daemon.provider = provider;
      daemon.host = oneShot ? null : this.host;
      daemon.nativeStore = oneShot ? null : this.nativeStore;
      this.daemons.set(key, daemon);
    }
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => this.pruneIdleDaemons(), Math.min(this.idleTimeoutMs, 60000));
      this.sweepTimer.unref?.();
    }
    this.daemons.get(key).lastUsedAt = Date.now();
    return this.daemons.get(key);
  }

  pruneIdleDaemons(now = Date.now()) {
    for (const [key, daemon] of this.daemons) {
      if (!daemon.busy && now - daemon.lastUsedAt >= this.idleTimeoutMs) {
        daemon.dispose(); this.daemons.delete(key);
      }
    }
  }

  getProviderDaemons(provider) {
    return [...this.daemons.values()].filter(daemon => daemon.provider === provider);
  }

  disposeProvider(provider) {
    for (const [key, daemon] of this.daemons) {
      if (daemon.provider !== provider) continue;
      daemon.dispose();
      this.daemons.delete(key);
    }
  }

  nativeSessions(provider) {
    return this.getProviderDaemons(provider).flatMap(daemon => [...daemon.sessionMap].map(([sessionId, native]) => ({
      sessionId, nativeId: native.acpSessionId, workspace: daemon.cwd,
      protocol: protocolKind(daemon.engine), busy: daemon.busy,
      resumable: Boolean(native.savedKey && this.nativeStore?.get(native.savedKey)),
      canCompact: daemon.isPi || daemon.isCodex || Boolean(daemon.sessionCommands.get(native.acpSessionId)?.some(command => command.name === 'compact')),
    })));
  }

  async controlSession(provider, sessionId, action, signal) {
    if (!['compact', 'rebuild'].includes(action)) throw new Error('Unknown native session action');
    if (!this.host?.maintenance) throw new Error('DSH session maintenance is unavailable');
    return this.host.maintenance(sessionId, async maintenanceSignal => {
      const daemon = this.getProviderDaemons(provider).find(d => d.sessionMap.has(sessionId));
      if (!daemon) throw new Error('This chat has no active native session');
      if (daemon.busy) throw new Error('Agent is busy');
      const combined = signal ? AbortSignal.any([signal, maintenanceSignal]) : maintenanceSignal;
      if (action === 'compact') return daemon.compact(sessionId, combined);
      const native = daemon.sessionMap.get(sessionId);
      if (native.savedKey) this.nativeStore?.delete(native.savedKey);
      daemon.sessionMap.delete(sessionId);daemon.bindings.get(sessionId)?.close();
      if (daemon.isPi) daemon.dispose();
      return { rebuiltOnNextTurn: true };
    });
  }

  providerInfo(provider) {
    const engine = this.engines[provider];
    return {
      id: provider,
      name: engine?.name || `ACP (${provider})`,
    };
  }

  providerRetryPolicy(_provider) {
    return undefined;
  }

  imageRequestPricing(_provider, _model) {
    return undefined;
  }

  async listModels(provider) {
    const engine = this.engines[provider];
    if (!engine) return [];

    if (Array.isArray(engine.models) && engine.models.length > 0) {
      return engine.models.map((m) => ({
        provider,
        id: m.id,
        name: m.name || m.id,
        description: m.description || `Model ${m.id} via ${engine.name}`,
        inputModalities: this.host?.readImage ? ['text', 'image'] : ['text'],
      }));
    }

    // Dynamic model discovery via ACP protocol
    try {
      const daemon = this.getDaemon(provider);
      return await daemon.discoverModels(provider);
    } catch (e) {
      console.warn(`[acp-multi] Model discovery failed for provider "${provider}":`, e.message || e);
      return [];
    }
  }

  async resolveModel(provider, model) {
    const engine = this.engines[provider];
    const declared = engine?.models?.find((m) => m.id === model);
    const name = declared?.name || model;

    let defaultEffort = declared?.defaultEffort || 'high';
    if (model.endsWith('-low')) defaultEffort = 'low';
    else if (model.endsWith('-medium')) defaultEffort = 'medium';

    const isCodex = engine?.id === 'codex' || provider === 'codex';
    const isPi = engine?.id === 'pi' || provider === 'pi';
    const efforts = isCodex
      ? [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
          { id: 'xhigh', name: 'Extra High' },
          { id: 'max', name: 'Max' },
        ]
      : isPi
      ? [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ]
      : [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
        ];

    return {
      provider,
      id: model,
      name,
      description: declared?.description || `Model ${name} via ${engine?.name || provider}`,
      context: { contextWindow: declared?.contextWindow || (isCodex ? 475000 : 1048576) },
      defaultMaxTokens: declared?.maxTokens || 65536,
      inputModalities: this.host?.readImage ? ['text', 'image'] : ['text'],
      reasoning: {
        efforts,
        defaultEffort: isCodex ? (declared?.defaultEffort || 'medium') : defaultEffort,
      },
    };
  }

  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    };
  }

  async *stream(options) {
    const provider = options.provider;
    const cwd = options.cwd || (options.sessionId && this.resolveSessionCwd?.(options.sessionId)) || process.cwd();
    const oneShot = !options.sessionId || Boolean(options.purpose);
    const sessionId = oneShot ? `@oneshot-${++this.nextRequestId}` : options.sessionId;
    const daemon = this.getDaemon(provider, cwd, sessionId, oneShot);
    if (this.toolBridge && !oneShot && options.tools?.length) {
      if (daemon.isPi && daemon.child && !daemon.bindings.has(sessionId)) {
        if (daemon.busy) throw new Error('Pi must be idle to enable DSH tools');
        daemon.dispose();
      }
      await this.toolBridge.bind(daemon, sessionId);
    }
    try { yield* daemon.stream({ ...options, sessionId, cwd: daemon.cwd }); }
    finally {
      if (oneShot) {
        daemon.dispose();
        for (const [key, entry] of this.daemons) if (entry === daemon) this.daemons.delete(key);
      }
    }
  }

  dispose() {
    this.toolBridge?.dispose();
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const daemon of this.daemons.values()) {
      daemon.dispose();
    }
    this.daemons.clear();
  }
}

export function apply(ctx, config) {
  // Merge engines from config with persistent custom engines
  const allEngines = { ...(config?.engines || {}) };
  try {
    const custom = loadCustomEngines();
    for (const [key, eng] of Object.entries(custom)) {
      if (!allEngines[key]) {
        allEngines[key] = eng;
      } else {
        allEngines[key] = { ...allEngines[key], ...eng };
      }
    }
  } catch (err) {
    console.warn('[acp-multi] Could not load persistent engines:', err.message);
  }

  const adapter = new MultiAcpAdapter(allEngines, {
    host: createDshHost(ctx),
    nativeStore: new NativeSessions(path.join(os.homedir(), '.dsh', 'acp-native-sessions.json')),
    resolveSessionCwd: sessionId => ctx.get('sessions')?.get(sessionId)?.header?.cwd
      ?? ctx.get('agents')?.get(sessionId)?.session?.header?.cwd,
  });
  const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
  console.log('[acp-multi] Loading Multi-Engine ACP plugin with active providers:', activeKeys);

  // Register all active provider routes with DSH's LLM runtime
  let registration = ctx.llm.registerAdapter(activeKeys, adapter);

  for (const key of activeKeys) {
    console.log(`[acp-multi] Registered provider "${key}" ("${adapter.engines[key].name}")`);
    ctx.logger?.info(`Registered ACP provider "${key}" ("${adapter.engines[key].name}")`);
  }

  // Inject Web UI if webServer is loaded
  ctx.inject(['webServer'], (webCtx) => {
    try {
      const webServer = webCtx.webServer;
      console.log('[acp-web] Registering ACP settings API');

      const handler = createAcpWebHandler({
        adapter,
        createDaemon: engine => new AcpDaemon(engine),
        getRegistration: () => registration,
        setRegistration: (reg) => {
          registration = reg;
        },
        ctx: webCtx,
      });

      const disposeRoute = webServer.register({
        kind: 'prefix',
        path: '/api/acp',
        auth: 'required',
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const origin = req.headers.origin;
            if (origin && typeof origin === 'string' && typeof req.headers.host === 'string') {
              try {
                if (new URL(origin).host !== req.headers.host) {
                  res.writeHead(403, { 'content-type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Request origin does not match this host' }));
                  return;
                }
              } catch {
                res.writeHead(403, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid origin' }));
                return;
              }
            }
          }
          return handler(req, res);
        },
      });

      webCtx.effect(() => () => {
        try {
          disposeRoute();
        } catch {}
        console.log('[acp-web] Disposed ACP Web UI route');
      });
    } catch (e) {
      console.warn('[acp-web] Failed to register web UI:', e.message);
    }
  });

  ctx.effect(() => () => {
    try {
      registration();
    } catch {}
    adapter.dispose();
    ctx.logger?.info('Multi-Engine ACP adapter disposed');
  });
}

export default {
  name,
  inject,
  Config,
  apply,
};
