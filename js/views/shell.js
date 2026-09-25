// Skalet runt inloggade vyer: sidomeny (dator), toppfält och flikmeny (mobil).
import * as store from "../store.js";
import { html, setHTML } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { avatar } from "../lib/ui.js";
import { ROLES } from "../auth.js";
import { sidebarItems, tabItems } from "../routes.js";
import { themeToggle } from "../theme.js";
import { DEMO_MODE } from "../config.js";
import { demoBar, bindDemoBar } from "../demo/picker.js";

const current = (active) => (active ? html`aria-current="page"` : "");

function navLink(item, route) {
  const active = item.route === route;
  return html`<a class="nav__link" href="#/${item.route}" ${current(active)}>
    ${icon(item.icon, 19)}
    <span>${item.label}</span>
    ${item.badge ? html`<span class="count-badge" data-badge="${item.badge}" hidden></span>` : ""}
    ${active ? html`<span class="nav__dot" aria-hidden="true"></span>` : ""}
  </a>`;
}

function tabLink(item, route) {
  const active = item.route === route || item.also?.includes(route);
  return html`<a class="tabbar__link" href="#/${item.route}" ${current(active)}>
    ${icon(item.icon, 22)}
    <span>${item.label}</span>
    ${item.badge ? html`<span class="count-badge tabbar__badge" data-badge="${item.badge}" hidden></span>` : ""}
  </a>`;
}

// Ritar skalet och returnerar elementet där vyn ska ritas
export function renderShell(root, { user, settings, route, onLogout }) {
  setHTML(
    root,
    html`
      <div class="app">
        <aside class="sidebar" aria-label="Sidomeny">
          <div class="sidebar__brand">
            <a href="#/tid" aria-label="Tidla – Lägg till tid">
              <img class="sidebar__logo" src="assets/logo/tidla-logo-mork-bakgrund.svg" alt="Tidla" width="92" height="26" />
            </a>
            ${settings.companyName ? html`<div class="sidebar__company">${settings.companyName}</div>` : ""}
          </div>
          <nav class="nav" aria-label="Huvudmeny">${sidebarItems(user, settings).map((item) => navLink(item, route))}</nav>
          <div class="sidebar__foot">
            <a class="sidebar__user" href="#/profil" ${current(route === "profil")}>
              ${avatar(user.name, { pink: true, large: true })}
              <span class="sidebar__user-text">
                <span class="sidebar__user-name">${user.name}</span>
                <span class="sidebar__user-title">${user.title || ROLES[user.role]}</span>
              </span>
            </a>
            ${themeToggle("sidebar")}
            <button type="button" class="sidebar__logout" data-logout>${icon("logout", 17)}Logga ut</button>
          </div>
        </aside>

        <header class="topbar">
          <a class="topbar__home" href="#/tid" aria-label="Tidla – Lägg till tid">
            <img class="topbar__logo logo--on-light" src="assets/logo/tidla-logo.svg" alt="Tidla" width="78" height="22" />
            <img class="topbar__logo logo--on-dark" src="assets/logo/tidla-logo-mork-bakgrund.svg" alt="Tidla" width="78" height="22" />
          </a>
          <div class="topbar__actions">
            ${themeToggle("icon")}
            <a class="topbar__avatar" href="#/profil" aria-label="Profil – ${user.name}">${avatar(user.name, { pink: true })}</a>
          </div>
        </header>

        <main class="main" id="main" tabindex="-1">
          ${DEMO_MODE ? demoBar() : ""}
          <div class="main__inner" data-view></div>
        </main>

        <nav class="tabbar" aria-label="Flikmeny">${tabItems(user).map((item) => tabLink(item, route))}</nav>
      </div>
    `,
  );

  root.querySelector("[data-logout]").addEventListener("click", async () => {
    await store.logout();
    onLogout?.();
  });

  if (DEMO_MODE) bindDemoBar(root, () => (location.hash = "#/signup"));

  updateBadges(root);
  return root.querySelector("[data-view]");
}

// Räknaren för nya materialuttag (bara admin får ett tal > 0 från store)
export async function updateBadges(root = document) {
  const count = await store.countNewMaterials().catch(() => 0);
  root.querySelectorAll('[data-badge="materials"]').forEach((badge) => {
    badge.hidden = count === 0;
    badge.textContent = String(count);
    badge.setAttribute("aria-label", `${count} nya materialuttag`);
  });
}
