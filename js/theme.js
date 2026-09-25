// Ljust och mörkt tema.
// Standard: följer systemets inställning (prefers-color-scheme) via CSS.
// Temaknappen sparar ett eget val och sätter data-theme på <html>. Väljer man samma tema
// som systemet tas det egna valet bort, så att appen följer systemet igen.
import * as store from "./store.js";
import { html } from "./lib/html.js";
import { icon } from "./lib/icons.js";

const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const BAR_COLORS = { light: "#F7F5F8", dark: "#0B1024" };

export const systemTheme = () => (media?.matches ? "dark" : "light");

// "light" | "dark" | "system"
export const themeChoice = () => store.getThemePreference() ?? "system";

export const currentTheme = () => store.getThemePreference() ?? systemTheme();

export function applyTheme() {
  const preference = store.getThemePreference();
  const root = document.documentElement;
  if (preference) root.dataset.theme = preference;
  else delete root.dataset.theme;

  // Webbläsarens verktygsfält i mobilen får samma färg som sidan
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const fallback = meta.media.includes("dark") ? BAR_COLORS.dark : BAR_COLORS.light;
    meta.content = preference ? BAR_COLORS[preference] : fallback;
  });
  updateToggles();
}

export function setThemeChoice(choice) {
  store.setThemePreference(choice === "system" ? null : choice);
  applyTheme();
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  setThemeChoice(next === systemTheme() ? "system" : next);
}

/* ---------- Knappar ---------- */

// variant: "sidebar" (text + reglage), "icon" (toppfältet) eller "floating" (sidor utan meny)
export function themeToggle(variant = "icon") {
  const dark = currentTheme() === "dark";
  if (variant === "sidebar") {
    return html`<button type="button" class="sidebar__theme" data-theme-toggle="sidebar" aria-pressed="${String(dark)}">
      ${toggleContent("sidebar", dark)}
    </button>`;
  }
  return html`<button type="button" class="icon-btn icon-btn--ghost theme-toggle${variant === "floating" ? " theme-toggle--floating" : ""}"
    data-theme-toggle="${variant}" aria-pressed="${String(dark)}" aria-label="Mörkt tema" title="Mörkt tema">
    ${toggleContent(variant, dark)}
  </button>`;
}

function toggleContent(variant, dark) {
  if (variant === "sidebar") {
    return html`${icon(dark ? "moon" : "sun", 19)}<span>Mörkt tema</span><span class="switch" aria-hidden="true"></span>`;
  }
  return icon(dark ? "moon" : "sun", 20);
}

function updateToggles() {
  const dark = currentTheme() === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-pressed", String(dark));
    button.innerHTML = String(toggleContent(button.dataset.themeToggle, dark));
  });
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === themeChoice()));
  });
}

// Val i tre steg (Automatiskt / Ljust / Mörkt) – används under Profil
export function themeChoiceControl() {
  const choice = themeChoice();
  const option = (value, label, iconName) =>
    html`<button type="button" class="segmented__btn" data-theme-choice="${value}" aria-pressed="${String(choice === value)}">
      <span class="segmented__inner">${icon(iconName, 16)}${label}</span>
    </button>`;
  return html`<div class="segmented" role="group" aria-label="Tema">
    ${option("system", "Automatiskt", "monitor")}${option("light", "Ljust", "sun")}${option("dark", "Mörkt", "moon")}
  </div>`;
}

/* ---------- Start ---------- */

let started = false;

export function initTheme() {
  applyTheme();
  if (started) return;
  started = true;
  media?.addEventListener("change", applyTheme);
  store.onChange((name) => name === "theme" && applyTheme()); // val i en annan flik
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-theme-toggle]")) toggleTheme();
    const choice = event.target.closest("[data-theme-choice]");
    if (choice) setThemeChoice(choice.dataset.themeChoice);
  });
}

