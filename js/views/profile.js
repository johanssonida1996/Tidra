// Profil: kontouppgifter, tema, byta lösenord och logga ut. Samma för admin och medarbetare.
import * as store from "../store.js";
import { html, setHTML } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { MIN_PASSWORD_LENGTH, ROLES } from "../auth.js";
import {
  field, input, passwordToggle, bindPasswordToggles, showFormErrors, clearFormErrors, setBusy, notify, avatar, statusPill,
} from "../lib/ui.js";
import { themeChoiceControl } from "../theme.js";
import { ALL } from "../routes.js";
import { allowed } from "./guard.js";

export async function render(container, ctx) {
  if (!allowed(ctx, ALL, container)) return;
  const user = ctx.user;

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <h1 class="page-title">Profil</h1>
          <p class="page-lead">Dina uppgifter, utseende och lösenord.</p>
        </div>
      </div>

      <div class="grid-2">
        <section class="card stack" aria-labelledby="pf-me">
          <div class="split split--center">
            <div class="cluster">
              ${avatar(user.name, { pink: true, large: true })}
              <div>
                <h2 class="card__title" id="pf-me">${user.name}</h2>
                <p class="text-muted text-small">${user.title || ROLES[user.role]}</p>
              </div>
            </div>
            ${statusPill(user.status)}
          </div>
          <dl class="kv">
            <dt>E-post</dt><dd>${user.email}</dd>
            <dt>Anställningsnummer</dt><dd>${user.employeeNo}</dd>
            ${user.phone ? html`<dt>Telefon</dt><dd>${user.phone}</dd>` : ""}
            <dt>Roll</dt><dd>${ROLES[user.role]}</dd>
            ${ctx.settings.companyName ? html`<dt>Företag</dt><dd>${ctx.settings.companyName}</dd>` : ""}
          </dl>
          <p class="text-help">
            ${user.role === "admin"
              ? html`Ändra uppgifterna under <a href="#/anstallda">Anställda</a>.`
              : "Stämmer något inte? Be din administratör ändra det."}
          </p>
        </section>

        <section class="card stack" aria-labelledby="pf-theme">
          <h2 class="card__title" id="pf-theme">Utseende</h2>
          <p class="text-muted text-small">Automatiskt följer inställningen i din telefon eller dator.</p>
          ${themeChoiceControl()}
        </section>
      </div>

      <section class="card card--lg" aria-labelledby="pf-password">
        <form class="form" data-password-form novalidate>
          <h2 class="card__title" id="pf-password">Byt lösenord</h2>
          <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
          <input type="email" name="username" value="${user.email}" autocomplete="username" hidden />
          <div class="grid-3">
            ${field({
              id: "pf-current",
              label: "Nuvarande lösenord",
              control: input({ id: "pf-current", name: "currentPassword", type: "password", action: passwordToggle("pf-current"), autocomplete: "current-password" }),
            })}
            ${field({
              id: "pf-new",
              label: "Nytt lösenord",
              help: `Minst ${MIN_PASSWORD_LENGTH} tecken.`,
              control: input({ id: "pf-new", name: "newPassword", type: "password", action: passwordToggle("pf-new"), autocomplete: "new-password", help: true }),
            })}
            ${field({
              id: "pf-repeat",
              label: "Upprepa nytt lösenord",
              control: input({ id: "pf-repeat", name: "repeatPassword", type: "password", action: passwordToggle("pf-repeat"), autocomplete: "new-password" }),
            })}
          </div>
          <div class="form__actions">
            <button type="submit" class="btn btn--primary">Byt lösenord</button>
          </div>
        </form>
      </section>

      <section class="card split split--center" aria-label="Logga ut">
        <p class="text-muted text-small">Inloggad som ${user.email}</p>
        <button type="button" class="btn btn--secondary" data-profile-logout>${icon("logout", 17)}Logga ut</button>
      </section>
    `,
  );

  bindPasswordToggles(container);

  container.querySelector("[data-profile-logout]").addEventListener("click", async () => {
    await store.logout();
    ctx.navigate("login");
  });

  const form = container.querySelector("[data-password-form]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const repeat = form.elements.repeatPassword.value;
    const fields = {};
    if (!currentPassword) fields.currentPassword = "Ange ditt nuvarande lösenord.";
    if (newPassword.length < MIN_PASSWORD_LENGTH) fields.newPassword = `Lösenordet måste ha minst ${MIN_PASSWORD_LENGTH} tecken.`;
    else if (repeat !== newPassword) fields.repeatPassword = "Lösenorden är inte likadana.";
    if (Object.keys(fields).length) {
      showFormErrors(form, { message: "Kontrollera de markerade fälten.", fields });
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    try {
      await store.changePassword({ currentPassword, newPassword });
      form.reset();
      notify("Ditt lösenord är bytt");
    } catch (error) {
      showFormErrors(form, error);
    } finally {
      setBusy(button, false);
    }
  });
}
