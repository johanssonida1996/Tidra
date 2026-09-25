// Gemensam layout för inloggning och första start (designen 2-logga-in-dator / 4-logga-in-mobil):
// marin vänsterdel med logotyp, rubrik, ingress, chip och stor bock – formuläret till höger.
// I mobilen blir vänsterdelen ett marint sidhuvud med bara logotyp och rubrik.
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";

// Standardtexten (inloggningen). Första start skickar in en egen.
const LOGIN_HERO = {
  headline: "Välkommen tillbaka.",
  lead: "Logga in och rapportera dagens tid. Det går snabbare än du tror.",
  features: ["Du ser vad som är godkänt", "Koll på veckan", "Funkar i mobilen"],
};

export function authLayout(content, hero = LOGIN_HERO) {
  const { headline, lead, features } = { ...LOGIN_HERO, ...hero };
  return html`<div class="auth">
    <header class="auth__hero">
      <svg class="auth__mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3" />
        <path d="M30 48 L45 62 L72 32" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <img class="auth__logo" src="assets/logo/tidla-logo-mork-bakgrund.svg" alt="Tidla" width="114" height="32" />
      <div class="auth__middle">
        <p class="auth__headline">${headline}</p>
        <p class="auth__lead">${lead}</p>
        <ul class="auth__chips">
          ${features.map((feature) => html`<li class="chip-on-dark">${icon("check", 14, 2.4)}${feature}</li>`)}
        </ul>
      </div>
      <p class="auth__copy">© Tidla</p>
    </header>
    <main class="auth__panel" id="main" tabindex="-1">
      <div class="auth__box">${content}</div>
    </main>
  </div>`;
}
