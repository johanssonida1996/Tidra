// Start, hash-router och rollskydd.
import * as store from "./store.js";
import { ROUTES, HOME } from "./routes.js";
import { hasRole } from "./auth.js";
import { html, setHTML } from "./lib/html.js";
import { emptyState } from "./lib/ui.js";
import { renderShell, updateBadges } from "./views/shell.js";
import { allowed } from "./views/guard.js";
import { initTheme, themeToggle } from "./theme.js";

// Temat sätts först, innan något ritas
initTheme();

const root = document.getElementById("root");
let renderCount = 0;
let cleanup = null;
let firstRender = true;

function parseHash() {
  const [name = "", ...params] = location.hash.replace(/^#\/?/, "").split("/");
  return { name, params: params.map(decodeURIComponent) };
}

export function navigate(name, ...params) {
  location.hash = "#/" + [name, ...params].map(encodeURIComponent).join("/");
}

// Byter adress utan att lägga till ett steg i historiken
function redirect(name) {
  location.replace("#/" + name);
}

// Bestämmer vart användaren ska skickas innan en vy ritas
function resolveRedirect(name, definition, session, setupNeeded) {
  if (name === "stilguide") return null;
  if (setupNeeded) return name === "signup" ? null : "signup";
  if (name === "signup") return session ? HOME : "login";
  if (!definition) return session ? HOME : "login";
  if (name === "login") return session ? (session.mustChangePassword ? "losenord" : HOME) : null;
  if (!definition.public && !session) return "login";
  if (session?.mustChangePassword && name !== "losenord") return "losenord";
  if (name === "losenord" && session && !session.mustChangePassword) return HOME;
  return null;
}

async function route() {
  const token = ++renderCount;
  const { name, params } = parseHash();
  const definition = ROUTES[name];

  try {
    const [session, setupNeeded] = await Promise.all([store.getSession(), store.needsSetup()]);
    const target = resolveRedirect(name, definition, session, setupNeeded);
    if (target) return redirect(target);

    const [settings, module] = await Promise.all([store.getSettings(), definition.load()]);
    if (token !== renderCount) return; // en nyare navigering hann före

    cleanup?.();
    cleanup = null;
    document.title = settings.companyName
      ? `${definition.title} – Tidla · ${settings.companyName}`
      : `${definition.title} – Tidla`;

    const ctx = {
      user: session,
      settings,
      params,
      route: name,
      definition,
      navigate,
      refresh: route,
    };

    let container = root;
    if (definition.bare) {
      root.innerHTML = "";
    } else {
      container = renderShell(root, { ...ctx, onLogout: () => navigate("login") });
    }

    // Rollskydd i routern – vyerna kontrollerar också själva, och store.js en tredje gång
    if (definition.roles && !hasRole(session, definition.roles)) {
      allowed(ctx, definition.roles, container);
    } else {
      cleanup = (await module.render(container, ctx)) || null;
    }

    // Sidor utan meny (inloggning, första start) får en egen temaknapp
    if (definition.bare && !root.querySelector("[data-theme-toggle]")) {
      // Läggs i sidhuvudet (landmärke) – knappen är fast placerad uppe till höger ändå
      const host = root.querySelector("header") ?? root.querySelector("main") ?? root;
      host.insertAdjacentHTML("beforeend", String(themeToggle("floating")));
    }

    // Flytta fokus till rubriken vid byte av sida, så att skärmläsare får veta var man är
    if (!firstRender) {
      const heading = container.querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
      window.scrollTo(0, 0);
    }
    firstRender = false;
  } catch (error) {
    if (error?.code === "unauthenticated") return redirect("login");
    console.error(error);
    setHTML(
      root,
      html`<div class="auth__panel"><div class="auth__box">${emptyState({
        iconName: "alert",
        title: "Något gick fel",
        text: error?.message || "Ladda om sidan och försök igen.",
        action: html`<button type="button" class="btn btn--primary" onclick="location.reload()">Ladda om</button>`,
      })}</div></div>`,
    );
  }
}

// Länken "Hoppa till innehållet" får inte ändra adressen (routern använder #/…)
document.addEventListener("click", (event) => {
  const skip = event.target.closest("[data-skip-link]");
  if (!skip) return;
  event.preventDefault();
  document.getElementById("main")?.focus();
});

store.onChange((name) => {
  if (name === "materials") updateBadges();
});

window.addEventListener("hashchange", route);

store
  .init()
  .then(route)
  .catch((error) => {
    setHTML(root, html`<div class="auth__panel"><div class="auth__box">${emptyState({ iconName: "alert", title: "Tidla kunde inte starta", text: error.message })}</div></div>`);
  });
