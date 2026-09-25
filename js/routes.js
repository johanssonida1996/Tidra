// Sidor, vilka roller som får se dem och menyerna.
// Rollen kontrolleras i routern, i varje vy och i store.js.
import { isAdmin } from "./auth.js";

export const ALL = ["admin", "employee"];
export const ADMIN = ["admin"];

// public: kräver ingen inloggning. bare: visas utan sidomeny/flikmeny.
export const ROUTES = {
  signup: { public: true, bare: true, title: "Skapa konto", load: () => import("./views/setup.js") },
  login: { public: true, bare: true, title: "Logga in", load: () => import("./views/login.js") },
  losenord: { bare: true, roles: ALL, title: "Välj lösenord", load: () => import("./views/change-password.js") },
  "kom-igang": { roles: ALL, title: "Kom igång", load: () => import("./views/getting-started.js") },
  tid: { roles: ALL, title: "Lägg till tid", load: () => import("./views/time.js") },
  granska: { roles: ALL, title: "Granskning", load: () => import("./views/review.js") },
  projekt: { roles: ALL, title: "Kunder & projekt", load: () => import("./views/projects.js") },
  anstallda: { roles: ADMIN, title: "Anställda", load: () => import("./views/staff.js") },
  material: { roles: ADMIN, title: "Material", load: () => import("./views/materials.js") },
  installningar: { roles: ADMIN, title: "Inställningar", load: () => import("./views/settings.js") },
  profil: { roles: ALL, title: "Profil", load: () => import("./views/profile.js") },
  mer: { roles: ADMIN, title: "Mer", load: () => import("./views/more.js") },
  stilguide: { public: true, bare: true, title: "Stilguide", load: () => import("./views/styleguide.js") },
};

export const HOME = "tid";

// Material är ett tillval med företagets egen benämning (Material, Produkter …)
const materialsOn = (settings) => Boolean(settings?.materials?.enabled);
const materialLabel = (settings) => settings?.materials?.label || "Material";

// Sidomenyn (dator)
export function sidebarItems(user, settings) {
  const items = [
    { route: "kom-igang", label: "Kom igång", icon: "flag" },
    { route: "tid", label: "Tidrapport", icon: "clock" },
    { route: "granska", label: "Granskning", icon: "review" },
    { route: "projekt", label: isAdmin(user) ? "Kunder & projekt" : "Projekt", icon: "folder" },
  ];
  if (isAdmin(user)) {
    items.push(
      { route: "anstallda", label: "Anställda", icon: "users" },
      ...(materialsOn(settings) ? [{ route: "material", label: materialLabel(settings), icon: "box", badge: "materials" }] : []),
      { route: "installningar", label: "Inställningar", icon: "settings" },
    );
  }
  return items;
}

// Flikmenyn (mobil). Admin: fyra flikar där den fjärde är "Mer".
// Medarbetare: fem flikar – Kom igång och Profil får egna flikar.
export function tabItems(user) {
  const items = [
    { route: "tid", label: "Tid", icon: "clock" },
    { route: "granska", label: "Granska", icon: "review" },
    { route: "projekt", label: "Projekt", icon: "folder" },
  ];
  items.push(
    ...(isAdmin(user)
      ? [{ route: "mer", label: "Mer", icon: "more", badge: "materials", also: ["kom-igang", "anstallda", "material", "installningar", "profil"] }]
      : [
          { route: "kom-igang", label: "Kom igång", icon: "flag" },
          { route: "profil", label: "Profil", icon: "user" },
        ]),
  );
  return items;
}

// Undersidor under "Mer" i mobilen
export function moreItems(settings) {
  return [
    { route: "kom-igang", label: "Kom igång", icon: "flag", text: "Steg för steg innan medarbetarna börjar" },
    { route: "anstallda", label: "Anställda", icon: "users", text: "Lägg till, redigera och inaktivera" },
    ...(materialsOn(settings)
      ? [{ route: "material", label: materialLabel(settings), icon: "box", text: "Nya uttag och artiklar", badge: "materials" }]
      : []),
    { route: "installningar", label: "Inställningar", icon: "settings", text: "Övertid, restid, frånvaro och material" },
    { route: "profil", label: "Profil", icon: "user", text: "Byt lösenord och logga ut" },
  ];
}
