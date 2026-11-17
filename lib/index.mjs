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

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expandHome, expandAgentEnv, resolveAgentLaunch } from './paths.mjs';
import {
  createAcpWebHandler,
  loadCustomEngines,
} from './web-ui.mjs';

export const name = 'dsh-plugin-antigravity-acp';
export const inject = ['llm'];

const DEFAULT_AGY_PATH = process.platform === 'win32' ? '~/AppData/Local/agy/bin/agy.exe' : 'agy';

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
          if (!key || typeof eng !== 'object') continue;
          engines[key] = {
            id: key,
            name: typeof eng.name === 'string' ? eng.name : `ACP (${key})`,
            command: typeof eng.command === 'string' ? eng.command : (key === 'antigravity' ? DEFAULT_AGY_PATH : key),
            args: Array.isArray(eng.args) ? eng.args : ['acp', '--stdio', '--dangerously-skip-permissions'],
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
  constructor(engine) {
    this.engine = engine;
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
  }

  get isCodex() {
    return this.engine.id === 'codex' || (Array.isArray(this.engine.args) && this.engine.args.includes('app-server'));
  }

  get isPi() {
    return this.engine.id === 'pi' || (Array.isArray(this.engine.args) && this.engine.args.includes('rpc'));
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

      const cwd = process.cwd();
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
      const launch = resolveAgentLaunch(cmd, args);
      cmd = launch.command;
      args = launch.args;
      const isScriptOrName = isWindows && !cmd.toLowerCase().endsWith('.exe');

      this.child = spawn(cmd, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: isScriptOrName,
        env: {
          ...process.env,
          ...expandAgentEnv(this.engine.env),
          PYTHONUNBUFFERED: '1',
        },
      });

      this.child.on('error', (err) => {
        console.error(`[acp-${this.engine.id}] child process error:`, err);
      });

      this.child.on('exit', (code, signal) => {
        console.log(`[acp-${this.engine.id}] child exited: code=${code}, signal=${signal}`);
        this.initialized = false;
        this.child = null;
        this.initPromise = null;
        for (const [id, req] of this.pending.entries()) {
          req.reject(new Error(`ACP server "${this.engine.id}" terminated unexpectedly (code: ${code})`));
        }
        this.pending.clear();
      });

      const rl = readline.createInterface({
        input: this.child.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const data = JSON.parse(line);
          if (this.isPi) {
            if (data.type === 'response') {
              if (data.id !== undefined && this.pending.has(data.id)) {
                const { resolve, reject } = this.pending.get(data.id);
                this.pending.delete(data.id);
                if (data.success === false) {
                  reject(new Error(data.error || 'Pi command failed'));
                } else {
                  resolve(data.data !== undefined ? data.data : data);
                }
                return;
              }
              for (const [id, req] of this.pending.entries()) {
                if (req.type === data.command) {
                  this.pending.delete(id);
                  if (data.success === false) {
                    req.reject(new Error(data.error || 'Pi command failed'));
                  } else {
                    req.resolve(data.data !== undefined ? data.data : data);
                  }
                  return;
                }
              }
            }
            if (data.type === 'message_update') {
              const sid = this.currentPiSessionId;
              const handler = sid ? this.activePromptHandlers.get(sid) : null;
              if (handler) {
                const ame = data.assistantMessageEvent;
                if (ame) {
                  if (ame.type === 'thinking_delta' && ame.delta) {
                    handler({ sessionUpdate: 'agent_thought_chunk', content: { text: ame.delta } });
                  } else if (ame.type === 'text_delta' && ame.delta) {
                    handler({ sessionUpdate: 'agent_message_chunk', content: { text: ame.delta } });
                  }
                }
                if (data.usage) {
                  handler({ sessionUpdate: 'token_usage', usage: data.usage });
                }
              }
              return;
            }
            if (data.type === 'turn_end') {
              const sid = this.currentPiSessionId;
              const handler = sid ? this.activePromptHandlers.get(sid) : null;
              if (handler && data.message?.usage) {
                handler({ sessionUpdate: 'token_usage', usage: data.message.usage });
              }
              return;
            }
            if (data.type === 'agent_settled') {
              const sid = this.currentPiSessionId;
              const entry = sid ? this.activeTurnCompletedHandlers.get(sid) : null;
              if (entry) {
                this.activeTurnCompletedHandlers.delete(sid);
                if (data.aborted) {
                  entry.reject(new Error('Pi run was aborted'));
                } else {
                  entry.resolve(data);
                }
              }
              return;
            }
            return;
          }

          if (data.id !== undefined && this.pending.has(data.id)) {
            const { resolve, reject } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) {
              reject(data.error);
            } else {
              resolve(data.result);
            }
          } else if (data.method === 'session/update') {
            const sid = data.params?.sessionId;
            const handler = this.activePromptHandlers.get(sid);
            if (handler) {
              handler(data.params?.update);
            }
          } else if (data.method === 'item/agentMessage/delta') {
            const threadId = data.params?.threadId;
            const handler = this.activePromptHandlers.get(threadId);
            if (handler) {
              handler({ sessionUpdate: 'agent_message_chunk', content: { text: data.params?.delta || '' } });
            }
          } else if (data.method === 'item/reasoning/delta') {
            const threadId = data.params?.threadId;
            const handler = this.activePromptHandlers.get(threadId);
            if (handler) {
              handler({ sessionUpdate: 'agent_thought_chunk', content: { text: data.params?.delta || '' } });
            }
          } else if (data.method === 'thread/tokenUsage/updated') {
            const threadId = data.params?.threadId;
            const handler = this.activePromptHandlers.get(threadId);
            if (handler) {
              handler({ sessionUpdate: 'token_usage', usage: data.params?.tokenUsage?.total });
            }
          } else if (data.method === 'turn/completed') {
            const threadId = data.params?.threadId;
            const entry = this.activeTurnCompletedHandlers.get(threadId);
            if (entry) {
              this.activeTurnCompletedHandlers.delete(threadId);
              if (data.params?.turn?.error) {
                entry.reject(new Error(data.params.turn.error.message || JSON.stringify(data.params.turn.error)));
              } else {
                entry.resolve(data.params?.turn);
              }
            }
          }
        } catch {}
      });

      // Handshake initialize
      if (this.isPi) {
        this.lastLatencyMs = 1;
        this.lastPing = Date.now();
        this.initialized = true;
        try {
          const res = await Promise.race([
            this.requestPi('get_available_models'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]);
          if (res?.models && Array.isArray(res.models)) {
            for (const m of res.models) {
              this.piModelsCache.set(m.id, m);
            }
          }
        } catch {}
        return;
      }

      const t0 = Date.now();
      await this.request('initialize', {
        protocolVersion: 1,
        ...(this.isCodex ? { capabilities: {} } : { clientCapabilities: {} }),
        clientInfo: { name: 'deepseek-harness', version: '0.2.2' },
      });
      if (this.isCodex) this.notify('initialized', {});
      this.lastLatencyMs = Date.now() - t0;
      this.lastPing = Date.now();

      this.initialized = true;
    })();

    return this.initPromise;
  }

  requestPi(type, payload = {}) {
    const id = this.msgId++;
    const message = JSON.stringify({ id, type, ...payload }) + '\n';
    this.child.stdin.write(message);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, type });
    });
  }

  notifyPi(type, payload = {}) {
    if (!this.child || this.child.killed) return;
    const message = JSON.stringify({ type, ...payload }) + '\n';
    this.child.stdin.write(message);
  }

  request(method, params) {
    const id = this.msgId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    this.child.stdin.write(payload);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  notify(method, params) {
    if (!this.child || this.child.killed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.child.stdin.write(payload);
  }

  async getOrCreateAcpSession(dshSessionId, cwd) {
    await this.ensureStarted();
    const effectiveCwd = cwd || process.cwd();
    const key = dshSessionId || 'default-session';

    if (this.sessionMap.has(key)) {
      return this.sessionMap.get(key);
    }

    if (this.isPi) {
      const info = {
        acpSessionId: key,
        currentModel: null,
        currentEffort: null,
        configOptions: [],
        availableModels: [],
        isNew: true,
        isPi: true,
      };
      this.sessionMap.set(key, info);
      return info;
    }

    if (this.isCodex) {
      const res = await this.request('thread/start', {
        cwd: effectiveCwd,
      });
      const threadId = res?.thread?.id;
      const info = {
        acpSessionId: threadId,
        currentModel: res?.thread?.model || 'gpt-6.1-sol',
        currentEffort: res?.thread?.reasoningEffort || 'medium',
        configOptions: [],
        availableModels: [],
        isNew: true,
        isCodex: true,
      };
      this.sessionMap.set(key, info);
      return info;
    }

    const res = await this.request('session/new', {
      cwd: effectiveCwd,
      mcpServers: [],
    });

    const info = {
      acpSessionId: res.sessionId,
      currentModel: 'gemini-3.8-flash',
      currentEffort: 'high',
      configOptions: res.configOptions || [],
      availableModels: res.models?.availableModels || [],
      isNew: true,
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
        inputModalities: m.inputModalities || ['text', 'image'],
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
        inputModalities: ['text', 'image'],
      }));
    }
    return session.availableModels.filter(model => typeof model.modelId === 'string').map(model => ({
      provider, id: model.modelId, name: model.name || model.modelId, description: model.description,
    }));
  }

  async discoverPiModels(provider) {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const launch = resolveAgentLaunch(this.engine.command || 'pi', this.engine.args || ['--mode', 'rpc']);
      const cmd = launch.command;
      const isScript = isWindows && !cmd.toLowerCase().endsWith('.exe');
      let child;
      try {
        child = spawn(cmd, launch.args, {
          shell: isScript,
          stdio: ['pipe', 'pipe', 'ignore'],
          env: { ...process.env, ...expandAgentEnv(this.engine.env) },
        });
      } catch (err) {
        return resolve([]);
      }

      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve([]);
      }, 8000);

      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) return;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'response' && msg.command === 'get_available_models' && msg.data?.models) {
            clearTimeout(timer);
            try { child.kill(); } catch {}
            const list = msg.data.models.map((m) => ({
              provider,
              id: m.id,
              name: m.name || m.id,
              description: `${m.name || m.id} via ${m.provider || 'Pi'}`,
              contextWindow: m.contextWindow || 200000,
              inputModalities: m.input || ['text', 'image'],
            }));
            resolve(list);
          }
        } catch {}
      });

      child.on('error', () => {
        clearTimeout(timer);
        resolve([]);
      });

      try {
        child.stdin.write(JSON.stringify({ type: 'get_available_models' }) + '\n');
      } catch {
        clearTimeout(timer);
        resolve([]);
      }
    });
  }

  async *stream(options) {
    const dshSessionId = options.sessionId || 'default-session';
    const cwd = options.cwd || process.cwd();
    const sessionInfo = await this.getOrCreateAcpSession(dshSessionId, cwd);
    const acpSessionId = sessionInfo.acpSessionId;

    if (this.isPi) {
      this.currentPiSessionId = acpSessionId;
      if (sessionInfo.isNew) {
        try {
          await this.requestPi('new_session');
        } catch {}
      }
    }

    // Handle model and thought level configuration
    let targetModel = options.model;
    let targetThoughtLevel = 'high';

    if (this.isCodex) {
      targetThoughtLevel = options.reasoningEffort || 'medium';
    } else if (this.isPi) {
      targetThoughtLevel = options.reasoningEffort || 'high';
      if (targetModel.endsWith('-low')) {
        targetThoughtLevel = 'low';
        targetModel = targetModel.slice(0, -4);
      } else if (targetModel.endsWith('-medium')) {
        targetThoughtLevel = 'medium';
        targetModel = targetModel.slice(0, -7);
      } else if (targetModel.endsWith('-high')) {
        targetThoughtLevel = 'high';
        targetModel = targetModel.slice(0, -5);
      }

      let piProvider = 'opencode-go';
      if (this.piModelsCache.has(targetModel)) {
        piProvider = this.piModelsCache.get(targetModel).provider || 'opencode-go';
      }

      try {
        if (sessionInfo.currentModel !== targetModel && targetModel) {
          await this.requestPi('set_model', { provider: piProvider, modelId: targetModel });
          sessionInfo.currentModel = targetModel;
        }
        if (sessionInfo.currentEffort !== targetThoughtLevel && targetThoughtLevel) {
          await this.requestPi('set_thinking_level', { level: targetThoughtLevel });
          sessionInfo.currentEffort = targetThoughtLevel;
        }
      } catch (e) {
        console.warn(`[acp-pi] set_model/set_thinking_level warning:`, e.message || e);
      }
    } else {
      if (targetModel.startsWith('gemini-3.8-flash')) {
        if (targetModel.endsWith('-low')) targetThoughtLevel = 'low';
        else if (targetModel.endsWith('-medium')) targetThoughtLevel = 'medium';
        else targetThoughtLevel = 'high';
        targetModel = 'gemini-3.8-flash';
      }

      if (options.reasoningEffort) {
        targetThoughtLevel = options.reasoningEffort;
      }

      try {
        if (sessionInfo.currentModel !== targetModel && targetModel) {
          await this.request('session/set_config_option', {
            sessionId: acpSessionId,
            configId: 'model',
            value: targetModel,
          });
          sessionInfo.currentModel = targetModel;
        }
        if (sessionInfo.currentEffort !== targetThoughtLevel && targetThoughtLevel) {
          await this.request('session/set_config_option', {
            sessionId: acpSessionId,
            configId: 'thought_level',
            value: targetThoughtLevel,
          });
          sessionInfo.currentEffort = targetThoughtLevel;
        }
      } catch (e) {
        console.warn(`[acp-${this.engine.id}] set_config_option warning:`, e.message || e);
      }
    }

    // Prepare prompt text
    const messages = options.messages || [];
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

    let promptText = userText;
    if (sessionInfo.isNew && messages.length > 1) {
      // Include prior turns for seamless context handoff
      const history = messages
        .slice(0, -1)
        .map((m) => {
          const role = (m.role || 'user').toUpperCase();
          const t = typeof m.content === 'string'
            ? m.content
            : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
          return `[${role}]: ${t}`;
        })
        .join('\n\n');
      promptText = `[Context from previous turns]:\n${history}\n\n[User]:\n${userText}`;
    }
    sessionInfo.isNew = false;

    // Setup streaming queue
    const queue = new AsyncQueue();
    let reasoningStarted = false;
    let reasoningEnded = false;
    let accumulatedReasoning = '';
    let textStarted = false;
    let textEnded = false;
    let accumulatedText = '';
    let tokenUsage = null;

    const updateHandler = (update) => {
      if (!update) return;
      const type = update.sessionUpdate;
      if (type === 'agent_thought_chunk' && update.content?.text) {
        queue.push({ kind: 'thought', text: update.content.text });
      } else if (type === 'agent_message_chunk' && update.content?.text) {
        queue.push({ kind: 'text', text: update.content.text });
      } else if (type === 'token_usage' && update.usage) {
        tokenUsage = update.usage;
      } else if (type === 'tool_call') {
        const title = update.title || update.name || 'tool';
        queue.push({ kind: 'tool', text: `\n> *[Tool Execution: ${title}]*\n` });
      }
    };

    this.activePromptHandlers.set(acpSessionId, updateHandler);

    let promptPromise;
    if (this.isCodex) {
      const turnCompletedPromise = new Promise((resolve, reject) => {
        this.activeTurnCompletedHandlers.set(acpSessionId, { resolve, reject });
      });

      promptPromise = (async () => {
        await this.request('turn/start', {
          threadId: acpSessionId,
          input: [{ type: 'text', text: promptText }],
          model: targetModel || 'gpt-6.1-sol',
          effort: targetThoughtLevel || 'medium',
        });
        const turnResult = await turnCompletedPromise;
        return turnResult;
      })();
    } else if (this.isPi) {
      const turnCompletedPromise = new Promise((resolve, reject) => {
        this.activeTurnCompletedHandlers.set(acpSessionId, { resolve, reject });
      });

      promptPromise = (async () => {
        const promptRes = await this.requestPi('prompt', {
          message: promptText,
        });
        if (promptRes?.disposition === 'handled') {
          return { handled: true };
        }
        const turnResult = await turnCompletedPromise;
        return turnResult;
      })();
    } else {
      promptPromise = this.request('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text: promptText }],
      });
    }

    let finished = false;
    let promptResult = null;
    promptPromise
      .then((res) => {
        promptResult = res;
        finished = true;
        queue.push({ kind: 'done' });
      })
      .catch((err) => {
        finished = true;
        queue.push({ kind: 'error', error: err });
      });

    // Handle cancellation
    const abortHandler = () => {
      if (this.isCodex) {
        this.notify('turn/interrupt', { threadId: acpSessionId });
      } else if (this.isPi) {
        this.notifyPi('abort', {});
      } else {
        this.notify('session/cancel', { sessionId: acpSessionId });
      }
    };
    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      while (!finished || queue.items.length > 0) {
        const item = await queue.next();
        if (!item) break;

        if (item.kind === 'thought') {
          if (!reasoningStarted) {
            reasoningStarted = true;
            yield { type: 'block-start', index: 0, blockType: 'reasoning' };
          }
          accumulatedReasoning += item.text;
          yield { type: 'reasoning-delta', index: 0, text: item.text };
        } else if (item.kind === 'text' || item.kind === 'tool') {
          // If reasoning was active and not closed, close it first
          if (reasoningStarted && !reasoningEnded) {
            reasoningEnded = true;
            yield {
              type: 'block-end',
              index: 0,
              block: { type: 'reasoning', text: accumulatedReasoning },
            };
          }
          if (!textStarted) {
            textStarted = true;
            yield { type: 'block-start', index: 1, blockType: 'text' };
          }
          accumulatedText += item.text;
          yield { type: 'text-delta', index: 1, text: item.text };
        } else if (item.kind === 'error') {
          throw item.error;
        } else if (item.kind === 'done') {
          break;
        }
      }

      // Cleanup trailing blocks
      if (reasoningStarted && !reasoningEnded) {
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'reasoning', text: accumulatedReasoning },
        };
      }
      if (textStarted && !textEnded) {
        yield {
          type: 'block-end',
          index: 1,
          block: { type: 'text', text: accumulatedText },
        };
      } else if (!textStarted) {
        yield { type: 'block-start', index: 1, blockType: 'text' };
        yield { type: 'text-delta', index: 1, text: '' };
        yield { type: 'block-end', index: 1, block: { type: 'text', text: '' } };
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
            outputTokens: (tokenUsage.outputTokens ?? tokenUsage.output ?? 0) + (tokenUsage.reasoningOutputTokens ?? tokenUsage.reasoning ?? 0),
            totalTokens: tokenUsage.totalTokens ?? ((tokenUsage.inputTokens ?? tokenUsage.input ?? 0) + (tokenUsage.outputTokens ?? tokenUsage.output ?? 0)),
            reasoningTokens: tokenUsage.reasoningOutputTokens ?? tokenUsage.reasoning ?? 0,
            cachedInputTokens: tokenUsage.cacheRead ?? 0,
          },
        };
      }

      yield { type: 'finish', reason: { kind: 'stop' } };
    } finally {
      this.activePromptHandlers.delete(acpSessionId);
      this.activeTurnCompletedHandlers.delete(acpSessionId);
      if (options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  dispose() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
    this.initialized = false;
    this.initPromise = null;
    this.pending.clear();
    this.sessionMap.clear();
    this.piModelsCache.clear();
    this.currentPiSessionId = null;
    this.activePromptHandlers.clear();
    this.activeTurnCompletedHandlers.clear();
  }
}

