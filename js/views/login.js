// Inloggning enligt designen 2-logga-in-dator / 4-logga-in-mobil.
import { html, setHTML } from "../lib/html.js";
import * as store from "../store.js";
import { field, input, passwordToggle, bindPasswordToggles, callout, showFormErrors, clearFormErrors, setBusy } from "../lib/ui.js";
import { authLayout } from "./auth-layout.js";
import { DEMO_MODE } from "../config.js";
import { demoPicker, bindDemoPicker } from "../demo/picker.js";

export function render(container, ctx) {
  setHTML(
    container,
    authLayout(html`
      <div class="auth__intro">
        <h1 class="auth__title">Logga in</h1>
        <p class="auth__subtitle">Använd e-posten du blev inbjuden med.</p>
      </div>

      <form class="form auth__form" data-login-form novalidate>
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>

        ${field({
          id: "login-email",
          label: "E-post",
          control: input({
            id: "login-email",
            name: "email",
            type: "email",
            iconName: "mail",
            autocomplete: "username",
            inputmode: "email",
            autocapitalize: "none",
            spellcheck: "false",
            required: true,
          }),
        })}

        ${field({
          id: "login-password",
          label: "Lösenord",
          control: input({
            id: "login-password",
            name: "password",
            type: "password",
            iconName: "lock",
            action: passwordToggle("login-password"),
            autocomplete: "current-password",
            required: true,
          }),
        })}

        <div class="auth__row">
          <label class="check"><input type="checkbox" name="remember" checked /> Kom ihåg mig</label>
          <button type="button" class="link-btn" data-forgot aria-expanded="false" aria-controls="login-forgot">
            Glömt lösenord?
          </button>
        </div>
        <div id="login-forgot" hidden>
          ${callout("Kontakta din administratör, som kan återställa ditt lösenord.", { iconName: "key" })}
        </div>

        <button type="submit" class="btn btn--primary btn--lg btn--block">Logga in</button>

        <!-- TODO: "Skicka inloggningslänk" kräver en server som skickar e-post.
             Byggs i PHP-fasen – visas inte förrän dess.
        <div class="divider">eller</div>
        <button type="button" class="btn btn--secondary btn--lg btn--block">Skicka inloggningslänk</button>
        -->
      </form>

      <p class="auth__footnote">Ny medarbetare? Be din administratör om en inbjudan.</p>
      ${DEMO_MODE ? demoPicker() : ""}
    `),
  );
  if (DEMO_MODE) bindDemoPicker(container, ctx);

  bindPasswordToggles(container);

  const forgot = container.querySelector("[data-forgot]");
  const forgotText = container.querySelector("#login-forgot");
  forgot.addEventListener("click", () => {
    const open = forgotText.hidden;
    forgotText.hidden = !open;
    forgot.setAttribute("aria-expanded", String(open));
  });

  const form = container.querySelector("[data-login-form]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const fields = {};
    if (!email) fields.email = "Ange din e-postadress.";
    if (!password) fields.password = "Ange ditt lösenord.";
    if (Object.keys(fields).length) {
      showFormErrors(form, { message: "Fyll i e-post och lösenord.", fields });
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    try {
      const user = await store.login(email, password, form.elements.remember.checked);
      // Engångslösenord: måste välja ett eget lösenord först
      ctx.navigate(user.mustChangePassword ? "losenord" : "tid");
    } catch (error) {
      showFormErrors(form, error);
      form.elements.password.value = "";
    } finally {
      setBusy(button, false);
    }
  });
}
