// Skapa konto (första start). Ser ut som inloggningen: ett formulär med företagsnamn och
// administratörens konto. Organisationsnummer och arbetstid fylls i efter inloggningen –
// arbetstiden får förvalet mån–fre 8 h tills dess.
// Visas bara när det inte finns några användare. Därefter loggas admin in och hamnar på "Kom igång".
import * as store from "../store.js";
import { html, setHTML } from "../lib/html.js";
import { MIN_PASSWORD_LENGTH } from "../auth.js";
import {
  field, input, passwordToggle, bindPasswordToggles, showFormErrors, clearFormErrors, setBusy, notify,
} from "../lib/ui.js";
import { authLayout } from "./auth-layout.js";
import { DEMO_MODE } from "../config.js";
import { demoPicker, bindDemoPicker } from "../demo/picker.js";

const HERO = {
  headline: "Kom igång med Tidla.",
  lead: "Skapa ett konto för ditt företag. Resten ställer du in när du är inloggad.",
  features: ["Klart på en minut", "Ingen installation", "Funkar i mobilen"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function render(container, ctx) {
  setHTML(
    container,
    authLayout(
      html`
        <div class="auth__intro">
          <h1 class="auth__title">Skapa konto</h1>
          <p class="auth__subtitle">Du blir administratör och kan lägga till kunder, projekt och medarbetare.</p>
        </div>

        <form class="form auth__form" data-setup-form novalidate>
          <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>

          ${field({
            id: "setup-company",
            label: "Företagsnamn",
            help: "Visas under logotypen i menyn.",
            control: input({ id: "setup-company", name: "companyName", iconName: "building", autocomplete: "organization", required: true, help: true }),
          })}
          ${field({
            id: "setup-name",
            label: "Ditt namn",
            control: input({ id: "setup-name", name: "name", iconName: "user", autocomplete: "name", required: true }),
          })}
          ${field({
            id: "setup-email",
            label: "E-post",
            help: "Det är den du loggar in med.",
            control: input({
              id: "setup-email", name: "email", type: "email", iconName: "mail",
              autocomplete: "username", inputmode: "email", autocapitalize: "none", spellcheck: "false", required: true, help: true,
            }),
          })}
          ${field({
            id: "setup-password",
            label: "Lösenord",
            help: `Minst ${MIN_PASSWORD_LENGTH} tecken.`,
            control: input({
              id: "setup-password", name: "password", type: "password", iconName: "lock",
              action: passwordToggle("setup-password"), autocomplete: "new-password", required: true, help: true,
            }),
          })}

          <button type="submit" class="btn btn--primary btn--lg btn--block">Skapa konto</button>
        </form>

        <p class="auth__footnote">Är du medarbetare? Be din administratör om en inbjudan.</p>
        ${DEMO_MODE ? demoPicker() : ""}
      `,
      HERO,
    ),
  );
  if (DEMO_MODE) bindDemoPicker(container, ctx);

  bindPasswordToggles(container);

  const form = container.querySelector("[data-setup-form]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const value = (name) => form.elements[name].value;

    // Snabbkontroll i webbläsaren – store.completeSetup() kontrollerar allt igen
    const fields = {};
    if (!value("companyName").trim()) fields.companyName = "Ange företagets namn.";
    if (!value("name").trim()) fields.name = "Ange ditt namn.";
    if (!EMAIL_RE.test(value("email").trim())) fields.email = "Ange en giltig e-postadress.";
    if (value("password").length < MIN_PASSWORD_LENGTH) fields.password = `Lösenordet måste ha minst ${MIN_PASSWORD_LENGTH} tecken.`;
    if (Object.keys(fields).length) {
      showFormErrors(form, { message: "Kontrollera de markerade fälten.", fields });
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    try {
      await store.completeSetup({
        companyName: value("companyName"),
        admin: { name: value("name"), email: value("email"), password: value("password") },
      });
      notify("Välkommen! Nu gör vi Tidla redo för dina medarbetare.");
      ctx.navigate("kom-igang");
    } catch (error) {
      setBusy(button, false);
      showFormErrors(form, error);
    }
  });
}