/**
 * Multi-Engine ACP Adapter implementing DSH LlmAdapter.
 */
export class MultiAcpAdapter {
  constructor(engines = {}) {
    this.engines = engines;
    this.daemons = new Map();
  }

  getDaemon(provider) {
    if (!this.daemons.has(provider)) {
      const engine = this.engines[provider];
      if (!engine) {
        throw new Error(`Unknown ACP engine provider "${provider}"`);
      }
      this.daemons.set(provider, new AcpDaemon(engine));
    }
    return this.daemons.get(provider);
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
        inputModalities: m.inputModalities || ['text', 'image'],
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
      inputModalities: declared?.inputModalities || ['text', 'image'],
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
    const daemon = this.getDaemon(provider);
    yield* daemon.stream(options);
  }

  dispose() {
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

  const adapter = new MultiAcpAdapter(allEngines);
  const activeKeys = Object.keys(adapter.engines).filter((k) => !adapter.engines[k].disabled);
  console.log('[acp-multi] Loading Multi-Engine ACP plugin with active providers:', activeKeys);

  // Register all active provider routes with DSH's LLM runtime
  let registration = ctx.llm.registerAdapter(activeKeys, adapter);

  for (const key of activeKeys) {
    console.log(`[acp-multi] Registered provider "${key}" ("${adapter.engines[key].name}")`);
    ctx.logger?.info(`Registered ACP provider "${key}" ("${adapter.engines[key].name}")`);
  }

  // Inject Web UI if webServer is loaded
  ctx.inject(['webServer', 'connection'], (webCtx) => {
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
        handler: (req, res) => {
          if (!webCtx.connection.authorizeIndex(req, res)) return;
          const requestOrigin = `${webServer.protocol}//${req.headers.host}`;
          if (req.method !== 'GET' && req.headers.origin !== requestOrigin) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request origin does not match this host' }));
            return;
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
