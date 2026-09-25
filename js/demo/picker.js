// Testversionen: "Prova ett exempelföretag" (på Logga in och Skapa konto) och raden
// "Testversion – allt sparas i den här webbläsaren" överst i appen.
import * as store from "../store.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { confirmDialog, notify, setBusy } from "../lib/ui.js";
import { DEMO_COMPANIES, DEMO_PASSWORD } from "./companies.js";
import { loadDemoCompany, findDemoCompany } from "./seed.js";

export function demoPicker() {
  return html`<section class="demo" aria-labelledby="demo-title">
    <div class="divider">eller</div>
    <div class="stack stack--s">
      <h2 class="demo__title" id="demo-title">Prova ett exempelföretag</h2>
      <p class="demo__lead">
        Färdiga företag med anställda, projekt och tidrapporter. Lösenordet är <strong>${DEMO_PASSWORD}</strong> för alla.
      </p>
    </div>
    <ul class="demo__list">
      ${DEMO_COMPANIES.map(
        (c) => html`<li class="demo__company">
          <div class="demo__head">
            <span class="row__icon">${icon(c.icon, 19)}</span>
            <div>
              <h3 class="demo__name">${c.name}</h3>
              <p class="demo__branch">${c.branch} · ${c.employees.length + (c.pending ? 1 : 0)} anställda</p>
            </div>
          </div>
          <p class="demo__text">${c.description}</p>
          <div class="demo__actions">
            <button type="button" class="btn btn--primary btn--sm" data-demo="${c.key}" data-demo-role="admin"
              aria-label="Öppna som admin – ${c.name}">Öppna som admin</button>
            <button type="button" class="btn btn--secondary btn--sm" data-demo="${c.key}" data-demo-role="employee"
              aria-label="Öppna som medarbetare – ${c.name}">Öppna som medarbetare</button>
          </div>
          <details class="demo__logins">
            <summary>Alla inloggningar</summary>
            <ul>
              <li><span>${c.admin.name} (admin)</span><span class="demo__email">${c.admin.email}</span></li>
              ${c.employees.map((e) => html`<li><span>${e.name}</span><span class="demo__email">${e.email}</span></li>`)}
            </ul>
          </details>
        </li>`,
      )}
    </ul>
    <p class="demo__note">Testversion: allt sparas bara i den här webbläsaren. Använd inga riktiga personuppgifter.</p>
  </section>`;
}

// Kopplar knapparna i demoPicker()
// (lyssnar på själva rutan – containern ritas om mellan sidorna men finns kvar)
export function bindDemoPicker(container, ctx) {
  const section = container.querySelector(".demo");
  section?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-demo]");
    if (!button) return;
    const company = findDemoCompany(button.dataset.demo);
    const role = button.dataset.demoRole;

    if (!(await store.needsSetup())) {
      const ok = await confirmDialog({
        title: `Öppna ${company.name}?`,
        message: "Det som finns i Tidla i den här webbläsaren ersätts med exempelföretaget.",
        confirmLabel: "Öppna exempelföretaget",
      });
      if (!ok) return;
    }

    const buttons = [...section.querySelectorAll("[data-demo]")];
    buttons.forEach((b) => (b.disabled = true));
    setBusy(button, true);
    try {
      const user = await loadDemoCompany(company.key, role);
      notify(`Välkommen till ${company.name}! Du är inloggad som ${user.name}.`);
      ctx.navigate(role === "admin" ? "granska" : "tid");
    } catch (error) {
      console.error(error);
      notify("Exempelföretaget kunde inte laddas. Ladda om sidan och försök igen.", { type: "error" });
      buttons.forEach((b) => (b.disabled = false));
      setBusy(button, false);
    }
  });
}

// Raden överst i appen
export function demoBar() {
  return html`<div class="demo-bar" role="note">
    ${icon("info", 16)}
    <span>Testversion – sparas bara i den här webbläsaren.</span>
    <button type="button" class="link-btn" data-demo-reset>Byt företag</button>
  </div>`;
}

export function bindDemoBar(root, onReset) {
  root.querySelector("[data-demo-reset]")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Byta företag?",
      message: "Allt i Tidla i den här webbläsaren raderas. Sedan kan du välja ett exempelföretag eller skapa ett eget.",
      confirmLabel: "Radera och byt",
      danger: true,
    });
    if (!ok) return;
    await store.resetAllData();
    onReset();
  });
}
