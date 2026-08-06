/**
 * theme.js
 * --------
 * Wires up the dark/light theme toggle button (#themeToggleBtn) present on
 * every page. The initial theme is already applied synchronously by a small
 * inline script in each page's <head> (before CSS loads, to avoid a flash of
 * the wrong theme) — this file only handles the toggle button afterwards.
 *
 * Depends on Icons (icons.js) — load icons.js before this file.
 */
const ThemeToggle = (function () {
  const KEY = "faithrequest-theme";

  function systemPrefersDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function currentTheme() {
    const attr = document.documentElement.getAttribute("data-theme");
    return attr === "dark" || attr === "light" ? attr : systemPrefersDark() ? "dark" : "light";
  }

  function applyToggleLabel(theme) {
    const btn = document.getElementById("themeToggleBtn");
    if (!btn) {
      return;
    }
    btn.innerHTML =
      theme === "dark"
        ? Icons.icon("sun", { label: "Switch to light mode" })
        : Icons.icon("moon", { label: "Switch to dark mode" });
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
    applyToggleLabel(theme);
  }

  function init() {
    const btn = document.getElementById("themeToggleBtn");
    applyToggleLabel(currentTheme());
    if (!btn) {
      return;
    }
    btn.addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  return { init, setTheme, currentTheme };
})();

document.addEventListener("DOMContentLoaded", ThemeToggle.init);
