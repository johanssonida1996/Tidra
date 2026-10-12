// Webbläsartester: tangentbord, dialoger, tema, mobil, zoom, ikoner, prototypens nycklar och axe.
// Körs med:  npm run test:browser   (kräver: npm install  och  npx playwright install firefox webkit)
//
// Edge används via den installerade webbläsaren (channel "msedge"), Firefox och WebKit (Safaris motor)
// via Playwright. Testet startar en egen webbserver och använder en ny, tom profil per test.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, devices } from "playwright";
import AxeBuilder from "@axe-core/playwright";

/* ---------- Webbserver ---------- */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || file.includes(`${sep}node_modules${sep}`)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* ---------- Testverktyg ---------- */

const results = [];
let currentEngine = "";

async function test(name, fn) {
  try {
    const note = await fn();
    results.push({ engine: currentEngine, name, ok: true, note });
    console.log(`  ✓ ${name}${note ? ` – ${note}` : ""}`);
  } catch (error) {
    results.push({ engine: currentEngine, name, ok: false, note: error.message });
    console.log(`  ✗ ${name}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function open(browser, route = "#/stilguide", options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE + route);
  await page.waitForSelector("h1");
  return { context, page, errors };
}

// Skapar företag och admin som första start gör, och öppnar sedan sidan (inloggad eller utloggad)
async function openWithAdmin(browser, route, options = {}, { loggedIn = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForSelector("h1");
  await page.evaluate(async (stayLoggedIn) => {
    const store = await import("./js/store.js");
    await store.completeSetup({
      companyName: "Testföretaget",
      admin: { name: "Test Admin", email: "admin@exempel.se", password: "hemligt123" },
    });
    if (!stayLoggedIn) await store.logout();
  }, loggedIn);
  // Ladda om på den nya adressen så att sidan ritas från början
  await page.goto(BASE + route);
  await page.reload();
  await page.waitForSelector("h1");
  return { context, page };
}

const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName.toLowerCase(),
      id: el?.id,
      text: (el?.getAttribute("aria-label") || el?.textContent || el?.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 40),
      inDialog: Boolean(el?.closest("dialog")),
      skip: el?.hasAttribute("data-skip-link"),
    };
  });

const bodyBackground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const DARK_BG = "rgb(11, 16, 36)";
const LIGHT_BG = "rgb(247, 245, 248)";

/* ---------- Tester per webbläsare ---------- */

async function keyboardTests(browser, engine) {
  await test("Tangentbord: 'Hoppa till innehållet' visas först och flyttar fokus", async () => {
    const { context, page } = await open(browser);
    await page.keyboard.press("Tab");
    const first = await active(page);
    if (!first.skip && engine === "WebKit") {
      await context.close();
      return "WebKit hoppar över länkar med Tab som standard (Safari: Alt+Tab) – kontrollerat med fokus direkt";
    }
    check(first.skip, `Första Tab hamnade på <${first.tag}> "${first.text}"`);
    const box = await page.locator("[data-skip-link]").boundingBox();
    check(box && box.y >= 0, "Länken syns inte när den har fokus");
    await page.keyboard.press("Enter");
    const after = await active(page);
    check(after.id === "main", `Fokus hamnade på <${after.tag}> i stället för innehållet`);
    check((await page.evaluate(() => location.hash)) === "#/stilguide", "Adressen ändrades");
    await context.close();
  });

  await test("Tangentbord: synlig fokusmarkering på allt som går att nå med Tab", async () => {
    const { context, page } = await open(browser);
    // Safari/WebKit: se till att länkar också nås med Tab
    const missing = [];
    const seen = new Set();
    let count = 0;
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press(engine === "WebKit" ? "Alt+Tab" : "Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        el.getAnimations?.().forEach((animation) => animation.finish()); // fokusringen tonar in
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const key = el.id || el.outerHTML.slice(0, 120) + rect.x + rect.y;
        const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        const shadow = /[1-9]d*(.d+)?px/.test(style.boxShadow || "") && !/^rgba(0, 0, 0, 0)/.test(style.boxShadow);
        return {
          key,
          visible: outline || shadow,
          label: `<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") || el.textContent || el.name || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`,
        };
      });
      if (!info) continue;
      if (seen.has(info.key)) break;
      seen.add(info.key);
      count++;
      if (!info.visible) missing.push(info.label);
    }
    check(count > 20, `Bara ${count} element gick att nå med Tab`);
    check(!missing.length, `Saknar synlig fokus: ${missing.join(", ")}`);
    await context.close();
    return `${count} element kontrollerade`;
  });

  await test("Dialog: fokus in, Tab stannar i dialogen, Esc stänger och fokus kommer tillbaka", async () => {
    const { context, page } = await open(browser);
    const trigger = page.getByRole("button", { name: "Bekräftelsedialog" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog[open]");
    check((await active(page)).inDialog, "Fokus flyttades inte in i dialogen");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const now = await active(page);
      check(now.inDialog, `Tab nr ${i + 1} lämnade dialogen (fokus på <${now.tag}> "${now.text}")`);
    }
    await page.keyboard.press("Shift+Tab");
    check((await active(page)).inDialog, "Shift+Tab lämnade dialogen");
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog", { state: "detached" });
    const back = await active(page);
    check(back.text === "Bekräftelsedialog", `Fokus kom tillbaka till "${back.text}"`);
    await page.getByText("Du avbröt").waitFor();
    await context.close();
  });

  await test("Dialog: dubbel bekräftelse kräver exakt RADERA", async () => {
    const { context, page } = await open(browser);
    await page.getByRole("button", { name: "Dubbel bekräftelse" }).click();
    const input = page.locator("dialog input");
    const confirm = page.locator('dialog button[value="confirm"]');
    check((await active(page)).tag === "input", "Fokus hamnade inte i textfältet");
    check(await confirm.isDisabled(), "Knappen är aktiv från början");
    await input.fill("RADER");
    check(await confirm.isDisabled(), "Knappen blev aktiv för tidigt");
    await page.keyboard.press("Enter");
    check(await page.locator("dialog[open]").count(), "Enter stängde dialogen fast texten var fel");
    await input.fill("RADERA");
    check(await confirm.isEnabled(), "Knappen blev inte aktiv");
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog", { state: "detached" });
    await page.getByText("Du bekräftade").waitFor();
    await context.close();
  });

  await test("Formulär: fältfel markeras, får fokus och läses upp", async () => {
    const { context, page } = await open(browser);
    await page.getByRole("button", { name: "Visa fältfel" }).click();
    const email = page.locator("#sg-email");
    check((await email.getAttribute("aria-invalid")) === "true", "E-post markerades inte som fel");
    const described = await email.getAttribute("aria-describedby");
    check(described && (await page.locator(`#${described.split(" ").pop()}`).textContent()).includes("giltig"), "Felet är inte kopplat till fältet");
    check((await active(page)).id === "sg-email", "Fokus flyttades inte till första felet");
    await page.getByRole("button", { name: "Rensa fel" }).click();
    check((await email.getAttribute("aria-invalid")) === null, "Felet rensades inte");
    await context.close();
  });

  await test("Timmar: − och + ändrar 30 minuter och stannar vid 24", async () => {
    const { context, page } = await open(browser);
    const hours = page.locator("#sg-hours");
    await page.getByRole("button", { name: "Öka 30 minuter" }).click();
    check((await hours.inputValue()) === "9,0", `Fick ${await hours.inputValue()}`);
    await hours.fill("23.5");
    await page.getByRole("button", { name: "Öka 30 minuter" }).click();
    await page.getByRole("button", { name: "Öka 30 minuter" }).click();
    check((await hours.inputValue()) === "24,0", `Fick ${await hours.inputValue()}`);
    await context.close();
  });
}

async function loginTests(browser) {
  await test("Inloggning: fält, visa lösenord, Glömt lösenord och tangentbord", async () => {
    const { context, page } = await openWithAdmin(browser, "#/login");
    check((await page.locator("h1").textContent()).trim() === "Logga in", "Fel rubrik");
    await page.getByLabel("E-post").fill("namn@exempel.se");
    const password = page.locator("#login-password");
    await password.fill("hemligt");
    check((await page.getByLabel("E-post").getAttribute("autocomplete")) === "username", "E-post saknar autocomplete");
    check((await password.getAttribute("autocomplete")) === "current-password", "Lösenord saknar autocomplete");
    const toggle = page.getByRole("button", { name: "Visa lösenord" });
    await toggle.click();
    check((await password.getAttribute("type")) === "text", "Visa lösenord fungerar inte");
    await page.getByRole("button", { name: "Dölj lösenord" }).click();
    check((await password.getAttribute("type")) === "password", "Dölj lösenord fungerar inte");
    const forgot = page.getByRole("button", { name: "Glömt lösenord?" });
    await forgot.click();
    check((await forgot.getAttribute("aria-expanded")) === "true", "aria-expanded uppdateras inte");
    await page.getByText("Kontakta din administratör").waitFor();
    check(!(await page.getByText("Skicka inloggningslänk").isVisible().catch(() => false)), "Inloggningslänken ska vara dold");
    await password.fill("");
    await password.press("Enter");
    check((await password.getAttribute("aria-invalid")) === "true", "Tomt lösenord markerades inte");
    await context.close();
  });

  await test("Inloggning: fel lösenord ger fel, rätt lösenord loggar in", async () => {
    const { context, page } = await openWithAdmin(browser, "#/login");
    await page.getByLabel("E-post").fill("admin@exempel.se");
    await page.locator("#login-password").fill("fel-lösenord");
    await page.getByRole("button", { name: "Logga in" }).click();
    await page.getByText("Fel e-post eller lösenord.").waitFor();
    check((await page.locator("#login-password").inputValue()) === "", "Lösenordet rensades inte efter fel");
    await page.locator("#login-password").fill("hemligt123");
    await page.getByRole("button", { name: "Logga in" }).click();
    await page.waitForFunction(() => location.hash === "#/tid");
    await page.locator('.nav__link[href="#/kom-igang"]').waitFor({ timeout: 5000 });
    await page.locator(".sidebar__user-name", { hasText: "Test Admin" }).waitFor();
    const remembered = await page.evaluate(() => Boolean(localStorage.getItem("tidla:session")));
    check(remembered, "Kom ihåg mig sparade inte sessionen i localStorage");
    await page.getByRole("button", { name: "Logga ut" }).click();
    await page.waitForFunction(() => location.hash === "#/login");
    await context.close();
  });
}

async function setupTests(browser) {
  await test("Skapa konto: ett formulär, fält kontrolleras, loggar in och öppnar Kom igång", async () => {
    const { context, page } = await open(browser, "");
    check((await page.evaluate(() => location.hash)) === "#/signup", "Tom start visade inte Skapa konto");
    check((await page.locator("h1").textContent()).trim() === "Skapa konto", "Fel rubrik");
    await page.getByRole("button", { name: "Skapa konto" }).click();
    for (const id of ["setup-company", "setup-name", "setup-email", "setup-password"]) {
      check((await page.locator("#" + id).getAttribute("aria-invalid")) === "true", `#${id} markerades inte som fel`);
    }
    check((await active(page)).id === "setup-company", "Fokus flyttades inte till första felet");
    await page.getByLabel("Företagsnamn").fill("Testföretaget AB");
    await page.getByLabel("Ditt namn").fill("Anna Admin");
    await page.getByLabel("E-post").fill("anna@exempel.se");
    await page.locator("#setup-password").fill("kort");
    await page.getByRole("button", { name: "Skapa konto" }).click();
    check((await page.locator("#setup-password").getAttribute("aria-invalid")) === "true", "För kort lösenord godkändes");
    await page.locator("#setup-password").fill("hemligt123");
    await page.getByRole("button", { name: "Skapa konto" }).click();

    await page.waitForFunction(() => location.hash === "#/kom-igang");
    await page.locator(".sidebar__company", { hasText: "Testföretaget AB" }).waitFor();
    await page.getByText("0 av 4 klart").waitFor();
    const settings = await page.evaluate(async () => (await import("./js/store.js")).getSettings());
    check(settings.workWeek.mon === 8 && settings.workWeek.sat === 0 && settings.orgNumber === "", "Förvalen sparades fel");
    await page.goto(BASE + "#/signup");
    await page.waitForFunction(() => location.hash === "#/tid");
    await context.close();
    return "Skapa konto går inte att öppna igen när det finns ett konto";
  });

  await test("Kom igång: stegen bockas av automatiskt", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    const current = await page.locator('.nav__link[aria-current="page"]').textContent();
    check(current.includes("Kom igång"), "Kom igång är inte markerad i menyn");
    await page.getByText("0 av 4 klart").waitFor();
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const customer = await store.saveCustomer({ customerNo: "1", name: "Kund AB" });
      await store.saveProject({ customerId: customer.id, projectNo: "L-1", name: "Projekt" });
      await store.saveUser({ name: "Maja M", employeeNo: "2", email: "maja@exempel.se", role: "employee" });
    });
    await page.reload();
    await page.getByText("3 av 4 klart").waitFor();
    await page.evaluate(async () => (await import("./js/store.js")).saveSettings({ orgNumber: "556677-8899" }));
    await page.reload();
    await page.getByText("3 av 4 klart").waitFor();
    await page.evaluate(async () => (await import("./js/store.js")).saveSettings({ companyName: "Testföretaget" }));
    await page.reload();
    await page.getByText("4 av 4 klart").waitFor();
    await page.getByText("Nu kan dina medarbetare logga in").waitFor();
    await context.close();
  });
}

