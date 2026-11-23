// Dark theme colors: a solid #202020 left sidebar (no macOS translucency or blue washes)
// and #181818 behind the conversation and right sidebar.
const CSS = `
body[data-ds-dark-theme] {
  --dsw-specific-sidebar-fill: #202020 !important;
  --dsw-alias-bg-base: #181818 !important;
}
html[data-platform='darwin'] body[data-ds-dark-theme] {
  --dsw-specific-sidebar-tint: #202020 !important;
  --dsw-specific-sidebar-wash-top: transparent !important;
  --dsw-specific-sidebar-wash-top-clear: transparent !important;
  --dsw-specific-sidebar-wash-bottom: transparent !important;
  --dsw-specific-sidebar-wash-bottom-clear: transparent !important;
}
/* With macOS Reduce Transparency the column is drawn 90% opaque over the system grey; keep it solid.
   The CSS module prefixes the class with a build hash, so match its suffix. */
body[data-ds-dark-theme] [class*='_sidebarCol'] {
  background: #202020 !important;
}
`;

window.__ModuleLoader__.load({
  id: '@local/harness-colors',
  factory() {
    return {
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'harness-colors';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        });
      },
    };
  },
});
