/**
 * icons.js
 * --------
 * Small inline-SVG icon set. No icon font, no build step, no external
 * requests. Exposes a single global: `Icons`.
 *
 * Usage: Icons.icon("trash", { size: 16, label: "Delete" })
 *   - Omit `label` for a purely decorative icon (aria-hidden).
 *   - Pass `label` when the icon is the only content of a control, so
 *     assistive tech announces it.
 */
const Icons = (function () {
  const PATHS = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="4,12 9,17 20,6"/>',
    undo: '<path d="M4 12a8 8 0 1 1 2.6 5.9"/><polyline points="4,17 4,12 9,12"/>',
    trash:
      '<line x1="4" y1="7" x2="20" y2="7"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    pencil:
      '<path d="M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3z"/><line x1="14" y1="7" x2="17" y2="10"/>',
    search: '<circle cx="10" cy="10" r="6"/><line x1="15" y1="15" x2="20" y2="20"/>',
    sun:
      '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    refresh:
      '<path d="M20 12a8 8 0 1 1-3-6.2"/><polyline points="20,4 20,10 14,10"/>',
    users:
      '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"/><path d="M16 8a3 3 0 0 1 0 6"/><path d="M21 20c0-2.5-1.7-4.3-4-4.9"/>',
    share:
      '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><line x1="8.2" y1="10.8" x2="15.8" y2="7.2"/><line x1="8.2" y1="13.2" x2="15.8" y2="16.8"/>',
    logout:
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  };

  /** Local escape helper so this file has no dependency on session.js. */
  function escapeAttr(text) {
    return String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  }

  /**
   * Returns a markup string for the named icon.
   * @param {string} name
   * @param {{ size?: number, label?: string, className?: string }} opts
   * @returns {string}
   */
  function icon(name, opts = {}) {
    const path = PATHS[name];
    if (!path) {
      return "";
    }

    const { size = 16, label = null, className = "" } = opts;
    const a11y = label
      ? `role="img" aria-label="${escapeAttr(label)}"`
      : 'aria-hidden="true"';

    return `<span class="icon${className ? ` ${className}` : ""}" style="--icon-size:${size}px" ${a11y}><svg viewBox="0 0 24 24">${path}</svg></span>`;
  }

  return { icon };
})();