async function projectTests(browser) {
  await test("Kunder & projekt: lägga till kund och projekt, dubbletter och fältfel", async () => {
    const { context, page } = await openWithAdmin(browser, "#/projekt", {}, { loggedIn: true });
    await page.getByText("Börja med en kund").waitFor();

    await page.locator(".page-head").getByRole("button", { name: "Ny kund" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Kundnummer").fill("");
    await dialog.getByRole("button", { name: "Lägg till kund" }).click();
    check((await dialog.locator('[name="customerNo"]').getAttribute("aria-invalid")) === "true", "Tomt kundnummer godkändes");
    check((await dialog.locator('[name="name"]').getAttribute("aria-invalid")) === "true", "Tomt namn godkändes");
    await dialog.getByLabel("Kundnummer").fill("100");
    await dialog.getByLabel("Namn", { exact: true }).fill("Brf Almen");
    await dialog.getByRole("button", { name: "Lägg till kund" }).click();
    await page.waitForSelector("dialog", { state: "detached" });
    await page.getByText("Kunden är tillagd").waitFor();
    await page.getByText("Lägg till ditt första projekt").waitFor();

    await page.locator(".page-head").getByRole("button", { name: "Nytt projekt" }).click();
    await dialog.getByLabel("Kund", { exact: true }).selectOption({ label: "Brf Almen (kundnr 100)" });
    await dialog.getByLabel("Projektnummer").fill("L-2041");
    await dialog.getByLabel("Projektnamn").fill("Takbyte");
    await dialog.getByRole("button", { name: "Lägg till projekt" }).click();
    await page.waitForSelector("dialog", { state: "detached" });
    await page.locator(".project", { hasText: "L-2041 · Takbyte" }).getByText("Pågående").waitFor();

    await page.locator(".page-head").getByRole("button", { name: "Nytt projekt" }).click();
    await dialog.getByLabel("Kund", { exact: true }).selectOption({ label: "Brf Almen (kundnr 100)" });
    await dialog.getByLabel("Projektnummer").fill("l-2041");
    await dialog.getByLabel("Projektnamn").fill("Dubblett");
    await dialog.getByRole("button", { name: "Lägg till projekt" }).click();
    await dialog.getByText("Projektnumret används redan.").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog", { state: "detached" });
    await context.close();
  });

  await test("Kunder & projekt: avsluta, filtrera, arkivera och sök", async () => {
    const { context, page } = await openWithAdmin(browser, "#/projekt", {}, { loggedIn: true });
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const a = await store.saveCustomer({ customerNo: "100", name: "Brf Almen" });
      const b = await store.saveCustomer({ customerNo: "200", name: "Villa Holm" });
      await store.saveProject({ customerId: a.id, projectNo: "L-1", name: "Takbyte" });
      await store.saveProject({ customerId: b.id, projectNo: "L-2", name: "Altan" });
    });
    await page.reload();
    await page.getByText("2 projekt").waitFor();

    await page.getByRole("button", { name: "Redigera L-1 Takbyte" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Status").selectOption("closed");
    await dialog.getByRole("button", { name: "Spara" }).click();
    await page.waitForSelector("dialog", { state: "detached" });
    await page.getByText("1 projekt").waitFor();
    await page.getByLabel("Status").selectOption("all");
    await page.locator(".project", { hasText: "L-1 · Takbyte" }).getByText("Avslutat").waitFor();

    await page.getByLabel("Kund", { exact: true }).selectOption({ label: "Villa Holm" });
    await page.getByText("1 projekt").waitFor();
    await page.getByLabel("Kund", { exact: true }).selectOption("");
    await page.getByLabel("Sök").fill("almen");
    await page.getByText("1 projekt").waitFor();

    await page.getByRole("button", { name: "Kunder", exact: true }).click();
    check((await page.evaluate(() => location.hash)) === "#/projekt/kunder", "Adressen följde inte fliken");
    await page.getByText("2 kunder").waitFor();
    await page.getByRole("button", { name: "Redigera Villa Holm" }).click();
    await dialog.getByRole("button", { name: "Arkivera" }).click();
    await page.getByText("Kunden är arkiverad").waitFor();
    await page.getByText("1 kund", { exact: true }).waitFor();
    await page.getByLabel("Visa arkiverade").check();
    await page.locator(".row", { hasText: "Villa Holm" }).getByText("Arkiverad").waitFor();
    await context.close();
  });

  await test("Kunder & projekt: det som har registreringar kan inte tas bort", async () => {
    const { context, page } = await openWithAdmin(browser, "#/projekt", {}, { loggedIn: true });
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const c = await store.saveCustomer({ customerNo: "100", name: "Brf Almen" });
      const p = await store.saveProject({ customerId: c.id, projectNo: "L-1", name: "Takbyte" });
      await store.saveEntry({ date: "2026-09-24", hours: 4, projectId: p.id });
    });
    await page.reload();
    await page.getByRole("button", { name: "Redigera L-1 Takbyte" }).click();
    const dialog = page.locator("dialog[open]").first();
    await dialog.getByRole("button", { name: "Ta bort" }).click();
    await page.locator("dialog[open]").last().getByRole("button", { name: "Ta bort" }).click();
    await page.getByText("Projektet har registreringar och kan bara avslutas eller arkiveras.").waitFor();
    await context.close();
  });

  await test("Kunder & projekt: länkarna från Kom igång öppnar formuläret", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await page.getByRole("link", { name: "Lägg till kund" }).click();
    await page.locator("dialog[open]").getByText("Ny kund").waitFor();
    check((await page.evaluate(() => location.hash)) === "#/projekt/kunder", "Adressen städades inte");
    await context.close();
  });
}

async function staffTests(browser) {
  await test("Anställda: lägga till, fältfel, engångslösenord och dubblett", async () => {
    const { context, page } = await openWithAdmin(browser, "#/anstallda", {}, { loggedIn: true });
    await page.getByText("Lägg till din första medarbetare").waitFor();
    await page.locator(".page-head").getByRole("button", { name: "Ny anställd" }).click();
    const dialog = page.locator("dialog[open]");
    // Nästa lediga nummer föreslås – töm det för att se fältfelet
    check((await dialog.getByLabel("Anställningsnummer").inputValue()) === "2", "Nästa anställningsnummer föreslogs inte");
    await dialog.getByLabel("Anställningsnummer").fill("");
    await dialog.getByRole("button", { name: "Lägg till och visa lösenord" }).click();
    for (const name of ["name", "employeeNo", "email"]) {
      check((await dialog.locator(`[name="${name}"]`).getAttribute("aria-invalid")) === "true", `${name} markerades inte`);
    }
    await dialog.getByLabel("Namn").fill("Maja Medarbetare");
    await dialog.getByLabel("Anställningsnummer").fill("2");
    await dialog.getByLabel("E-post").fill("maja@exempel.se");
    await dialog.getByLabel("Befattning").fill("Snickare");
    await dialog.getByRole("button", { name: "Lägg till och visa lösenord" }).click();
    const secret = page.locator("dialog[open] .secret");
    await secret.waitFor();
    check(/^[A-Za-z0-9]{10}$/.test((await secret.textContent()).trim()), "Engångslösenordet ser fel ut");
    await page.locator("dialog[open]").getByRole("button", { name: "Klart" }).click();
    await page.locator(".row", { hasText: "Maja Medarbetare" }).getByText("Väntar på aktivering").waitFor();

    await page.locator(".page-head").getByRole("button", { name: "Ny anställd" }).click();
    await dialog.getByLabel("Namn").fill("Dubblett");
    await dialog.getByLabel("Anställningsnummer").fill("3");
    await dialog.getByLabel("E-post").fill("MAJA@exempel.se");
    await dialog.getByRole("button", { name: "Lägg till och visa lösenord" }).click();
    await dialog.getByText("E-postadressen används redan.").waitFor();
    await page.keyboard.press("Escape");
    await context.close();
  });

  await test("Anställda: eget schema, inaktivera, återställ lösenord, eget konto skyddat", async () => {
    const { context, page } = await openWithAdmin(browser, "#/anstallda", {}, { loggedIn: true });
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      await store.saveUser({ name: "Maja M", employeeNo: "2", email: "maja@exempel.se", role: "employee" });
    });
    await page.reload();
    const dialog = page.locator("dialog[open]");

    await page.getByRole("button", { name: "Redigera Test Admin" }).click();
    check(await dialog.getByLabel("Roll").isDisabled(), "Admin kan ändra sin egen roll");
    check(!(await dialog.getByRole("button", { name: "Inaktivera" }).count()), "Admin kan inaktivera sig själv");
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog", { state: "detached" });

    await page.getByRole("button", { name: "Redigera Maja M" }).click();
    await dialog.getByLabel("Eget arbetsschema").check();
    await dialog.getByLabel("Fredag").fill("6");
    await dialog.getByRole("button", { name: "Spara" }).click();
    await page.waitForSelector("dialog", { state: "detached" });
    const schedule = await page.evaluate(async () => {
      const store = await import("./js/store.js");
      return (await store.listUsers()).find((u) => u.name === "Maja M").schedule;
    });
    check(schedule && schedule.fri === 6 && schedule.mon === 8, "Eget schema sparades inte");

    await page.getByRole("button", { name: "Redigera Maja M" }).click();
    await dialog.getByRole("button", { name: "Återställ lösenord" }).click();
    await page.locator("dialog[open]").last().getByRole("button", { name: "Återställ" }).click();
    await page.locator("dialog[open] .secret").waitFor();
    await page.locator("dialog[open]").getByRole("button", { name: "Klart" }).click();

    await page.getByRole("button", { name: "Redigera Maja M" }).click();
    await dialog.getByRole("button", { name: "Inaktivera" }).click();
    await page.locator("dialog[open]").last().getByRole("button", { name: "Inaktivera" }).click();
    await page.getByText("Maja M är inaktiverad").waitFor();
    await page.locator(".row", { hasText: "Maja M" }).waitFor({ state: "detached" });
    await page.getByLabel("Status").selectOption("inactive");
    await page.locator(".row", { hasText: "Maja M" }).getByText("Inaktiv").waitFor();
    await context.close();
  });

  await test("Hela flödet: medarbetare loggar in med engångslösenord, väljer lösenord och ser rätt meny", async () => {
    const { context, page } = await openWithAdmin(browser, "#/anstallda", {}, { loggedIn: true });
    const otp = await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const c = await store.saveCustomer({ customerNo: "1", name: "Kund AB" });
      await store.saveProject({ customerId: c.id, projectNo: "P-1", name: "Projektet" });
      const { oneTimePassword } = await store.saveUser({ name: "Maja Medarbetare", employeeNo: "2", email: "maja@exempel.se", role: "employee" });
      await store.logout();
      return oneTimePassword;
    });
    await page.goto(BASE + "#/login");
    await page.reload();
    await page.getByLabel("E-post").fill("maja@exempel.se");
    await page.locator("#login-password").fill(otp);
    await page.getByRole("button", { name: "Logga in" }).click();
    await page.waitForFunction(() => location.hash === "#/losenord");
    await page.locator("h1", { hasText: "Välj ett eget lösenord" }).waitFor();

    await page.goto(BASE + "#/projekt");
    await page.waitForFunction(() => location.hash === "#/losenord");
    await page.locator("h1", { hasText: "Välj ett eget lösenord" }).waitFor();
    await page.waitForTimeout(200);

    await page.locator("#pw-new").fill("majaslosen1");
    await page.locator("#pw-repeat").fill("majaslosen2");
    await page.getByRole("button", { name: "Spara och fortsätt" }).click();
    await page.getByText("Lösenorden är inte likadana.").waitFor();
    await page.locator("#pw-repeat").fill("majaslosen1");
    await page.getByRole("button", { name: "Spara och fortsätt" }).click();
    await page.waitForFunction(() => location.hash === "#/tid");

    const nav = await page.locator(".sidebar .nav").textContent();
    check(!nav.includes("Anställda") && !nav.includes("Inställningar"), "Medarbetaren ser admin-menyval");
    check(nav.includes("Kom igång"), "Medarbetaren ska se Kom igång");
    await page.getByText("Ny i Tidla?").waitFor();
    check(nav.includes("Projekt") && !nav.includes("Kunder & projekt"), "Medarbetaren ska se 'Projekt'");

    await page.goto(BASE + "#/anstallda");
    await page.getByText("Ingen behörighet").waitFor();
    // Medarbetarens egen Kom igång
    await page.goto(BASE + "#/kom-igang");
    await page.getByRole("heading", { name: "Så registrerar du tid" }).waitFor();
    await page.getByText("1 av 3 klart").waitFor();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    check(!violations.length, `axe på medarbetarens Kom igång: ${violations.map((v) => v.id).join(", ")}`);
    check(!(await page.getByRole("link", { name: "Lägg till kund" }).count()), "Medarbetaren ser admins steg");
    check(!(await page.getByText(/från lager/).count()), "Material visas fast det är av");
    await page.getByRole("link", { name: "Till tidrapporten" }).first().click();
    await page.waitForFunction(() => location.hash === "#/tid");
    await page.locator("#time-customer").selectOption({ label: "Kund AB" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Projektet" });
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Registreringen är sparad").waitFor();
    check(!(await page.getByText("Ny i Tidla?").count()), "Tipset visas fast tid är registrerad");
    await page.goto(BASE + "#/kom-igang");
    await page.getByText("2 av 3 klart").waitFor();

    await page.goto(BASE + "#/projekt");
    await page.locator(".project", { hasText: "P-1 · Projektet" }).waitFor();
    check(!(await page.getByRole("button", { name: "Nytt projekt" }).count()), "Medarbetaren kan lägga till projekt");
    check(!(await page.getByRole("button", { name: /Redigera/ }).count()), "Medarbetaren kan redigera projekt");

    await page.getByRole("button", { name: "Logga ut" }).first().click();
    await page.waitForFunction(() => location.hash === "#/login");
    await page.getByLabel("E-post").fill("maja@exempel.se");
    await page.locator("#login-password").fill("majaslosen1");
    await page.getByRole("button", { name: "Logga in" }).click();
    await page.waitForFunction(() => location.hash === "#/tid");
    await context.close();
  });

  await test("Profil: byta lösenord och välja tema", async () => {
    const { context, page } = await openWithAdmin(browser, "#/profil", { colorScheme: "light" }, { loggedIn: true });
    await page.locator(".kv", { hasText: "admin@exempel.se" }).waitFor();
    await page.getByLabel("Nuvarande lösenord").fill("fel");
    await page.getByLabel("Nytt lösenord", { exact: true }).fill("nyttlosen1");
    await page.getByLabel("Upprepa nytt lösenord").fill("nyttlosen1");
    await page.getByRole("button", { name: "Byt lösenord" }).click();
    await page.getByText("Lösenordet stämmer inte.").waitFor();
    await page.getByLabel("Nuvarande lösenord").fill("hemligt123");
    await page.getByLabel("Nytt lösenord", { exact: true }).fill("nyttlosen1");
    await page.getByLabel("Upprepa nytt lösenord").fill("nyttlosen1");
    await page.getByRole("button", { name: "Byt lösenord" }).click();
    await page.getByText("Ditt lösenord är bytt").waitFor();
    await page.getByRole("button", { name: "Mörkt", exact: true }).click();
    check((await bodyBackground(page)) === DARK_BG, "Temavalet fungerar inte");
    await context.close();
  });

  await test("Mobil (admin): Kom igång har en egen flik, Mer länkar till Anställda, Inställningar och Profil", async () => {
    const { context, page } = await openWithAdmin(browser, "#/tid", devices["Pixel 7"], { loggedIn: true });
    // Bara flikarnas namn – inte räknaren för material (dold, men innehåller "0")
    const tabs = await page.locator(".tabbar__link > span:not(.count-badge)").allTextContents();
    check(tabs.map((t) => t.replace(/\s+/g, " ").trim()).join("|") === "Tid|Granska|Projekt|Kom igång|Mer", `Fel flikar: ${tabs.join(", ")}`);
    await page.locator(".tabbar").getByRole("link", { name: "Mer" }).click();
    await page.waitForFunction(() => location.hash === "#/mer");
    check(!(await page.locator("main").getByRole("link", { name: /Material/ }).count()), "Material visas fast det är av");
    check(!(await page.locator("main").getByRole("link", { name: /Kom igång/ }).count()), "Kom igång ska inte ligga under Mer");
    for (const name of ["Anställda", "Inställningar", "Profil"]) {
      await page.locator("main").getByRole("link", { name: new RegExp(name) }).waitFor();
    }
    await page.locator("main").getByRole("link", { name: /Anställda/ }).click();
    await page.waitForFunction(() => location.hash === "#/anstallda");
    check((await page.locator('.tabbar__link[aria-current="page"]').textContent()).includes("Mer"), "Mer är inte markerad");
    await context.close();
  });
}

