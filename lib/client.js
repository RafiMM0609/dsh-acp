/* Browser plugin: ACP configuration lives in the DSH Settings dialog. */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-antigravity-acp',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const empty = { id: '', name: '', command: '', args: ['acp'], env: {}, models: [], disabled: false };

    async function request(action, body, signal) {
      const response = await fetch(`/api/acp/${action}`, {
        credentials: 'same-origin', signal,
        ...(body === undefined ? {} : {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }),
      });
      if (!response.ok) throw new Error(`ACP request failed (${response.status})`);
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || data.message || 'ACP operation failed');
      return data;
    }

    function AcpSettings() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [draft, setDraft] = React.useState(null);
      const [originalId, setOriginalId] = React.useState(null);
      const pending = React.useRef(null);
      const edit = (engine, existing = false) => {
        setOriginalId(existing ? engine.id : null);
        setDraft({ ...empty, ...engine, args: JSON.stringify(engine.args || [], null, 2),
          env: JSON.stringify(engine.env || {}, null, 2), models: JSON.stringify(engine.models || [], null, 2) });
        setError(''); setNotice('');
      };
      async function run(operation) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true); setError(''); setNotice('');
        try { await operation(controller.signal); }
        catch (err) { if (!controller.signal.aborted) setError(err.message); }
        finally {
          if (pending.current === controller) { pending.current = null; setBusy(false); }
        }
      }
      const reload = signal => request('engines', undefined, signal).then(setData);
      // The Settings section owns the initial request and cancels it on unmount.
      React.useEffect(() => {
        run(reload);
        return () => { pending.current?.abort(); pending.current = null; };
      }, []);
      const parsed = () => {
        const result = { ...draft, args: JSON.parse(draft.args), env: JSON.parse(draft.env), models: JSON.parse(draft.models) };
        if (!Array.isArray(result.args) || !result.args.every(v => typeof v === 'string')) throw new Error('Arguments must be a JSON array of strings.');
        if (!result.env || Array.isArray(result.env) || typeof result.env !== 'object' || !Object.values(result.env).every(v => typeof v === 'string')) throw new Error('Environment must be a JSON object of string values.');
        if (!Array.isArray(result.models) || !result.models.every(m => m && typeof m.id === 'string' && m.id.trim())) throw new Error('Models must be a JSON array with an id for each model.');
        if (!/^[a-z][a-z0-9-]*$/.test(result.id)) throw new Error('Use a lowercase engine ID, with letters, numbers or hyphens.');
        if (!result.command.trim()) throw new Error('Executable is required.');
        return result;
      };
      const button = (label, onClick) => h('button', { type: 'button', disabled: busy, onClick }, label);
      const action = (name, body) => run(async signal => {
        const result = await request(name, body, signal);
        if (name === 'probe') setNotice(`Handshake successful${result.latencyMs == null ? '' : ` (${result.latencyMs} ms)`}.`);
        else await reload(signal);
      });
      const field = (label, key, multiline = false, help = '') => h('label', { className: 'dsh-acp-field', key },
        h('span', null, label), h(multiline ? 'textarea' : 'input', {
          value: draft[key], disabled: busy || (key === 'id' && originalId !== null),
          rows: key === 'models' ? 7 : 3, spellCheck: false,
          onChange: event => setDraft(value => ({ ...value, [key]: event.target.value })),
        }), help && h('small', null, help));

      return h('section', { className: 'dsh-acp-settings', 'aria-label': 'ACP providers', 'aria-busy': busy },
        h('h2', null, 'ACP providers'),
        h('p', null, 'Manage agent connections and the models available in chat.'),
        h('div', { className: 'dsh-acp-actions' }, button('Add provider', () => edit(empty)), button('Refresh', () => run(reload))),
        error && h('p', { role: 'alert' }, error), notice && h('p', { role: 'status' }, notice),
        !data && !error && h('p', null, 'Loading providers…'),
        data && h('div', { className: 'dsh-acp-cards' }, ...data.engines.map(engine => h('article', { key: engine.id },
          h('h3', null, engine.name),
          h('p', null, engine.disabled ? 'Disabled' : engine.daemon.running ? 'Running' : 'Ready · starts when used'),
          h('code', null, engine.command),
          h('p', null, engine.models.map(model => model.name || model.id).join(' · ') || 'No configured models'),
          h('div', { className: 'dsh-acp-actions' },
            button('Edit', () => edit(engine, true)),
            button(engine.disabled ? 'Enable' : 'Disable', () => action('toggle', { id: engine.id, disabled: !engine.disabled })),
            button('Test connection', () => action('probe', { command: engine.command, args: engine.args, env: engine.env })),
            button('Reset connection', () => action('restart', { id: engine.id })),
            button('Remove', () => {
              if (window.confirm(`Remove ${engine.name}?`)) action('delete', { id: engine.id });
            })),
        ))),
        draft && h('form', { onSubmit: event => {
          event.preventDefault();
          run(async signal => {
            await request('save', parsed(), signal);
            await reload(signal); setDraft(null); setNotice('Provider saved. Available models have been updated.');
          });
        } },
          h('h3', null, originalId ? 'Edit provider' : 'Add provider'),
          !originalId && h('label', { className: 'dsh-acp-field' }, 'Preset', h('select', {
            defaultValue: '', disabled: busy,
            onChange: event => { const preset = data?.presets.find(p => p.id === event.target.value); if (preset) edit(preset); },
          }, h('option', { value: '' }, 'Custom ACP provider'),
          ...(data?.presets || []).filter(p => ['antigravity', 'opencode'].includes(p.id)).map(p => h('option', { key: p.id, value: p.id }, p.name)))),
          field('Engine ID', 'id'), field('Display name', 'name'), field('Executable', 'command'),
          field('Arguments', 'args', true, 'JSON array, for example ["acp"].'),
          field('Environment variables', 'env', true, 'JSON object. Values are stored on this host.'),
          field('Models', 'models', true, 'JSON array, for example [{"id":"model-id","name":"Model name"}].'),
          h('div', { className: 'dsh-acp-actions' }, h('button', { type: 'submit', disabled: busy }, 'Save provider'),
            button('Test connection', () => run(async signal => {
              const result = await request('probe', parsed(), signal);
              setNotice(`Handshake successful${result.latencyMs == null ? '' : ` (${result.latencyMs} ms)`}.`);
            })), button('Cancel', () => setDraft(null)))),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = `.dsh-acp-settings{color:inherit;max-width:800px;padding:8px 0}.dsh-acp-settings p{margin:10px 0;overflow-wrap:anywhere}.dsh-acp-cards{display:grid;gap:14px;margin:18px 0}.dsh-acp-cards article,.dsh-acp-settings form{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:10px;padding:16px}.dsh-acp-settings h2,.dsh-acp-settings h3{margin:0 0 12px}.dsh-acp-actions{display:flex;gap:8px;flex-wrap:wrap}.dsh-acp-settings button,.dsh-acp-settings select,.dsh-acp-settings input,.dsh-acp-settings textarea{font:inherit;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;padding:7px 10px}.dsh-acp-settings button{cursor:pointer}.dsh-acp-settings button:disabled{opacity:.5;cursor:default}.dsh-acp-field{display:grid;gap:6px;margin:14px 0}.dsh-acp-field textarea{font-family:monospace;width:100%;box-sizing:border-box;resize:vertical}.dsh-acp-field small{opacity:.7}.dsh-acp-settings [role=alert]{color:#e36b6b}.dsh-acp-settings code{overflow-wrap:anywhere}`;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'acp-settings: styles');
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'acp-providers', order: 25, label: () => 'ACP providers',
        }, AcpSettings)), 'acp-settings: section');
      },
    };
  },
});
