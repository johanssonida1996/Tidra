// Välj eget lösenord – visas efter inloggning med engångslösenord (nya anställda och återställda lösenord).
// Routern skickar hit tills lösenordet är bytt.
import * as store from "../store.js";
import { html, setHTML } from "../lib/html.js";
import { firstName } from "../lib/format.js";
import { MIN_PASSWORD_LENGTH } from "../auth.js";
import {
  field, input, passwordToggle, bindPasswordToggles, showFormErrors, clearFormErrors, setBusy, notify,
} from "../lib/ui.js";
import { authLayout } from "./auth-layout.js";

const HERO = {
  headline: "Välkommen till Tidla.",
  lead: "Välj ett eget lösenord, så är du igång.",
};

export function render(container, ctx) {
  setHTML(
    container,
    authLayout(
      html`
        <div class="auth__intro">
          <h1 class="auth__title">Välj ett eget lösenord</h1>
          <p class="auth__subtitle">
            Hej ${firstName(ctx.user.name)}! Du loggade in med ett engångslösenord. Välj ett eget för att fortsätta.
          </p>
        </div>

        <form class="form auth__form" data-password-form novalidate>
          <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
          <input type="email" name="username" value="${ctx.user.email}" autocomplete="username" hidden />
          ${field({
            id: "pw-new",
            label: "Nytt lösenord",
            help: `Minst ${MIN_PASSWORD_LENGTH} tecken.`,
            control: input({
              id: "pw-new", name: "newPassword", type: "password", iconName: "lock",
              action: passwordToggle("pw-new"), autocomplete: "new-password", required: true, help: true,
            }),
          })}
          ${field({
            id: "pw-repeat",
            label: "Upprepa lösenordet",
            control: input({
              id: "pw-repeat", name: "repeatPassword", type: "password", iconName: "lock",
              action: passwordToggle("pw-repeat"), autocomplete: "new-password", required: true,
            }),
          })}
          <button type="submit" class="btn btn--primary btn--lg btn--block">Spara och fortsätt</button>
        </form>

        <p class="auth__footnote">
          Fel konto? <button type="button" class="link-btn" data-logout>Logga ut</button>
        </p>
      `,
      HERO,
    ),
  );

  bindPasswordToggles(container);

  container.querySelector("[data-logout]").addEventListener("click", async () => {
    await store.logout();
    ctx.navigate("login");
  });

  const form = container.querySelector("[data-password-form]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const newPassword = form.elements.newPassword.value;
    const repeat = form.elements.repeatPassword.value;
    const fields = {};
    if (newPassword.length < MIN_PASSWORD_LENGTH) fields.newPassword = `Lösenordet måste ha minst ${MIN_PASSWORD_LENGTH} tecken.`;
    else if (repeat !== newPassword) fields.repeatPassword = "Lösenorden är inte likadana.";
    if (Object.keys(fields).length) {
      showFormErrors(form, { message: "Kontrollera de markerade fälten.", fields });
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    try {
      await store.changePassword({ newPassword });
      notify("Klart! Ditt lösenord är sparat.");
      ctx.navigate("tid");
    } catch (error) {
      setBusy(button, false);
      showFormErrors(form, error);
    }
  });
}