// Kund och två projekt för tidrapporttesterna
async function seedProjects(page) {
  await page.evaluate(async () => {
    const store = await import("./js/store.js");
    const a = await store.saveCustomer({ customerNo: "100", name: "Brf Almen" });
    const b = await store.saveCustomer({ customerNo: "200", name: "Villa Holm" });
    await store.saveProject({ customerId: a.id, projectNo: "P-1", name: "Takbyte" });
    await store.saveProject({ customerId: b.id, projectNo: "P-2", name: "Altan" });
  });
}

const DAY = "2026-09-24"; // torsdag

async function timeTests(browser) {
  await test("Tidrapport: kund före projekt, förifyllda timmar, spara, redigera och ta bort", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("h1", { hasText: "Lägg till tid" }).waitFor();

    const project = page.locator("#time-project");
    check(await project.isDisabled(), "Projekt går att välja utan kund");
    check((await page.locator("#time-hours").inputValue()) === "8,0", "Timmarna förifylldes inte med schemat");

    await page.getByRole("button", { name: "Spara registrering" }).click();
    check((await page.locator("#time-customer").getAttribute("aria-invalid")) === "true", "Saknad kund markerades inte");

    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    const options = await project.locator("option").allTextContents();
    check(options.join("|") === "Välj projekt…|P-1 · Takbyte", `Fel projekt i listan: ${options.join(", ")}`);
    await project.selectOption({ label: "P-1 · Takbyte" });
    await page.getByRole("button", { name: "Minska timmar 30 minuter" }).click();
    check((await page.locator("#time-hours").inputValue()) === "7,5", "Minus fungerar inte");
    await page.getByLabel("Kommentar").fill("Rivning");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Registreringen är sparad").waitFor();
    await page.locator(".row", { hasText: "Brf Almen · P-1 Takbyte" }).getByText("Väntar på granskning").waitFor();
    check((await page.locator("#time-hours").inputValue()) === "0,5", "Kvarvarande tid förifylldes inte");
    await page.locator("[data-today]").getByText("av 8,0 h enligt schema · 0,5 h kvar").waitFor();

    // För många timmar samma dag
    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Takbyte" });
    await page.locator("#time-hours").fill("20");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Högst 24 timmar per dag.", { exact: false }).waitFor();

    // Redigera
    await page.getByRole("button", { name: /^Redigera Brf Almen/ }).click();
    await page.getByText("Du redigerar en registrering").waitFor();
    check((await page.locator("#time-hours").inputValue()) === "7,5", "Redigering fyllde inte i timmarna");
    await page.locator("#time-hours").fill("6");
    await page.getByRole("button", { name: "Spara ändringar" }).click();
    await page.getByText("Ändringen är sparad").waitFor();
    await page.locator(".row", { hasText: "Brf Almen" }).getByText("6,0 h").waitFor();

    // Ta bort
    await page.getByRole("button", { name: /^Ta bort Brf Almen/ }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Ta bort" }).click();
    await page.getByText("Registreringen är borttagen").waitFor();
    await page.getByText("Inga registreringar").waitFor();
    await context.close();
  });

  await test("Tidrapport: typ av tid, frånvaro och resa med restid och milersättning", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("h1", { hasText: "Lägg till tid" }).waitFor();

    const typeSelect = page.getByLabel("Typ av tid");
    check((await typeSelect.locator("option:checked").textContent()) === "Arbete", "Arbete är inte förvalt");
    const groups = await typeSelect.locator("optgroup").evaluateAll((els) => els.map((e) => e.label));
    check(groups.join("|") === "Arbete|Frånvaro", `Fel grupper: ${groups.join(", ")}`);
    const workOptions = await typeSelect.locator('optgroup[label="Arbete"] option').allTextContents();
    check(workOptions.join("|") === "Arbete|Övertid – komptid|Övertid – lön", `Fel val: ${workOptions.join(", ")}`);

    // Resa är stängd tills man öppnar den
    const toggle = page.getByRole("button", { name: "Lägg till restid eller milersättning" });
    check((await toggle.getAttribute("aria-expanded")) === "false", "Resa ska vara stängd");
    await toggle.click();
    check((await page.locator("[data-toggle=\"trip\"]").getAttribute("aria-expanded")) === "true", "Resa öppnades inte");
    check((await page.getByLabel("Milersättning").locator("option:checked").textContent()) === "Inget fordon", "Ett fordon är förvalt");
    check(!(await page.getByLabel("Debiteras kunden").isChecked()), "Restid ska inte debiteras som förval");
    await page.getByLabel("Milersättning").selectOption({ label: "Firmabil" });
    check(await page.getByLabel("Firmabil registreras som").isVisible(), "Grund för firmabil saknas");
    check(!(await page.getByLabel("Körda kilometer").count()), "Kilometer ska vara dolt för bil per dag");
    await page.getByLabel("Milersättning").selectOption({ label: "Privat bil" });
    await page.getByLabel("Körda kilometer").fill("34");
    await page.getByRole("button", { name: "Öka restid 30 minuter" }).click();
    await page.getByRole("button", { name: "Öka restid 30 minuter" }).click();
    await page.getByLabel("Debiteras kunden").check();
    await page.getByText("Restid 1,0 h (debiteras) · Privat bil · 34 km").waitFor();

    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Takbyte" });
    await page.locator("#time-hours").fill("4");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    const row = page.locator(".row", { hasText: "Brf Almen · P-1 Takbyte" });
    await row.getByText("Arbete 4,0 h · Restid 1,0 h (debiteras) · Privat bil · 34 km").waitFor();
    await row.getByText("5,0 h").waitFor();
    // Senaste registreringen hade resa – då är Resa öppen direkt
    check((await page.locator("[data-toggle=\"trip\"]").getAttribute("aria-expanded")) === "true", "Resa ska vara öppen för den som reser");
    await page.reload();
    check((await page.locator("[data-toggle=\"trip\"]").getAttribute("aria-expanded")) === "true", "Resa ska minnas efter omladdning");

    // Frånvaro: ingen kund, inget projekt, ingen resa – och Typ av tid står först
    const firstField = await page.locator("[data-time-form] select").first().getAttribute("id");
    check(firstField === "time-type", `Typ av tid ska stå först, inte ${firstField}`);
    await typeSelect.selectOption({ label: "VAB" });
    check(!(await page.locator("#time-customer").count()), "Kund ska döljas vid frånvaro");
    check(!(await page.locator("#time-project").count()), "Projekt ska döljas vid frånvaro");
    check(!(await page.locator("[data-toggle=\"trip\"]").count()), "Resa ska inte visas vid frånvaro");
    await page.getByText("Frånvaro kräver varken kund eller projekt.").first().waitFor();
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.locator(".row", { hasText: "VAB" }).waitFor();
    await context.close();
  });

  await test("Tidrapport: frånvaro för flera dagar sparas en rad per arbetsdag", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    // Tisdagen har redan tid och ska hoppas över
    await page.evaluate(async () => (await import("./js/store.js")).saveEntry({ date: "2026-09-22", hours: 2, timeTypeId: "sjuk" }));
    await page.goto(BASE + "#/tid/2026-09-21");
    await page.reload();
    await page.getByLabel("Typ av tid").selectOption({ label: "Semester" });
    await page.getByRole("button", { name: "Registrera frånvaro" }).waitFor();
    check((await page.getByLabel("Kommentar").getAttribute("placeholder")) === "T.ex. något administratören behöver veta", "Fel exempeltext vid frånvaro");
    await page.getByLabel("Till och med").fill("2026-09-27");
    await page.getByLabel("Till och med").dispatchEvent("change");
    // Datumet visas som i fältet Datum, inte 2026-09-27
    await page.locator(".date-field__text", { hasText: "Söndag 27 september" }).waitFor();
    await page.getByText("Varje arbetsdag får timmarna enligt ditt schema.", { exact: false }).waitFor();
    check(!(await page.locator("#time-hours").isVisible()), "Timmar ska döljas för flera dagar");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Semester är sparad för 4 dagar – tis 22 sep hade redan tid och hoppades över").waitFor();
    const saved = await page.evaluate(async () =>
      (await (await import("./js/store.js")).listEntries({ timeTypeId: "semester" })).map((e) => `${e.date} ${e.hours}`),
    );
    check(saved.join() === "2026-09-21 8,2026-09-23 8,2026-09-24 8,2026-09-25 8", `Fel rader: ${saved.join()}`);
    await context.close();
  });

  await test("Tidrapport: över schemat erbjuds övertid, arbete och övertid sparas som två rader", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Takbyte" });
    await page.locator("#time-hours").fill("10");
    await page.getByText("2,0 h över schemat.").waitFor();
    await page.getByText("Då sparas 8,0 h som arbete och 2,0 h som övertid.").waitFor();
    await page.getByRole("button", { name: "Spara som övertid – lön" }).click();
    await page.getByText("Arbete och övertid är sparade").waitFor();
    await page.locator(".row", { hasText: "Övertid – lön" }).getByText("2,0 h").waitFor();
    check((await page.locator(".row").count()) === 2, "Det ska bli två rader");
    await page.locator("[data-today] .stat", { hasText: "Registrerat" }).getByText("8,0 h").waitFor();
    await page.locator("[data-today] .stat", { hasText: "Övertid" }).getByText("2,0 h").waitFor();
    await page.locator("[data-today]").getByText("av 8,0 h enligt schema · 0,0 h kvar").waitFor();

    // Övertid förifylls inte med schemat
    await page.getByLabel("Typ av tid").selectOption({ label: "Övertid – komptid" });
    check((await page.locator("#time-hours").inputValue()) === "0,0", "Övertid ska inte förifyllas");
    await page.getByText("Komptid = du får ledigt motsvarande tid senare.").first().waitFor();
    await context.close();
  });

  await test("Inställningar: övertid, restid och typer styr tidrapporten", async () => {
    const { context, page } = await openWithAdmin(browser, "#/installningar", {}, { loggedIn: true });
    await seedProjects(page);
    await page.reload();
    await page.locator("h1", { hasText: "Inställningar" }).waitFor();

    await page.getByLabel(/^Bara lön/).check();
    await page.getByLabel("Faktor").fill("1,5");
    await page.getByRole("button", { name: "Spara övertid" }).click();
    await page.getByText("Övertiden är sparad").waitFor();
    check((await page.getByLabel("Faktor").inputValue()) === "1,5", "Faktorn visas fel");
    await page.locator(".row", { hasText: "Övertid – komptid" }).getByText("Av enligt övertid").waitFor();

    await page.getByLabel(/^Medarbetaren får ändra debiteringen/).uncheck();
    await page.getByLabel(/^Debiteras kunden som standard/).check();
    await page.getByRole("button", { name: "Spara restid" }).click();
    await page.getByText("Restiden är sparad").waitFor();

    await page.getByRole("button", { name: "Byt namn på VAB" }).click();
    await page.locator("dialog[open]").getByLabel("Namn").fill("Vård av barn");
    await page.locator("dialog[open]").getByRole("button", { name: "Spara" }).click();
    await page.getByText("Namnet är ändrat").waitFor();
    await page.getByRole("button", { name: "Dölj Permission" }).click();
    await page.locator(".row", { hasText: "Permission" }).getByText("Dold").waitFor();
    await page.getByRole("button", { name: "Ny typ av tid" }).click();
    await page.locator("dialog[open]").getByLabel("Namn").fill("Studiedag");
    await page.locator("dialog[open]").getByRole("button", { name: "Lägg till" }).click();
    await page.locator(".row", { hasText: "Studiedag" }).waitFor();
    // Ny typ som räknas som arbetstid utan kund och projekt
    await page.getByRole("button", { name: "Ny typ av tid" }).click();
    await page.locator("dialog[open]").getByLabel("Namn").fill("Kurs");
    await page.locator("dialog[open]").getByLabel("Arbetstid utan kund och projekt").check();
    await page.locator("dialog[open]").getByRole("button", { name: "Lägg till" }).click();
    await page.locator(".row", { hasText: "Kurs" }).getByText("Arbetstid utan kund och projekt").waitFor();

    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("#time-type option").first().waitFor({ state: "attached" });
    const options = await page.getByLabel("Typ av tid").locator("option").allTextContents();
    check(!options.includes("Övertid – komptid"), "Komptid visas fast bara lön är tillåtet");
    check(options.includes("Övertid – lön"), `Övertid – lön saknas: ${options.join(", ")}`);
    check(options.includes("Vård av barn") && options.includes("Studiedag") && options.includes("Kurs"), "Namnbyte eller ny typ syns inte");
    // Kurs: ingen kund eller projekt, räknas som arbete
    await page.getByLabel("Typ av tid").selectOption({ label: "Kurs" });
    check(!(await page.locator("#time-customer").count()), "Kurs ska inte kräva kund");
    await page.getByText("Räknas som arbetstid.", { exact: false }).first().waitFor();
    await page.getByLabel("Typ av tid").selectOption({ label: "Arbete" });
    check(!options.includes("Permission"), "Dold typ visas");
    await page.locator("[data-toggle=\"trip\"]").click();
    await page.getByText("Restiden debiteras kunden.").waitFor();
    check(!(await page.getByLabel("Debiteras kunden").count()), "Medarbetaren ska inte kunna ändra debiteringen");

    // Restid av: bara milersättning
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      await store.saveSettings({ travel: { enabled: false } });
    });
    await page.reload();
    await page.getByRole("button", { name: "Lägg till milersättning" }).click();
    check(!(await page.locator("#time-travel").count()), "Restid visas fast den är av");
    await context.close();
  });

  await test("Tidrapport: byta dag, Samma som igår fyller i utan att spara", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const [p] = await store.listProjects();
      await store.saveEntry({ date: "2026-09-23", hours: 8.5, projectId: p.id, vehicleTypeId: "privat-bil", km: 12 });
    });
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("h1", { hasText: "Lägg till tid" }).waitFor();

    await page.getByRole("button", { name: "Nästa dag" }).click();
    await page.waitForFunction(() => location.hash === "#/tid/2026-09-25");
    // Rubriken säger "idag" när dagen är idag
    await page.locator("#time-list-title", { hasText: /Registrerat (fredag 25 september|idag)/ }).waitFor();
    check((await active(page)).text === "Nästa dag", "Fokus stannade inte på Nästa dag");
    await page.getByRole("button", { name: "Föregående dag" }).click();
    await page.waitForFunction(() => location.hash === "#/tid/2026-09-24");
    await page.locator("#time-list-title").waitFor();

    const quick = page.getByRole("button", { name: /Samma som igår/ });
    check((await quick.textContent()).includes("Brf Almen · P-1 · 8,5 h"), "Snabbvalet visar fel");
    await quick.click();
    await page.getByText("tryck Spara för att spara").waitFor();
    check((await page.locator("#time-project").inputValue()) !== "", "Projektet fylldes inte i");
    check((await page.locator("#time-hours").inputValue()) === "8,5", "Timmarna fylldes inte i");
    check((await page.getByLabel("Milersättning").locator("option:checked").textContent()) === "Privat bil", "Fordonet fylldes inte i");
    await page.getByText("Inga registreringar").waitFor();
    await context.close();
  });

  await test("Tidrapport: godkänd rad är låst, nekad visar orsak, låst månad stänger formuläret", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const [p1, p2] = await store.listProjects();
      const a = await store.saveEntry({ date: "2026-09-24", hours: 4, projectId: p1.id });
      const b = await store.saveEntry({ date: "2026-09-24", hours: 2, projectId: p2.id });
      await store.approveEntries([a.id]);
      await store.rejectEntries([b.id], "Fel projekt");
    });
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator(".row", { hasText: "P-1 Takbyte" }).getByText("Godkänd").waitFor();
    check(!(await page.getByRole("button", { name: /^Redigera Brf Almen/ }).count()), "Godkänd rad går att redigera");
    await page.getByText("Nekad: Fel projekt").waitFor();
    await page.getByRole("button", { name: /^Redigera Villa Holm/ }).waitFor();

    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const me = await store.getSession();
      await store.lockMonth(me.id, "2026-09");
    });
    await page.reload();
    await page.getByText("är markerad som klar och låst").waitFor();
    check(await page.getByRole("button", { name: "Spara registrering" }).isDisabled(), "Formuläret går att använda i låst månad");
    check(!(await page.getByRole("button", { name: /^Redigera/ }).count()), "Rader går att redigera i låst månad");
    await context.close();
  });

  await test("Tidrapport (mobil): veckoremsa med summor, byta dag och vecka", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", devices["Pixel 7"], { loggedIn: true });
    await seedProjects(page);
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const [p] = await store.listProjects();
      await store.saveEntry({ date: "2026-09-21", hours: 8.5, projectId: p.id });
    });
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    const strip = page.locator(".weekstrip");
    await strip.getByRole("button", { name: /måndag 21 september, 8,5 timmar/i }).waitFor();
    check((await strip.locator('[aria-pressed="true"]').getAttribute("aria-label")).startsWith("Torsdag 24 september"), "Fel dag vald");
    await page.getByText("Vecka 39").waitFor();
    await strip.getByRole("button", { name: /måndag 21 september/i }).click();
    await page.getByText("Registrerat måndag 21 september").waitFor();
    await page.locator(".today-card").getByText("av 8,0 h").waitFor();
    await page.getByRole("button", { name: "Nästa vecka" }).click();
    await page.getByText("Vecka 40").waitFor();
    await context.close();
  });

  await test("Tidrapport: Registrera arbetstid fälls ihop med sammanfattning, fel fäller ut den igen", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    const work = page.locator('[data-toggle="work"]');
    check((await work.getAttribute("aria-expanded")) === "true", "Arbetstid ska vara utfälld från början");
    await work.click();
    check(await page.locator("#time-work").isHidden(), "Arbetstid fälldes inte ihop");
    check((await page.locator('[data-summary="work"]').textContent()) === "Ingen kund vald · 8,0 h", "Fel sammanfattning");
    check((await work.evaluate((el) => el === document.activeElement)), "Fokus ska stanna på knappen");
    // Fel i en ihopfälld del fäller ut den
    await page.getByRole("button", { name: "Spara registrering" }).click();
    check((await work.getAttribute("aria-expanded")) === "true", "Arbetstid fälldes inte ut vid fel");
    check((await page.locator("#time-customer").getAttribute("aria-invalid")) === "true", "Kund markerades inte");
    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Takbyte" });
    await work.click();
    check((await page.locator('[data-summary="work"]').textContent()) === "Brf Almen · P-1 · 8,0 h", "Sammanfattningen visar inte projektet");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Registreringen är sparad").waitFor();
    check((await work.getAttribute("aria-expanded")) === "true", "Arbetstid ska fällas ut efter sparat");
    await context.close();
  });

  await test("Tidrapport: medarbetare ser bara sin egen tid", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      const [p] = await store.listProjects();
      await store.saveEntry({ date: "2026-09-24", hours: 3, projectId: p.id, comment: "Adminens rad" });
      const { oneTimePassword } = await store.saveUser({ name: "Maja M", employeeNo: "2", email: "maja@exempel.se", role: "employee" });
      await store.logout();
      await store.login("maja@exempel.se", oneTimePassword);
      await store.changePassword({ newPassword: "majaslosen1" });
    });
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("h1", { hasText: "Lägg till tid" }).waitFor();
    await page.getByText("Inga registreringar").waitFor();
    check(!(await page.getByText("Adminens rad").count()), "Medarbetaren ser adminens tid");
    await context.close();
  });
}

