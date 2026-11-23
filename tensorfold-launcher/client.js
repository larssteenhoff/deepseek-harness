// Client half: a "TensorFold" row above Settings that opens TensorFold Bar through the host route.
window.__ModuleLoader__.load({ id: '@local/tensorfold-launcher', factory: (require) => {
  const React = require('react');
  const h = React.createElement;

  const CSS = `
.tf-launch {
  display: flex; align-items: center; gap: 8px; width: 100%; height: 32px;
  padding: 6px 2px 6px 6px; border: 0; border-radius: 12px; background: transparent;
  color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer;
}
.tf-launch:hover { background: var(--dsw-alias-interactive-bg-hover); }
.tf-launch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: -2px; }
.tf-launch[data-collapsed='true'] { justify-content: center; padding: 6px; }
.tf-launch[data-state='error'] svg { color: var(--dsw-alias-danger, #f45b69); }
`;

  function ChipIcon() {
    return h('svg', {
      width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    },
      h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.5 }),
      h('rect', { x: 6.5, y: 6.5, width: 3, height: 3, rx: 0.5 }),
      h('path', { d: 'M6 1.75v2.25M10 1.75v2.25M6 12v2.25M10 12v2.25M1.75 6h2.25M1.75 10h2.25M12 6h2.25M12 10h2.25' }));
  }

  const REPOSITORY = 'https://github.com/larssteenhoff/TensorFoldBar';

  function LaunchButton({ wide }) {
    const [state, setState] = React.useState('idle');
    const open = async () => {
      setState('busy');
      try {
        const response = await fetch('tensorfold-bar/open', { method: 'POST' });
        if (response.status === 404) {
          // Not installed: show where to get it. The desktop app opens http(s) links in the browser.
          window.open(REPOSITORY, '_blank', 'noopener');
          setState('missing');
          return;
        }
        setState(response.ok ? 'idle' : 'error');
      } catch (_error) {
        // A transport failure and a refused launch read the same to the user.
        setState('error');
      }
    };
    const title = state === 'missing'
      ? 'TensorFold Bar is not installed — opened its GitHub page'
      : state === 'error' ? 'TensorFold Bar could not be opened' : 'Open TensorFold Bar';
    return h('button', {
      type: 'button', className: 'tf-launch', 'data-collapsed': String(!wide), 'data-state': state,
      'aria-label': title, title, disabled: state === 'busy', onClick: open,
    }, h(ChipIcon), wide ? h('span', null, 'TensorFold') : null);
  }

  function apply(ctx) {
    ctx.effect(() => {
      const style = document.createElement('style');
      style.dataset.plugin = 'tensorfold-launcher';
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => style.remove();
    });
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action', id: 'tensorfold-launcher',
    }, LaunchButton));
  }

  return { inject: ['slots'], apply };
} });
