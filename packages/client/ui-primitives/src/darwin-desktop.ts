/** macOS desktop detection for renderer-owned hidden-titlebar layout variants. */

/**
 * Whether the client runs in the macOS desktop shell with a renderer-owned
 * title bar. The native-titlebar desktop still has `data-platform="darwin"`,
 * but does not need the hiddenInset layout rows.
 * Read at render time — the mark may arrive as late as DOMContentLoaded.
 * @returns true only inside the macOS Electron shell.
 */
export function isDarwinDesktop(): boolean {
  const root = document.documentElement
  return root.dataset.platform === 'darwin' && !root.hasAttribute('data-native-titlebar')
}