async function materialTests(browser) {
  await test("Material: av som standard, slås på med egen benämning och syns i menyn", async () => {
    const { context, page } = await openWithAdmin(browser, "#/installningar", {}, { loggedIn: true });
    check(!(await page.locator('.nav__link[href="#/material"]').count()), "Material syns i menyn fast det är av");
    await page.getByLabel("Använd material").check();
    await page.getByLabel("Produkter").check();
    await page.getByLabel(/Tillåt "Annat/).uncheck();
    await page.locator("[data-materials-form]").getByRole("button", { name: "Spara" }).click();
    await page.locator('.nav__link[href="#/material"]', { hasText: "Produkter" }).waitFor();
    const settings = await page.evaluate(async () => (await import("./js/store.js")).getSettings());
    check(settings.materials.enabled && settings.materials.label === "Produkter" && !settings.materials.allowFreeText, "Inställningen sparades fel");

    // Eget namn
    await page.getByLabel("Eget", { exact: true }).check();
    await page.getByLabel("Eget namn").fill("Förbrukningsvaror");
    await page.locator("[data-materials-form]").getByRole("button", { name: "Spara" }).click();
    await page.locator('.nav__link[href="#/material"]', { hasText: "Förbrukningsvaror" }).waitFor();
    await context.close();
  });

  await test("Material: artikellista med förslag för bygg, egen artikel och dölja", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      await store.saveSettings({ materials: { enabled: true, label: "Produkter", allowFreeText: true } });
    });
    await page.goto(BASE + "#/material/artiklar");
    await page.reload();
    await page.locator("h1", { hasText: "Produkter" }).waitFor();
    await page.getByText("Lägg till er första artikel").waitFor();
    await page.getByRole("button", { name: "Visa förslag på artiklar" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Lägg till 10 artiklar" }).click();
    await page.getByText("10 artiklar lades till").waitFor();
    await page.locator(".row", { hasText: "Fogmassa" }).getByText("Enhet: tub").waitFor();
    // Andra gången finns allt redan
    await page.getByRole("button", { name: "Förslag på artiklar" }).click();
    await page.locator("dialog[open]").getByText("Alla förslag finns redan i artikellistan.").waitFor();
    await page.locator("dialog[open]").getByRole("button", { name: "Stäng" }).last().click();

    await page.getByRole("button", { name: "Ny artikel" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Namn").fill("Silikon");
    await dialog.getByLabel("Enhet").fill("tub");
    await dialog.getByLabel("Artikelnummer").fill("S-1");
    await dialog.getByRole("button", { name: "Lägg till" }).click();
    await page.locator(".row", { hasText: "Silikon" }).getByText("Art.nr S-1").waitFor();
    await page.getByRole("button", { name: "Dölj Tejp" }).click();
    await page.locator(".row", { hasText: "Tejp" }).getByText("Dold").waitFor();
    await context.close();
  });

  await test("Material: registrera från tidrapporten, lista för dagen och hantera som admin", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.evaluate(async () => {
      const store = await import("./js/store.js");
      await store.saveSettings({ materials: { enabled: true, label: "Material", allowFreeText: true } });
      await store.addArticleTemplate();
    });
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();

    // Tid och material sparas med samma knapp – materialet på samma projekt
    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Takbyte" });
    const materialToggle = page.locator('[data-toggle="material"]');
    check((await materialToggle.getAttribute("aria-expanded")) === "false", "Material ska vara stängt från början");
    await materialToggle.click();
    await page.getByLabel("Antal").fill("2,5");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    check((await page.getByLabel("Vad").getAttribute("aria-invalid")) === "true", "Tom artikel godkändes");
    check(!(await page.locator(".row", { hasText: "Takbyte" }).count()), "Tiden sparades fast materialet hade fel");
    await page.getByLabel("Vad").selectOption({ label: "Skruv (kg)" });
    await page.locator("label", { hasText: "Antal (kg)" }).waitFor();
    await page.getByLabel("Meddelande").fill("Beställ mer");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Tiden är sparad, och från lagret: Skruv · 2,5 kg").waitFor();
    await page.locator("[data-list] .row", { hasText: "Brf Almen · P-1 Takbyte" }).waitFor();
    await page.locator("[data-material-list] .row", { hasText: "Skruv · 2,5 kg" }).getByText("Ny").waitFor();
    check((await materialToggle.getAttribute("aria-expanded")) === "false", "Material ska stängas efter sparat");

    // Bara material (0 timmar), fritext, på ett annat projekt
    await page.locator("#time-customer").selectOption({ label: "Villa Holm" });
    await page.locator("#time-project").selectOption({ label: "P-2 · Altan" });
    await page.locator("#time-hours").fill("0");
    await materialToggle.click();
    await page.getByLabel("Vad").selectOption({ label: "Annat – skriv själv" });
    await page.getByLabel("Beskrivning").fill("Lister");
    await page.getByLabel("Enhet").fill("m");
    await page.getByLabel(/Antal/).fill("12");
    check((await page.locator('[data-summary="material"]').textContent()) === "Lister · 12 m", "Sammanfattningen visar inte materialet");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Sparat från lagret: Lister · 12 m").waitFor();
    await page.locator("[data-material-list] .row", { hasText: "Lister · 12 m" }).waitFor();
    check((await page.locator("[data-list] .row").count()) === 1, "En tidrad med 0 timmar sparades");
    await page.locator('.nav__link[href="#/material"] .count-badge', { hasText: "2" }).waitFor();

    // Admin hanterar
    await page.goto(BASE + "#/material");
    await page.locator(".row", { hasText: "Skruv · 2,5 kg" }).getByText("”Beställ mer”").waitFor();
    await page.getByText("Markera som klar", { exact: false }).first().waitFor();
    await page.getByRole("button", { name: "Markera som klar: Skruv" }).click();
    await page.getByText("Skruv är markerad som klar").waitFor();
    await page.locator('.nav__link[href="#/material"] .count-badge', { hasText: "1" }).waitFor();
    await page.getByLabel("Status").selectOption("handled");
    await page.locator(".row", { hasText: "Skruv" }).getByText("Klar", { exact: true }).waitFor();

    // Det som är markerat som klart kan inte tas bort av medarbetaren
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.locator("[data-material-list] .row", { hasText: "Skruv" }).getByText("Klar", { exact: true }).waitFor();
    check(!(await page.getByRole("button", { name: /^Ta bort Skruv/ }).count()), "Klar rad går att ta bort");
    await page.getByRole("button", { name: /^Ta bort Lister/ }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Ta bort" }).click();
    await page.getByText("Lister är borttagen").waitFor();
    await context.close();
  });

  await test("Material: av – ingen materialdel i formuläret", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    check(!(await page.locator('[data-toggle="material"]').count()), "Materialdelen syns fast material är av");
    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Takbyte" });
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Registreringen är sparad").waitFor();
    await context.close();
  });
}

// Två medarbetare med tid i september 2026 – admin inloggad efteråt
async function seedReview(page, { materials = false } = {}) {
  await page.evaluate(async (withMaterials) => {
    const s = await import("./js/store.js");
    const a = await s.saveCustomer({ customerNo: "100", name: "Brf Almen" });
    const b = await s.saveCustomer({ customerNo: "200", name: "Villa Holm" });
    const p1 = await s.saveProject({ customerId: a.id, projectNo: "P-1", name: "Takbyte" });
    const p2 = await s.saveProject({ customerId: b.id, projectNo: "P-2", name: "Altan" });
    if (withMaterials) {
      await s.saveSettings({ materials: { enabled: true, label: "Material", allowFreeText: true } });
    }
    const people = [];
    for (const [name, no] of [["Maja Medarbetare", "2"], ["Olle Ek", "3"]]) {
      const { oneTimePassword } = await s.saveUser({ name, employeeNo: no, email: `${no}@exempel.se`, role: "employee" });
      people.push([`${no}@exempel.se`, oneTimePassword, no === "2" ? p1.id : p2.id]);
    }
    for (const [email, otp, projectId] of people) {
      await s.logout();
      await s.login(email, otp);
      await s.changePassword({ newPassword: "hemligt123" });
      await s.saveEntry({ date: "2026-09-21", hours: 8, projectId, travelHours: 1, travelBillable: true, vehicleTypeId: "privat-bil", km: 30 });
      await s.saveEntry({ date: "2026-09-22", hours: 8, projectId });
      await s.saveEntry({ date: "2026-09-23", hours: 2, timeTypeId: "ot-lon", projectId });
      await s.saveEntry({ date: "2026-09-24", hours: 8, timeTypeId: "vab" });
      if (withMaterials) await s.saveMaterial({ date: "2026-09-22", name: "Skruv", unit: "kg", quantity: 2, projectId });
    }
    await s.logout();
    await s.login("admin@exempel.se", "hemligt123");
  }, materials);
}

const readDownload = async (download) => {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

async function reviewTests(browser) {
  await test("Granskning: godkänna och neka rader och veckor", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedReview(page);
    await page.goto(BASE + "#/granska/2026-09");
    await page.reload();
    await page.locator(".stat", { hasText: "Att granska" }).getByText("8 rader").waitFor();

    const maja = page.locator(".person", { hasText: "Maja Medarbetare" });
    await maja.getByRole("button", { name: /Vecka 39/ }).click();
    await maja.getByRole("button", { name: /^Godkänn Brf Almen · P-1 Takbyte mån 21 sep/ }).click();
    await page.getByText("Raden är godkänd").waitFor();

    await maja.getByRole("button", { name: /^Neka Brf Almen · P-1 Takbyte tis 22 sep/ }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Neka" }).click();
    await dialog.getByText("Skriv en kort orsak.").first().waitFor();
    await dialog.getByLabel("Orsak").fill("Fel projekt");
    await dialog.getByRole("button", { name: "Neka" }).click();
    await maja.getByText("Nekad: Fel projekt").waitFor();

    const olle = page.locator(".person", { hasText: "Olle Ek" });
    await olle.getByRole("button", { name: "Godkänn vecka" }).click();
    await page.getByText("4 rader godkända").waitFor();
    await page.locator(".stat", { hasText: "Att granska" }).getByText("2 rader").waitFor();
    await context.close();
  });

  await test("Granskning: markera månad som klar och låsa upp", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedReview(page);
    await page.goto(BASE + "#/granska/2026-09");
    await page.reload();
    const maja = page.locator(".person", { hasText: "Maja Medarbetare" });
    await maja.getByRole("button", { name: "Markera september som klar" }).click();
    await page.locator("dialog[open]").getByText("4 rader är inte godkända").waitFor();
    await page.locator("dialog[open]").getByRole("button", { name: "Markera som klar" }).click();
    await maja.getByText("Månaden klar").waitFor();
    check(!(await maja.getByRole("button", { name: "Godkänn vecka" }).count()), "Låst månad går att godkänna");
    await maja.getByRole("button", { name: "Lås upp" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Lås upp" }).click();
    await maja.getByRole("button", { name: "Godkänn vecka" }).waitFor();
    await context.close();
  });

  await test("Granskning: filter och export av tid och material (CSV)", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", { acceptDownloads: true }, { loggedIn: true });
    await seedReview(page, { materials: true });
    await page.goto(BASE + "#/granska/2026-09");
    await page.reload();

    await page.getByLabel("Anställd").selectOption({ label: "Maja Medarbetare" });
    check((await page.locator(".person").count()) === 1, "Filtret på anställd fungerar inte");
    let [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Tid (CSV)" }).click()]);
    check(download.suggestedFilename() === "tidla-underlag-2026-09-maja-medarbetare.csv", `Fel filnamn: ${download.suggestedFilename()}`);
    let csv = await readDownload(download);
    const lines = csv.split("\r\n").filter(Boolean);
    check(lines[0].startsWith("﻿Datum;Anställd;"), "Rubrikraden saknas");
    check(lines.length === 5 && lines.every((l, i) => i === 0 || l.includes("Maja Medarbetare")), `Fel rader: ${lines.length}`);
    check(lines.some((l) => l.includes(";Övertid – lön;2;Lön;")), "Övertiden saknas i filen");

    // Bara godkända – inga godkända rader än
    await page.getByLabel("Bara godkända").check();
    await page.getByRole("button", { name: "Tid (CSV)" }).click();
    await page.getByText("Det finns inga rader att exportera").waitFor();

    [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Material (CSV)" }).click()]);
    check(download.suggestedFilename() === "tidla-material-2026-09-maja-medarbetare.csv", `Fel filnamn för material: ${download.suggestedFilename()}`);
    csv = await readDownload(download);
    check(csv.includes(";Skruv;;2;kg;") && !csv.includes("Olle Ek"), "Materialfilen följer inte filtren");
    await context.close();
  });

  await test("Granskning (medarbetare): bara egna rader, inga knappar, nekad syns i tidrapporten", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedReview(page);
    await page.evaluate(async () => {
      const s = await import("./js/store.js");
      const rows = await s.listEntries({ month: "2026-09" });
      const maja = (await s.listUsers()).find((u) => u.name === "Maja Medarbetare");
      await s.rejectEntries([rows.find((e) => e.userId === maja.id && e.date === "2026-09-22").id], "Fel projekt");
      await s.logout();
      await s.login("2@exempel.se", "hemligt123");
    });
    await page.goto(BASE + "#/granska/2026-09");
    await page.reload();
    await page.locator("h1", { hasText: "Granska" }).waitFor();
    check((await page.locator(".person").count()) === 1, "Medarbetaren ser andras tid");
    check(!(await page.getByRole("button", { name: /Godkänn|Markera|CSV/ }).count()), "Medarbetaren ser admin-knappar");
    // Veckans status syns utan att man fäller ut veckan
    await page.locator(".week", { hasText: "Vecka 39" }).getByText("1 nekad", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Vecka 39/ }).click();
    await page.getByText("Nekad: Fel projekt").waitFor();

    await page.goto(BASE + "#/tid/2026-09-24");
    await page.getByText("1 nekad registrering att rätta.").waitFor();
    await page.getByRole("link", { name: "Visa tisdag 22 september" }).click();
    await page.waitForFunction(() => location.hash === "#/tid/2026-09-22");
    await page.getByText("1 nekad registrering att rätta i listan nedan.").waitFor();
    await context.close();
  });
}

async function laterFixTests(browser) {
  await test("Granskning: inlagd frånvaro framåt räknas inte som plustid", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    const month = await page.evaluate(async () => {
      const s = await import("./js/store.js");
      const d = await import("./js/lib/dates.js");
      const from = d.addDays(d.today(), 1);
      await s.saveAbsenceRange({ from, to: d.addDays(from, 13), timeTypeId: "semester" });
      return d.currentMonth();
    });
    await page.goto(BASE + `#/granska/${month}`);
    await page.reload();
    const person = page.locator(".person", { hasText: "Test Admin" });
    await person.getByText("(±0 h)").waitFor();
    check(!(await person.getByText("(+", { exact: false }).count()), "Frånvaro framåt räknas som plustid");
    await context.close();
  });

  await test("Mobil (360px): övertidsrutans knappar ryms på skärmen", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", { viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true }, { loggedIn: true });
    await seedProjects(page);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("#time-customer").selectOption({ label: "Brf Almen" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Takbyte" });
    await page.locator("#time-hours").fill("10");
    await page.locator("#time-hours").dispatchEvent("input");
    await page.getByRole("button", { name: "Spara som övertid – komptid" }).waitFor();
    // Knapparna ska hålla sig innanför rutans kant (före rättelsen: 3,8 px utanför på 360 px)
    const outside = await page.evaluate(() => {
      const hint = document.querySelector(".overtime-hint");
      const edge = hint.getBoundingClientRect().right - parseFloat(getComputedStyle(hint).paddingRight);
      return [...hint.querySelectorAll(".btn")].filter((b) => b.getBoundingClientRect().right > edge + 0.5).length;
    });
    check(!outside, `${outside} knappar sticker ut ur övertidsrutan`);
    await context.close();
  });

  await test("Mobil (320px): Tema, Logga ut och veckoraden ryms utan att klippas", async () => {
    const { context, page } = await openWithAdmin(browser, "#/profil", { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true }, { loggedIn: true });
    await page.evaluate(async () => (await import("./js/store.js")).saveSettings({ companyName: "Snickeri Exempel med långt namn AB" }));
    await page.reload();
    await page.locator("h1", { hasText: "Profil" }).waitFor();
    const profile = await page.evaluate(() => {
      const theme = document.querySelector(".segmented");
      const card = document.querySelector("[data-profile-logout]").closest(".card").getBoundingClientRect();
      const logout = document.querySelector("[data-profile-logout]").getBoundingClientRect();
      return { themeScroll: theme.scrollWidth - theme.clientWidth, logoutOutside: logout.right - card.right };
    });
    check(profile.themeScroll <= 0, `Temaväljaren skrollar ${profile.themeScroll}px i sidled`);
    check(profile.logoutOutside <= 0, `Logga ut sticker ut ${profile.logoutOutside}px ur kortet`);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    const label = await page.locator(".week-head__label").evaluate((el) => ({ text: el.textContent.trim(), cut: el.scrollWidth - el.clientWidth }));
    check(label.text === "Vecka 39" && label.cut <= 0, `Veckoraden: "${label.text}" klipps ${label.cut}px`);
    await page.locator("[data-mobile-week]").getByText("Snickeri Exempel med långt namn AB").waitFor();
    await context.close();
  });

  await test("Förslag på nummer och förval när det bara finns ett alternativ", async () => {
    const { context, page } = await openWithAdmin(browser, "#/projekt/kunder", {}, { loggedIn: true });
    await page.getByRole("button", { name: "Ny kund" }).first().click();
    let dialog = page.locator("dialog[open]");
    check((await dialog.getByLabel("Kundnummer").inputValue()) === "1", "Första kundnumret föreslogs inte");
    await dialog.getByText("Förslag: nästa lediga nummer.", { exact: false }).waitFor();
    await dialog.getByLabel("Namn").fill("Brf Almen");
    await dialog.getByRole("button", { name: "Lägg till kund" }).click();
    await page.getByText("Kunden är tillagd").waitFor();

    // Bara en kund – den är förvald i Nytt projekt
    await page.getByRole("button", { name: "Nytt projekt" }).click();
    dialog = page.locator("dialog[open]");
    check((await dialog.getByLabel("Kund").locator("option:checked").textContent()).startsWith("Brf Almen"), "Den enda kunden är inte förvald");
    check((await dialog.getByLabel("Projektnummer").inputValue()) === "1", "Första projektnumret föreslogs inte");
    await dialog.getByLabel("Projektnamn").fill("Takbyte");
    await dialog.getByRole("button", { name: "Lägg till projekt" }).click();
    await page.getByText("Projektet är tillagt").waitFor();
    await page.getByRole("button", { name: "Ny kund" }).first().click();
    check((await page.locator("dialog[open]").getByLabel("Kundnummer").inputValue()) === "2", "Nästa kundnummer ska vara 2");
    await page.locator("dialog[open]").getByRole("button", { name: "Avbryt" }).click();

    // Tidrapporten: den enda kunden och det enda projektet är förvalda
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    check((await page.locator("#time-customer option:checked").textContent()) === "Brf Almen", "Kunden är inte förvald");
    check((await page.locator("#time-project option:checked").textContent()) === "1 · Takbyte", "Projektet är inte förvalt");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Registreringen är sparad").waitFor();
    await context.close();
  });
}

// Dialoger vid sidbyte, nytt projekt, kilometer/mil och fordonslistan
async function dialogAndVehicleTests(browser) {
  await test("Dialog stängs vid sidbyte, nytt projekt syns i projektlistan", async () => {
    const { context, page } = await openWithAdmin(browser, "#/anstallda", {}, { loggedIn: true });
    await page.locator(".page-head").getByRole("button", { name: "Ny anställd" }).click();
    await page.locator("dialog[open]").waitFor();
    await page.evaluate(() => (location.hash = "#/tid"));
    await page.locator("h1", { hasText: "Lägg till tid" }).waitFor();
    check(!(await page.locator("dialog[open]").count()), "Dialogen ligger kvar efter sidbyte");

    await seedProjects(page);
    await page.goto(BASE + "#/projekt/kunder");
    await page.reload();
    await page.getByRole("button", { name: "Nytt projekt" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Kund").selectOption({ label: "Brf Almen (kundnr 100)" });
    await dialog.getByLabel("Projektnamn").fill("Fasadmålning");
    await dialog.getByRole("button", { name: "Lägg till projekt" }).click();
    await page.waitForFunction(() => location.hash === "#/projekt");
    await page.locator(".project", { hasText: "Fasadmålning" }).waitFor();
    check((await page.locator('[data-tab="projekt"]').getAttribute("aria-pressed")) === "true", "Fliken Projekt är inte vald");
    await context.close();
  });

  await test("Milersättning: kilometer räknas om till mil, knappar har namn, kompakt i mobil", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator('[data-toggle="trip"]').click();
    await page.getByLabel("Milersättning").selectOption({ label: "Privat bil" });
    await page.getByText("10 km = 1 mil. Ersättningen är 25 kr per mil.").waitFor();
    await page.getByLabel("Körda kilometer").fill("34");
    await page.getByText("34 km = 3,4 mil · 85 kr").waitFor();

    await page.goto(BASE + "#/installningar/fordon");
    await page.reload();
    await page.getByRole("button", { name: "Lägg till fordon" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Lägg till Förmånsbil – el, 9,5 kr/mil" }).waitFor();
    await page.locator("dialog[open]").getByRole("button", { name: "Avbryt" }).click();

    await page.setViewportSize({ width: 360, height: 760 });
    const sameLine = await page.evaluate(() => {
      const row = [...document.querySelectorAll("[data-rates-form] .row")].find((el) => el.textContent.includes("Privat bil"));
      const rename = row.querySelector("[data-rename-vehicle]").getBoundingClientRect();
      const remove = row.querySelector("[data-toggle-vehicle]").getBoundingClientRect();
      return Math.abs(rename.top - remove.top) < 2;
    });
    check(sameLine, "Byt namn och Ta bort hamnar på olika rader i mobilen");
    await context.close();
  });
}

// Låsta månader, nekade veckor och filtret Anställd
async function lockAndRejectTests(browser) {
  await test("Granskning: nekad vecka syns för admin, låst månad med ej godkända rader, varning för resten av månaden", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedReview(page);
    // Har inte loggat in än – ska inte finnas i filtret
    await page.evaluate(async () => (await import("./js/store.js")).saveUser({ name: "Oskar Väntar", employeeNo: "9", email: "9@exempel.se", role: "employee" }));
    await page.goto(BASE + "#/granska/2026-09");
    await page.reload();
    const users = await page.getByLabel("Anställd").locator("option").allTextContents();
    check(!users.includes("Oskar Väntar"), "Den som inte har loggat in finns i filtret");

    // Nekad vecka: admin ser märkningen bredvid knapparna
    const olle = page.locator(".person", { hasText: "Olle Ek" });
    await olle.getByRole("button", { name: "Neka" }).first().click();
    await page.locator("dialog[open]").getByLabel("Orsak").fill("Fel vecka");
    await page.locator("dialog[open]").getByRole("button", { name: "Neka" }).click();
    await olle.locator(".week", { hasText: "Vecka 39" }).getByText("4 nekade", { exact: true }).waitFor();

    // Låst månad med rader som inte är godkända
    const maja = page.locator(".person", { hasText: "Maja Medarbetare" });
    await maja.getByRole("button", { name: "Markera september som klar" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Markera som klar" }).click();
    await maja.getByText("Månaden är låst, men 4 rader är inte godkända.", { exact: false }).waitFor();
    await maja.locator(".week", { hasText: "Vecka 39" }).locator(".week__head").getByText("Låst utan godkännande").waitFor();
    check(!(await maja.getByText("Väntar på granskning").count()), "Låst vecka visas som Väntar på granskning");

    // Månaden är inte slut: varna för att resten av månaden också låses
    await page.goto(BASE + "#/granska");
    await page.reload();
    await page.locator(".person", { hasText: "Maja Medarbetare" }).getByRole("button", { name: /^Markera .* som klar$/ }).click();
    await page.locator("dialog[open]").getByText("är inte slut", { exact: false }).waitFor();
    await page.locator("dialog[open]").getByRole("button", { name: "Avbryt" }).click();
    await context.close();
  });

  await test("Tidrapport: admin i låst månad länkas till Granskning, nekad orsak syns överst vid rättning", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedReview(page);
    await page.evaluate(async () => {
      const s = await import("./js/store.js");
      const me = await s.getSession();
      await s.lockMonth(me.id, "2026-09");
    });
    await page.goto(BASE + "#/tid/2026-09-24");
    await page.reload();
    await page.locator("[data-form-card]").getByRole("link", { name: "Granskning" }).waitFor();
    check(!(await page.getByText("Be din administratör").count()), "Admin uppmanas be sin administratör");

    await page.evaluate(async () => {
      const s = await import("./js/store.js");
      const rows = await s.listEntries({ month: "2026-09" });
      const maja = (await s.listUsers()).find((u) => u.name === "Maja Medarbetare");
      await s.rejectEntries([rows.find((e) => e.userId === maja.id && e.date === "2026-09-22").id], "Fel projekt");
      await s.logout();
      await s.login("2@exempel.se", "hemligt123");
    });
    await page.goto(BASE + "#/tid/2026-09-22");
    await page.reload();
    await page.getByRole("button", { name: /^Redigera Brf Almen/ }).click();
    await page.locator("[data-form-card]").getByText("Fel projekt").waitFor();
    await context.close();
  });
}

async function exportFilterTests(browser) {
  await test("Export: nekade rader tas inte med som standard, filtren syns i filnamnet, schemat jämförs med all tid", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", { acceptDownloads: true }, { loggedIn: true });
    await seedReview(page);
    await page.evaluate(async () => {
      const s = await import("./js/store.js");
      const olle = (await s.listUsers()).find((u) => u.name === "Olle Ek");
      const rows = await s.listEntries({ userId: olle.id, month: "2026-09" });
      await s.rejectEntries([rows.find((e) => e.date === "2026-09-21").id], "Fel projekt");
    });
    await page.goto(BASE + "#/granska/2026-09");
    await page.reload();
    const olle = page.locator(".person", { hasText: "Olle Ek" });
    const summary = await olle.locator(".person__title p").textContent();

    // Hela månaden: den nekade raden följer inte med
    let [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Tid (CSV)" }).click()]);
    check(download.suggestedFilename() === "tidla-underlag-2026-09.csv", `Fel filnamn: ${download.suggestedFilename()}`);
    let csv = await readDownload(download);
    check(!csv.includes(";Nekad"), "Nekade rader följde med i standardexporten");
    await page.getByText("1 nekad rad togs inte med", { exact: false }).waitFor();

    // Bara nekade, för Olle: filnamnet visar filtren och schemajämförelsen ändras inte
    await page.getByLabel("Anställd").selectOption({ label: "Olle Ek" });
    await page.getByLabel("Status").selectOption({ label: "Nekade" });
    check((await olle.locator(".person__title p").textContent()) === summary, "Statusfiltret ändrar jämförelsen med schemat");
    [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Tid (CSV)" }).click()]);
    check(download.suggestedFilename() === "tidla-underlag-2026-09-olle-ek-nekade.csv", `Fel filnamn: ${download.suggestedFilename()}`);
    csv = await readDownload(download);
    check(csv.split("\r\n").filter(Boolean).length === 2 && csv.includes(";Nekad"), "Fel rader i filen med nekade");
    await context.close();
  });
}

async function settingsTests(browser) {
  await test("Inställningar: företag och arbetstid med tidssteg", async () => {
    const { context, page } = await openWithAdmin(browser, "#/installningar", {}, { loggedIn: true });
    await seedProjects(page);
    await page.reload();
    await page.getByLabel("Organisationsnummer").fill("123");
    await page.getByRole("button", { name: "Spara företag" }).click();
    check((await page.getByLabel("Organisationsnummer").getAttribute("aria-invalid")) === "true", "Felaktigt org.nr godkändes");
    await page.getByLabel("Företagsnamn").fill("Nytt Namn AB");
    await page.getByLabel("Organisationsnummer").fill("5566778899");
    await page.getByRole("button", { name: "Spara företag" }).click();
    await page.locator(".sidebar__company", { hasText: "Nytt Namn AB" }).waitFor();

    await page.getByLabel("Fredag").fill("6");
    await page.getByText("Totalt 38,0 h per vecka.").waitFor();
    await page.getByLabel("15 minuter").check();
    await page.getByRole("button", { name: "Spara arbetstid" }).click();
    await page.getByText("Arbetstiden är sparad").waitFor();

    await page.goto(BASE + "#/tid/2026-09-25");
    await page.reload();
    await page.locator("#time-hours").waitFor();
    check((await page.locator("#time-hours").inputValue()) === "6,0", "Fredagens schema används inte");
    await page.getByRole("button", { name: "Öka timmar 15 minuter" }).click();
    check((await page.locator("#time-hours").inputValue()) === "6,25", "Tidssteget används inte");
    await context.close();
  });

  await test("Inställningar: milersättning förifylld, belopp i listan, lägga till och ta bort fordon", async () => {
    const { context, page } = await openWithAdmin(browser, "#/installningar/fordon", {}, { loggedIn: true });
    // Nytt företag: bara firmabil och privat bil, med Skatteverkets belopp förifyllt
    const rows = page.locator("[data-rates-form] .row");
    check((await rows.count()) === 2, `Fel antal fordon: ${await rows.count()}`);
    check((await page.getByLabel("Belopp per mil för Privat bil").inputValue()) === "25", "Beloppet för privat bil är inte förifyllt");
    await page.locator(".row", { hasText: "Privat bil" }).getByText("Skatteverkets belopp för 2026 – ändra om ni har ett annat avtal.").waitFor();
    await page.locator(".row", { hasText: "Firmabil" }).getByText("Ingen ersättning – körda mil sparas bara som underlag.").waitFor();
    check(!(await page.getByLabel("Belopp per mil för Firmabil").count()), "Firmabil ska inte ha något belopp");
    const link = page.getByRole("link", { name: /Belopp och procent 2026/ });
    check((await link.getAttribute("href")).includes("skatteverket.se/privat/skatter/beloppochprocent/2026"), "Länken går inte till Belopp och procent");

    // Eget belopp i listan
    await page.getByLabel("Belopp per mil för Privat bil").fill("abc");
    await page.getByRole("button", { name: "Spara belopp" }).click();
    check((await page.getByLabel("Belopp per mil för Privat bil").getAttribute("aria-invalid")) === "true", "Felaktigt belopp godkändes");
    await page.getByLabel("Belopp per mil för Privat bil").fill("30");
    await page.getByRole("button", { name: "Spara belopp" }).click();
    await page.getByText("Beloppen är sparade").waitFor();
    await page.locator(".row", { hasText: "Privat bil" }).getByText("Eget belopp. Skatteverkets belopp för 2026: 25 kr.").waitFor();

    // Lägg till ur den färdiga listan – bensin och diesel är en rad
    await page.getByRole("button", { name: "Lägg till fordon" }).click();
    const dialog = page.locator("dialog[open]");
    const ready = await dialog.locator(".quick .row__title").allTextContents();
    check(ready.join("|") === "Förmånsbil|Förmånsbil – el|Motorcykel", `Fel fordon i listan: ${ready.join(", ")}`);
    await dialog.getByRole("button", { name: /Förmånsbil – el/ }).click();
    await page.getByText("Förmånsbil – el är tillagd").waitFor();
    check((await page.getByLabel("Belopp per mil för Förmånsbil – el").inputValue()) === "9,5", "Elbilens belopp är inte förifyllt");

    // Ta bort (döljs) – kommer tillbaka i den färdiga listan
    await page.getByRole("button", { name: "Ta bort Förmånsbil – el från listan" }).click();
    await page.getByText("Förmånsbil – el är borttagen från listan").waitFor();
    check((await rows.count()) === 2, "Fordonet togs inte bort");

    await seedProjects(page);
    await page.goto(BASE + "#/tid/2026-09-24");
    await page.reload();
    await page.locator("[data-toggle=\"trip\"]").click();
    const vehicles = await page.getByLabel("Milersättning").locator("option").allTextContents();
    check(vehicles.join("|") === "Inget fordon|Firmabil|Privat bil", `Fel fordon i tidrapporten: ${vehicles.join(", ")}`);
    await context.close();
  });

  await test("Milersättning: påminnelse i januari när beloppen gäller förra året", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    // Låtsas att beloppen gäller förra året
    await page.evaluate(async () => {
      const key = "tidla:settings";
      const settings = JSON.parse(localStorage.getItem(key));
      const year = Number(new Date().getFullYear()) - 1;
      settings.vehicleTypes = settings.vehicleTypes.map((v) => (v.ratePerMil === null ? v : { ...v, rateYear: year, rateCustom: true }));
      localStorage.setItem(key, JSON.stringify(settings));
    });
    const year = new Date().getFullYear();
    await page.reload();
    await page.getByText(`Milersättningen gäller ${year - 1} – kontrollera för ${year}`).first().waitFor();
    await page.goto(BASE + "#/granska");
    await page.reload();
    await page.getByText(`Milersättningen gäller ${year - 1} – kontrollera för ${year}.`).waitFor();
    await page.goto(BASE + "#/installningar/fordon");
    await page.reload();
    await page.getByRole("button", { name: "Jag har kontrollerat beloppen" }).click();
    await page.getByText("Beloppen är markerade som kontrollerade").waitFor();
    await page.getByText(`Beloppen gäller ${year}.`, { exact: false }).waitFor();
    await page.goto(BASE + "#/kom-igang");
    await page.reload();
    check(!(await page.getByText("kontrollera för").count()), "Påminnelsen finns kvar efter kontroll");
    await context.close();
  });

  await test("Inställningar: säkerhetskopia exporteras och läses in igen", async () => {
    const { context, page } = await openWithAdmin(browser, "#/installningar/sakerhetskopia", { acceptDownloads: true }, { loggedIn: true });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportera säkerhetskopia" }).click()]);
    check(/^tidla-sakerhetskopia-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), "Fel filnamn");
    const json = await readDownload(download);
    const backup = JSON.parse(json);
    check(backup.app === "tidla" && backup.data.users.length === 1, "Kopian saknar data");

    // Ändra något och läs in kopian igen
    await page.evaluate(async () => {
      const s = await import("./js/store.js");
      await s.saveSettings({ companyName: "Ändrat AB" });
    });
    await page.reload();
    await page.locator("[data-import-backup]").setInputFiles({ name: "kopia.json", mimeType: "application/json", buffer: Buffer.from(json) });
    const dialog = page.locator("dialog[open]");
    await dialog.getByText("All data i Tidla ersätts").waitFor();
    check(await dialog.getByRole("button", { name: "Ersätt all data" }).isDisabled(), "Går att ersätta utan att skriva ERSÄTT");
    await dialog.getByRole("textbox").fill("ERSÄTT");
    await dialog.getByRole("button", { name: "Ersätt all data" }).click();
    await page.getByText("Säkerhetskopian är inläst").waitFor();
    await page.locator(".sidebar__company", { hasText: "Testföretaget" }).waitFor();

    await page.locator("[data-import-backup]").setInputFiles({ name: "fel.json", mimeType: "application/json", buffer: Buffer.from("inte json") });
    await page.getByText("Filen kunde inte läsas.").waitFor();
    await context.close();
  });

  await test("Inställningar: gallring kräver dubbel bekräftelse", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", {}, { loggedIn: true });
    await seedProjects(page);
    await page.evaluate(async () => {
      const s = await import("./js/store.js");
      const [p] = await s.listProjects();
      await s.saveEntry({ date: "2020-03-02", hours: 8, projectId: p.id });
      await s.saveEntry({ date: "2026-09-24", hours: 8, projectId: p.id });
    });
    await page.goto(BASE + "#/installningar/gallring");
    await page.reload();
    await page.getByRole("button", { name: "Radera 1 rad" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Fortsätt" }).click();
    const second = page.locator("dialog[open]");
    await second.getByText("Det här går inte att ångra.").waitFor();
    await second.getByRole("textbox").fill("RADERA");
    await second.getByRole("button", { name: "Radera" }).click();
    await page.getByText("1 registrering raderad", { exact: true }).waitFor();
    const left = await page.evaluate(async () => (await (await import("./js/store.js")).listEntries()).map((e) => e.date));
    check(left.join() === "2026-09-24", `Fel rader kvar: ${left.join()}`);
    await context.close();
  });

  await test("Inställningar: utan projekt rapporteras tiden på kunden", async () => {
    const { context, page } = await openWithAdmin(browser, "#/installningar/projekt", {}, { loggedIn: true });
    await seedProjects(page);
    await page.reload();
    const box = page.getByLabel("Använd projekt");
    check(await box.isChecked(), "Projekt ska användas som standard");
    await box.uncheck();
    await page.getByRole("button", { name: "Spara projekt" }).click();
    await page.getByText("Projekt används inte – tiden rapporteras på kunder").waitFor();
    await page.locator('.nav__link[href="#/projekt"]', { hasText: "Kunder" }).waitFor();

    // Kundsidan: inga projekt-flikar och ingen Nytt projekt-knapp
    await page.goto(BASE + "#/projekt");
    await page.reload();
    await page.locator("h1", { hasText: "Kunder" }).waitFor();
    check(!(await page.getByRole("button", { name: "Nytt projekt" }).count()), "Nytt projekt visas fast projekt är av");
    await page.locator(".row", { hasText: "Villa Holm" }).waitFor();

    // Tidrapporten: bara kund, inget projektfält
    await page.goto(BASE + `#/tid/${DAY}`);
    await page.reload();
    await page.locator("h1", { hasText: "Lägg till tid" }).waitFor();
    check(!(await page.locator("#time-project").count()), "Projektfältet visas fast projekt är av");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    check((await page.locator("#time-customer").getAttribute("aria-invalid")) === "true", "Saknad kund markerades inte");
    await page.locator("#time-customer").selectOption({ label: "Villa Holm" });
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.getByText("Registreringen är sparad").waitFor();
    await page.locator(".row", { hasText: "Villa Holm" }).getByText("Väntar på granskning").waitFor();

    // Granskning summerar per kund
    await page.goto(BASE + "#/granska/2026-09");
    await page.reload();
    await page.locator("#rv-projects", { hasText: "Per kund" }).waitFor();
    await page.locator("[data-projects] th", { hasText: "Villa Holm" }).waitFor();
    check(!(await page.locator("#rv-project").count()), "Projektfiltret visas fast projekt är av");
    await context.close();
  });
}

// "Klart när" i kravlistan – hela kedjan enbart via gränssnittet (inga genvägar via store.js)
async function acceptanceTests(browser) {
  await test("Klart när: företag → kund → projekt → medarbetare → tid → godkänd → CSV", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const dialog = page.locator("dialog[open]");

    // Tom start: Skapa konto
    await page.goto(BASE);
    await page.locator("h1", { hasText: "Skapa konto" }).waitFor();
    check((await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tidla:")).length)) === 0, "Data finns redan vid tom start");
    await page.getByLabel("Företagsnamn").fill("Exempelbolaget AB");
    await page.getByLabel("Ditt namn").fill("Anna Admin");
    await page.getByLabel("E-post").fill("anna@exempel.se");
    await page.locator("#setup-password").fill("hemligt123");
    await page.getByRole("button", { name: "Skapa konto" }).click();
    await page.waitForFunction(() => location.hash === "#/kom-igang");

    // Företag via Kom igång – steg 1 är inte klart förrän uppgifterna har sparats
    await page.getByText("0 av 4 klart").waitFor();
    await page.getByRole("link", { name: "Fyll i" }).click();
    await page.getByLabel("Organisationsnummer").fill("556677-8899");
    await page.getByRole("button", { name: "Spara företag" }).click();
    await page.getByText("Företaget är sparat").waitFor();
    await page.locator('.nav__link[href="#/kom-igang"]').click();
    await page.getByText("1 av 4 klart").waitFor();

    // Kund och projekt via Kom igång
    await page.getByRole("link", { name: "Lägg till kund" }).click();
    await dialog.getByLabel("Kundnummer").fill("100");
    await dialog.getByLabel("Namn", { exact: true }).fill("Kund AB");
    await dialog.getByRole("button", { name: "Lägg till kund" }).click();
    await page.waitForSelector("dialog", { state: "detached" });
    await page.locator('.nav__link[href="#/kom-igang"]').click();
    await page.getByRole("link", { name: "Lägg till projekt" }).click();
    await dialog.getByLabel("Kund", { exact: true }).selectOption({ label: "Kund AB (kundnr 100)" });
    await dialog.getByLabel("Projektnummer").fill("P-1");
    await dialog.getByLabel("Projektnamn").fill("Första projektet");
    await dialog.getByRole("button", { name: "Lägg till projekt" }).click();
    await page.waitForSelector("dialog", { state: "detached" });

    // Medarbetare
    await page.locator('.nav__link[href="#/kom-igang"]').click();
    await page.getByRole("link", { name: "Lägg till medarbetare" }).click();
    await dialog.getByLabel("Namn").fill("Maja Medarbetare");
    await dialog.getByLabel("Anställningsnummer").fill("2");
    await dialog.getByLabel("E-post").fill("maja@exempel.se");
    await dialog.getByRole("button", { name: "Lägg till och visa lösenord" }).click();
    const otp = (await page.locator("dialog[open] .secret").textContent()).trim();
    await dialog.getByRole("button", { name: "Klart" }).click();
    await page.locator('.nav__link[href="#/kom-igang"]').click();
    await page.getByText("4 av 4 klart").waitFor();

    // Medarbetaren loggar in, väljer lösenord och rapporterar tid
    await page.getByRole("button", { name: "Logga ut" }).first().click();
    await page.getByLabel("E-post").fill("maja@exempel.se");
    await page.locator("#login-password").fill(otp);
    await page.getByRole("button", { name: "Logga in" }).click();
    await page.locator("#pw-new").fill("majaslosen1");
    await page.locator("#pw-repeat").fill("majaslosen1");
    await page.getByRole("button", { name: "Spara och fortsätt" }).click();
    await page.waitForFunction(() => location.hash.startsWith("#/tid"));
    await page.locator("#time-customer").selectOption({ label: "Kund AB" });
    await page.locator("#time-project").selectOption({ label: "P-1 · Första projektet" });
    await page.locator("#time-hours").fill("7,5");
    await page.getByRole("button", { name: "Spara registrering" }).click();
    await page.locator(".row", { hasText: "Kund AB · P-1 Första projektet" }).getByText("7,5 h").waitFor();

    // Admin godkänner och exporterar
    await page.getByRole("button", { name: "Logga ut" }).first().click();
    await page.getByLabel("E-post").fill("anna@exempel.se");
    await page.locator("#login-password").fill("hemligt123");
    await page.getByRole("button", { name: "Logga in" }).click();
    await page.waitForFunction(() => location.hash.startsWith("#/tid"));
    await page.locator('.nav__link[href="#/granska"]').click();
    const maja = page.locator(".person", { hasText: "Maja Medarbetare" });
    await maja.getByRole("button", { name: "Godkänn vecka" }).click();
    await page.getByText("1 rad godkänd", { exact: true }).waitFor();
    await page.getByLabel("Bara godkända").check();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Tid (CSV)" }).click()]);
    const csv = await readDownload(download);
    check(csv.startsWith("﻿Datum;Anställd;"), "CSV saknar BOM eller rubrik");
    check(/;Maja Medarbetare;2;100;Kund AB;P-1;Första projektet;Arbete;7,5;.*;Godkänd\r\n$/.test(csv), `Fel innehåll: ${csv}`);
    await context.close();
  });

  await test("Klart när: alla sidor fungerar på 390 px bredd utan sidledsskroll", async () => {
    const { context, page } = await openWithAdmin(browser, "#/kom-igang", { viewport: { width: 390, height: 844 } }, { loggedIn: true });
    await seedReview(page, { materials: true });
    const routes = ["#/kom-igang", "#/tid", "#/granska", "#/projekt", "#/projekt/kunder", "#/anstallda", "#/material", "#/material/artiklar", "#/installningar", "#/profil", "#/mer"];
    const problems = [];
    for (const route of routes) {
      await page.goto(BASE + route);
      await page.reload();
      await page.waitForSelector("h1");
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) problems.push(`${route} (${overflow}px)`);
    }
    // Medarbetarens sidor
    await page.evaluate(async () => {
      const s = await import("./js/store.js");
      await s.logout();
      await s.login("2@exempel.se", "hemligt123");
    });
    for (const route of ["#/kom-igang", "#/tid", "#/granska", "#/projekt", "#/profil"]) {
      await page.goto(BASE + route);
      await page.reload();
      await page.waitForSelector("h1");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) problems.push(`medarbetare ${route} (${overflow}px)`);
    }
    await page.evaluate(async () => (await import("./js/store.js")).logout());
    await page.goto(BASE + "#/login");
    await page.reload();
    await page.waitForSelector("h1");
    if ((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) > 0) problems.push("#/login");
    check(!problems.length, `Sidledsskroll: ${problems.join(", ")}`);
    await context.close();
    return `${routes.length + 6} sidor`;
  });
}

// Testversionen: växeln Logga in / Skapa konto, raden "Testversion" och Byt företag
async function demoTests(browser) {
  await test("Testversion: växla mellan Logga in och Skapa konto", async () => {
    const { context, page } = await openWithAdmin(browser, "#/login");
    const nav = page.getByRole("navigation", { name: "Logga in eller skapa konto" });
    check((await nav.getByRole("link", { name: "Logga in" }).getAttribute("aria-current")) === "page", "Logga in var inte vald");
    await nav.getByRole("link", { name: "Skapa konto" }).click();
    await page.locator("h1", { hasText: "Skapa konto" }).waitFor();
    check((await page.evaluate(() => location.hash)) === "#/signup", "Skapa konto öppnades inte fast det finns ett företag");

    // Ett nytt konto ersätter företaget som finns – efter en fråga
    await page.getByLabel("Företagsnamn").fill("Nya företaget AB");
    await page.getByLabel("Ditt namn").fill("Nina Ny");
    await page.getByLabel("E-post").fill("nina@exempel.se");
    await page.locator("#setup-password").fill("hemligt123");
    await page.getByRole("button", { name: "Skapa konto" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Avbryt" }).click();
    check((await page.evaluate(() => location.hash)) === "#/signup", "Bytte sida fast man avbröt");
    await page.getByRole("button", { name: "Skapa konto" }).click();
    await dialog.getByRole("button", { name: "Radera och skapa konto" }).click();
    await page.waitForFunction(() => location.hash === "#/kom-igang");
    await page.locator(".sidebar__company", { hasText: "Nya företaget AB" }).waitFor();
    await context.close();
  });

  await test("Testversion: Byt företag raderar allt och går till Skapa konto", async () => {
    const { context, page } = await openWithAdmin(browser, "#/tid", {}, { loggedIn: true });
    await page.getByText("Testversion – sparas bara i den här webbläsaren.").waitFor();
    await page.getByRole("button", { name: "Byt företag" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Radera och byt" }).click();
    await page.waitForFunction(() => location.hash === "#/signup");
    check((await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tidla:") && k !== "tidla:theme").length)) === 0, "Data finns kvar");
    await context.close();
  });
}

async function themeTests(browser) {
  await test("Tema: följer systemets mörka läge utan inställning", async () => {
    const { context, page } = await open(browser, "#/stilguide", { colorScheme: "dark" });
    const dark = await page.waitForFunction((bg) => getComputedStyle(document.body).backgroundColor === bg, DARK_BG, { timeout: 5000 }).then(() => true, () => false);
    check(dark, `Bakgrund ${await bodyBackground(page)}`);
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction((bg) => getComputedStyle(document.body).backgroundColor === bg, LIGHT_BG);
    const updated = await page
      .waitForFunction(() => document.querySelector('[data-theme-toggle="sidebar"]').getAttribute("aria-pressed") === "false", null, { timeout: 3000 })
      .then(() => true, () => false);
    check(updated, "Temaknappen uppdaterades inte när systemet bytte tema");
    await context.close();
  });

  await test("Tema: knappen byter tema, valet finns kvar efter omladdning", async () => {
    const { context, page } = await open(browser, "#/stilguide", { colorScheme: "light" });
    await page.locator('[data-theme-toggle="sidebar"]').click();
    check((await bodyBackground(page)) === DARK_BG, "Bytte inte till mörkt");
    check((await page.locator('[data-theme-toggle="sidebar"]').getAttribute("aria-pressed")) === "true", "aria-pressed uppdaterades inte");
    await page.reload();
    await page.waitForSelector("h1");
    check((await bodyBackground(page)) === DARK_BG, "Valet fanns inte kvar efter omladdning");
    await page.locator('[data-theme-toggle="sidebar"]').click();
    const stored = await page.evaluate(() => localStorage.getItem("tidla:theme"));
    check(stored === null, "Samma tema som systemet ska ta bort det egna valet");
    await context.close();
  });

  await test("Tema: blinkar inte vid omladdning med eget val", async () => {
    const { context, page } = await open(browser, "#/stilguide", { colorScheme: "light" });
    await page.locator('[data-theme-toggle="sidebar"]').click();
    await context.addInitScript(() => {
      const record = () => {
        if (document.body) window.__firstPaintBg = getComputedStyle(document.body).backgroundColor;
        else requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    await page.reload();
    await page.waitForSelector("h1");
    const first = await page.evaluate(() => window.__firstPaintBg);
    check(first === DARK_BG, `Första bildrutan hade bakgrund ${first} (ljus blinkning)`);
    await context.close();
  });
}

async function mobileTests(browser, engine) {
  const device =
    engine === "WebKit" ? devices["iPhone 13"] : engine === "Edge" ? devices["Pixel 7"] : { viewport: { width: 390, height: 844 } };
  const deviceName = engine === "WebKit" ? "iPhone 13" : engine === "Edge" ? "Pixel 7" : "390 × 844";

  await test(`Mobil (${deviceName}): ingen sidledsskroll, fält 16px, tryckytor minst 48px`, async () => {
    const { context, page } = await open(browser, "#/stilguide/medarbetare", device);
    const report = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - innerWidth;
      const small = [];
      document.querySelectorAll("a, button, input, select, textarea, label.check").forEach((el) => {
        if (el.closest(".sidebar") || el.matches(".check input, .datenav__picker, [data-skip-link]")) return;
        const rect = el.getBoundingClientRect();
        if (!rect.width || getComputedStyle(el).visibility === "hidden") return;
        if (rect.height < 47.5 || (rect.width < 47.5 && !el.matches("input, select, textarea"))) {
          small.push(`<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 25)}" ${Math.round(rect.width)}×${Math.round(rect.height)}`);
        }
      });
      const fonts = [...document.querySelectorAll(".input, .select, .textarea")]
        .map((el) => parseFloat(getComputedStyle(el).fontSize))
        .filter((size) => size < 16);
      return { overflow, small, fonts: fonts.length };
    });
    check(report.overflow <= 0, `Sidan går att skrolla ${report.overflow}px i sidled`);
    check(!report.fonts, `${report.fonts} fält har mindre text än 16px (mobilen zoomar in)`);
    check(!report.small.length, `För små tryckytor: ${report.small.join("; ")}`);
    await context.close();
  });

  await test(`Mobil (${deviceName}): flikmenyn täcker inget innehåll`, async () => {
    const { context, page } = await open(browser, "#/stilguide/medarbetare", device);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    const gap = await page.evaluate(() => {
      const tabbar = document.querySelector(".tabbar").getBoundingClientRect();
      const last = document.querySelector(".main__inner").lastElementChild.getBoundingClientRect();
      return tabbar.top - last.bottom;
    });
    check(gap >= 0, `Sista innehållet ligger ${Math.round(-gap)}px under flikmenyn`);
    const tabs = await page.locator(".tabbar__link").count();
    check(tabs === 5, `Flikmenyn för medarbetare har ${tabs} flikar`);
    await context.close();
  });

  await test(`Mobil (${deviceName}): dialogen öppnas som ett ark nerifrån`, async () => {
    const { context, page } = await open(browser, "#/stilguide/medarbetare", device);
    await page.getByRole("button", { name: "Bekräftelsedialog" }).click();
    const box = await page.locator("dialog[open]").boundingBox();
    const size = page.viewportSize();
    check(Math.abs(box.y + box.height - size.height) <= 2, `Dialogens underkant ligger ${Math.round(size.height - box.y - box.height)}px från skärmens nederkant`);
    check(Math.abs(box.width - size.width) <= 1, `Dialogen är ${Math.round(box.width)}px bred av ${size.width}`);
    await context.close();
  });
}

async function zoomTests(browser) {
  for (const [label, width, height] of [
    ["200 % zoom (1440 → 720px)", 720, 500],
    ["400 % zoom (1280 → 320px)", 320, 256],
  ]) {
    await test(`${label}: inget klipps eller hamnar utanför`, async () => {
      const { context, page } = await open(browser, "#/stilguide", { viewport: { width, height } });
      const report = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - innerWidth;
        const outside = [...document.querySelectorAll("h1, h2, p, label, button, a, input, select, .pill, .row")]
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width && getComputedStyle(el).position !== "fixed" && rect.right > innerWidth + 1 && !el.closest(".segmented, .table-wrap");
          })
          .map((el) => `<${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 25)}"`);
        return { overflow, outside: [...new Set(outside)].slice(0, 8) };
      });
      check(report.overflow <= 0, `Sidan går att skrolla ${report.overflow}px i sidled: ${report.outside.join(", ")}`);
      check(!report.outside.length, `Utanför skärmen: ${report.outside.join(", ")}`);
      await context.close();
    });
  }
}

/* ---------- Tester som bara behöver köras en gång ---------- */

async function onceTests(browser) {
  await test("Hemskärm: manifest, ikoner och favicon laddas", async () => {
    const { context, page } = await open(browser, "");
    const report = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]').href;
      const manifest = await (await fetch(link)).json();
      const urls = [
        ...manifest.icons.map((icon) => new URL(icon.src, link).href),
        ...[...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.href),
      ];
      const statuses = await Promise.all(urls.map(async (url) => [url.split("/").pop(), (await fetch(url)).status]));
      return { name: manifest.name, short: manifest.short_name, display: manifest.display, statuses };
    });
    check(report.name === "Tidla" && report.short === "Tidla", "Fel namn i manifestet");
    check(report.display === "standalone", "Appen öppnas inte som fristående app");
    const broken = report.statuses.filter(([, status]) => status !== 200);
    check(!broken.length, `Saknas: ${broken.map(([f]) => f).join(", ")}`);
    await context.close();
    return `${report.statuses.length} ikonfiler`;
  });

  await test("Prototypens tk-nycklar är orörda, tom start visar första start", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Prototypens nycklar på samma adress (prototypfilen finns inte längre i projektet)
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.setItem("tk-u3", JSON.stringify([{ id: "u1", name: "Prototyp Person", no: "7" }]));
      localStorage.setItem("tk-c3", JSON.stringify([{ id: "c1", number: "100", name: "Prototypkund" }]));
      localStorage.setItem("tk-p3", "[]");
      localStorage.setItem("tk-s3", "{}");
      localStorage.setItem("tk-d3-u1", "[]");
      sessionStorage.setItem("tk-session", "u1");
    });
    const snapshot = () =>
      page.evaluate(() => {
        const read = (storage) => Object.fromEntries(Object.keys(storage).map((k) => [k, storage.getItem(k)]));
        return { local: read(localStorage), session: read(sessionStorage) };
      });
    const before = await snapshot();
    check(Object.keys(before.local).some((k) => k.startsWith("tk-")), "Prototypen skapade inga nycklar");

    await page.goto(BASE);
    await page.waitForSelector("h1");
    check((await page.evaluate(() => location.hash)) === "#/signup", "Tom start visade inte första start");
    await page.goto(BASE + "#/stilguide");
    await page.waitForSelector("h1");
    await page.locator('[data-theme-toggle="sidebar"]').click();
    await page.reload();
    await page.waitForSelector("h1");
    const after = await snapshot();

    for (const area of ["local", "session"]) {
      for (const [key, value] of Object.entries(before[area])) {
        if (key.startsWith("tk-")) check(after[area][key] === value, `${key} ändrades`);
      }
    }
    const added = Object.keys(after.local).filter((k) => !(k in before.local));
    check(added.join() === "tidla:theme", `Oväntade nya nycklar: ${added.join(", ")}`);
    await context.close();
    return `${Object.keys(before.local).length} prototypnycklar oförändrade`;
  });

  for (const [label, route, scheme, seed, mobile] of [
    ["stilguiden, ljust tema", "#/stilguide", "light"],
    ["stilguiden, mörkt tema", "#/stilguide", "dark"],
    ["stilguiden som medarbetare i mobil", "#/stilguide/medarbetare", "light"],
    ["skapa konto, ljust tema", "", "light"],
    ["skapa konto, mörkt tema", "", "dark"],
    ["skapa konto i mobil", "", "light", undefined, "mobile"],
    ["inloggning, ljust tema", "#/login", "light", "seed"],
    ["inloggning, mörkt tema", "#/login", "dark", "seed"],
    ["inloggning i mobil", "#/login", "light", "seed", "mobile"],
    ["Kom igång, ljust tema", "#/kom-igang", "light", "admin"],
    ["Kom igång, mörkt tema", "#/kom-igang", "dark", "admin"],
    ["Kom igång i mobil", "#/kom-igang", "light", "admin", "mobile"],
    ["Kunder & projekt, ljust tema", "#/projekt", "light", "admin"],
    ["Kunder & projekt, mörkt tema", "#/projekt/kunder", "dark", "admin"],
    ["Kunder & projekt i mobil", "#/projekt", "light", "admin", "mobile"],
    ["Anställda, ljust tema", "#/anstallda", "light", "admin"],
    ["Anställda, mörkt tema", "#/anstallda", "dark", "admin"],
    ["Profil, ljust tema", "#/profil", "light", "admin"],
    ["Profil i mobil, mörkt tema", "#/profil", "dark", "admin", "mobile"],
    ["Mer i mobil", "#/mer", "light", "admin", "mobile"],
    ["Tidrapport, ljust tema", "#/tid/2026-09-24", "light", "admin"],
    ["Tidrapport, mörkt tema", "#/tid/2026-09-24", "dark", "admin"],
    ["Tidrapport i mobil", "#/tid/2026-09-24", "light", "admin", "mobile"],
    ["Inställningar, ljust tema", "#/installningar", "light", "admin"],
    ["Inställningar, mörkt tema", "#/installningar", "dark", "admin"],
    ["Inställningar i mobil", "#/installningar", "light", "admin", "mobile"],
    ["Material (av)", "#/material", "light", "admin"],
    ["Granskning, ljust tema", "#/granska/2026-09", "light", "admin"],
    ["Granskning, mörkt tema", "#/granska/2026-09", "dark", "admin"],
    ["Granskning i mobil", "#/granska/2026-09", "light", "admin", "mobile"],
  ]) {
    await test(`axe (WCAG 2.2 A/AA): ${label}`, async () => {
      const options = { colorScheme: scheme, ...(route.includes("medarbetare") || mobile ? devices["Pixel 7"] : {}) };
      const { context, page } = seed
        ? await openWithAdmin(browser, route, options, { loggedIn: seed === "admin" })
        : await open(browser, route, options);
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      await context.close();
      check(
        !violations.length,
        violations
          .map((v) => `${v.impact} · ${v.id}: ${v.help}\n  ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join("\n  ")}`)
          .join("\n"),
      );
    });
  }
}

/* ---------- Kör ---------- */

const ENGINES = [
  ["Edge", chromium, { channel: "msedge" }],
  ["Firefox", firefox, {}],
  ["WebKit", webkit, {}],
];

try {
  for (const [engine, type, launch] of ENGINES) {
    currentEngine = engine;
    console.log(`\n${engine}${engine === "WebKit" ? " (Safaris motor)" : ""}`);
    let browser;
    try {
      browser = await type.launch(launch);
    } catch (error) {
      results.push({ engine, name: "Starta webbläsaren", ok: false, note: error.message.split("\n")[0] });
      console.log(`  ✗ Kunde inte starta: ${error.message.split("\n")[0]}`);
      continue;
    }
    await keyboardTests(browser, engine);
    await loginTests(browser);
    await setupTests(browser);
    await projectTests(browser);
    await staffTests(browser);
    await timeTests(browser);
    await materialTests(browser);
    await reviewTests(browser);
    await laterFixTests(browser);
    await dialogAndVehicleTests(browser);
    await lockAndRejectTests(browser);
    await exportFilterTests(browser);
    await settingsTests(browser);
    await acceptanceTests(browser);
    await demoTests(browser);
    await themeTests(browser);
    await mobileTests(browser, engine);
    await zoomTests(browser);
    if (engine === "Edge") {
      console.log("  – en gång –");
      await onceTests(browser);
    }
    await browser.close();
  }
} finally {
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} av ${results.length} webbläsartester gick igenom.`);
if (failed.length) process.exitCode = 1;
