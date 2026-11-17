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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `ACP request failed (${response.status})`);
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
      const [selectedModels, setSelectedModels] = React.useState(null);
      const pending = React.useRef(null);
      const edit = (engine, existing = false) => {
        setOriginalId(existing ? engine.id : null);
        const detected = data?.installedScan?.find(item => item.id === engine.id && item.installed);
        setDraft({ ...empty, ...engine, command: existing ? engine.command : detected?.resolvedPath || engine.command,
          args: [...(engine.args || [])], env: Object.entries(engine.env || {}).map(([name, value]) => ({ name, value })),
          models: (engine.models || []).map(model => ({ ...model })) });
        setSelectedModels(null);
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
        const baseId = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
        let id = originalId || draft.id || (/^[a-z]/.test(baseId) ? baseId : `provider-${baseId}`);
        if (!originalId) {
          const stem = id;
          for (let suffix = 2; data?.engines.some(engine => engine.id === id); suffix++) id = `${stem}-${suffix}`;
        }
        const env = {};
        for (const row of draft.env) {
          if (!row.name.trim() && !row.value) continue;
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name)) throw new Error('Enter a valid environment variable name.');
          if (Object.hasOwn(env, row.name)) throw new Error(`Variable ${row.name} is listed twice.`);
          Object.defineProperty(env, row.name, { value: row.value, enumerable: true });
        }
        if (!draft.name.trim()) throw new Error('Enter a display name.');
        if (!draft.models.every(model => model.id.trim())) throw new Error('Enter an ID for each model, or remove the empty row.');
        if (new Set(draft.models.map(model => model.id.trim())).size !== draft.models.length) throw new Error('Each model ID must be unique.');
        const result = { ...draft, id, env, models: draft.models.map(model => ({ ...model, id: model.id.trim(), name: model.name?.trim() || model.id.trim() })) };
        if (!result.command.trim()) throw new Error('Executable is required.');
        return result;
      };
      const button = (label, onClick) => h('button', { type: 'button', disabled: busy, onClick }, label);
      const action = (name, body) => run(async signal => {
        const result = await request(name, body, signal);
        if (name === 'probe') setNotice(`Handshake successful${result.latencyMs == null ? '' : ` (${result.latencyMs} ms)`}.`);
        else await reload(signal);
      });
      const field = (label, key, help = '') => h('label', { className: 'dsh-acp-field', key },
        h('span', null, label), h('input', {
          value: draft[key], disabled: busy || (key === 'id' && originalId !== null),
          spellCheck: false,
          onChange: event => setDraft(value => ({ ...value, [key]: event.target.value })),
        }), help && h('small', null, help));
      const updateRow = (key, index, patch) => setDraft(value => ({ ...value,
        [key]: value[key].map((row, i) => i === index ? { ...row, ...patch } : row) }));
      const removeRow = (key, index) => setDraft(value => ({ ...value, [key]: value[key].filter((_, i) => i !== index) }));
      const rowField = (label, value, onChange, type = 'text') => h('label', { className: 'dsh-acp-field' },
        h('span', null, label), h('input', { type, value, disabled: busy, onChange: event => onChange(event.target.value), autoComplete: 'off' }));

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
            value: draft.presetId || '', disabled: busy,
            onChange: event => {
              const preset = data?.presets.find(p => p.id === event.target.value);
              edit(preset ? { ...preset, presetId: preset.id } : empty);
            },
          }, h('option', { value: '' }, 'Custom ACP provider'),
          ...(data?.presets || []).filter(p => p.id !== 'custom').map(p => h('option', { key: p.id, value: p.id }, p.name)))),
          field('Display name', 'name'),
          h('p', null, `Executable: ${draft.command || 'Choose a provider or set a path in Advanced'}`),
          h('h4', null, 'Models'),
          button('Load models from agent', () => run(async signal => {
            const result = await request('discover', parsed(), signal);
            if (result.models.length === 0) throw new Error('The agent did not report any models. Check its sign-in, or add a model manually.');
            setSelectedModels(result.models);
            setNotice('Choose models below, then save the provider.');
          })),
          h('small', null, ' Opens a temporary agent session using its current sign-in.'),
          selectedModels && h('fieldset', null, h('legend', null, 'Available models'), ...selectedModels.map(model =>
            h('label', { className: 'dsh-acp-choice', key: model.id }, h('input', {
              type: 'checkbox', disabled: busy, checked: draft.models.some(item => item.id === model.id),
              onChange: event => setDraft(value => ({ ...value, models: event.target.checked
                ? [...value.models, { ...model }] : value.models.filter(item => item.id !== model.id) })),
            }), model.name || model.id))),
          ...draft.models.map((model, index) => h('div', { className: 'dsh-acp-row', key: `model-${index}` },
            rowField('Model name', model.name || '', name => updateRow('models', index, { name })),
            rowField('Model ID', model.id, id => updateRow('models', index, { id })),
            button('Remove model', () => removeRow('models', index)))),
          button('Add model manually', () => setDraft(value => ({ ...value, models: [...value.models, { id: '', name: '' }] }))),
          h('details', null, h('summary', null, 'Advanced'),
            field('Executable', 'command', 'Use a command on PATH or a path starting with ~/. Paths refer to the machine running DSH.'),
            button('Detect executable', () => run(async signal => {
              const current = await request('engines', undefined, signal);
              setData(current);
              const found = current.installedScan?.find(item => item.installed && item.id === (draft.presetId || draft.id));
              if (!found) throw new Error('Executable not detected. Enter its path manually.');
              setDraft(value => ({ ...value, command: found.resolvedPath }));
              setNotice('Executable detected.');
            })),
            h('h4', null, 'Launch arguments'),
            ...draft.args.map((arg, index) => h('div', { className: 'dsh-acp-row', key: `arg-${index}` },
              rowField(`Argument ${index + 1}`, arg, text => setDraft(value => ({ ...value, args: value.args.map((item, i) => i === index ? text : item) }))),
              button('Remove argument', () => removeRow('args', index)))),
            button('Add argument', () => setDraft(value => ({ ...value, args: [...value.args, ''] }))),
            h('h4', null, 'Environment variables'),
            h('small', null, 'Optional. Values are stored as plain text on this host.'),
            ...draft.env.map((row, index) => h('div', { className: 'dsh-acp-row', key: `env-${index}` },
              rowField('Variable name', row.name, name => updateRow('env', index, { name })),
              rowField('Value', row.value, value => updateRow('env', index, { value }), 'password'),
              button('Remove variable', () => removeRow('env', index)))),
            button('Add variable', () => setDraft(value => ({ ...value, env: [...value.env, { name: '', value: '' }] })))),
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
          style.textContent = `.dsh-acp-settings{color:inherit;max-width:800px;padding:8px 0}.dsh-acp-settings p{margin:10px 0;overflow-wrap:anywhere}.dsh-acp-cards{display:grid;gap:14px;margin:18px 0}.dsh-acp-cards article,.dsh-acp-settings form{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:10px;padding:16px}.dsh-acp-settings h2,.dsh-acp-settings h3{margin:0 0 12px}.dsh-acp-actions{display:flex;gap:8px;flex-wrap:wrap}.dsh-acp-settings button,.dsh-acp-settings select,.dsh-acp-settings input,.dsh-acp-settings textarea{font:inherit;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;padding:7px 10px}.dsh-acp-settings button{cursor:pointer}.dsh-acp-settings button:disabled{opacity:.5;cursor:default}.dsh-acp-field{display:grid;gap:6px;margin:14px 0}.dsh-acp-field textarea{font-family:monospace;width:100%;box-sizing:border-box;resize:vertical}.dsh-acp-field small{opacity:.7}.dsh-acp-settings [role=alert]{color:#e36b6b}.dsh-acp-settings code{overflow-wrap:anywhere}.dsh-acp-row{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin:8px 0}.dsh-acp-row .dsh-acp-field{flex:1;min-width:140px;margin:0}.dsh-acp-settings details{margin:22px 0;border-top:1px solid color-mix(in srgb,currentColor 20%,transparent);padding-top:14px}.dsh-acp-settings summary{cursor:pointer;font-weight:600}.dsh-acp-choice{display:flex;align-items:center;gap:8px;margin:8px 0}`;
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
