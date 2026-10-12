# Tidla

Tidrapportering för byggföretag. Medarbetarna rapporterar tid per kund och projekt – eller bara per kund om företaget
inte använder projekt – eller frånvaro,
med restid, milersättning och material från lager. Administratören granskar, godkänner, låser månaden och
exporterar underlag till fakturering och lön.

Ren HTML, CSS och JavaScript (ES-moduler) – inget ramverk och inget byggsteg. Fas 1 sparar allt i webbläsarens
`localStorage`. I fas 2 byts datalagret (`js/store.js`) mot ett PHP/MySQL-API på one.com.

## Kör appen lokalt

ES-moduler fungerar inte när man dubbelklickar på `index.html` (`file://`). Starta en lokal webbserver i projektmappen:

```
npx serve .
```

Öppna adressen som skrivs ut. Data sparas per adress och port, så en ny port ger en tom app.

**Första gången** visas *Skapa konto* (`#/signup`): företagsnamn och administratörens konto. Därefter hamnar admin på
*Kom igång*, som visar vad som behövs innan medarbetarna kan börja: kund → projekt → medarbetare.

**Börja om från tomt** – kör i webbläsarens konsol (rör bara Tidlas data, inte prototypens `tk-*`-nycklar):

```js
Object.keys(localStorage).filter(k => k.startsWith("tidla:")).forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem("tidla:session"); location.reload();
```

## Testversionen på GitHub Pages

Testversionen publiceras på **https://johanssonida1996.github.io/Tidla/** vid varje push till `main`
(`.github/workflows/pages.yml`). Flödet kör `npm test` och publicerar sedan bara `index.html`, `manifest.json`,
`assets/`, `css/` och `js/`. Webbläsartesterna körs lokalt (`npm run test:browser`).

## Testversionen (DEMO_MODE)

`js/config.js` har `DEMO_MODE = true` i testversionen. Då kan man växla mellan **Logga in** och **Skapa konto**
på startsidan. Det finns ett företag per webbläsare: skapar man ett nytt konto raderas det som fanns, efter en fråga.
Överst i appen står att allt sparas i webbläsaren, med knappen **Byt företag** som tömmer datan.

**Sätt `DEMO_MODE = false` i den riktiga versionen** – då startar Tidla tomt och `js/demo/` laddas aldrig.

## Funktioner

| Sida | Medarbetare | Admin |
|---|---|---|
| **Tidrapport** `#/tid` | Kund → projekt, typ av tid (arbete, övertid – komptid/lön, frånvaro), timmar, resa (restid + milersättning), material, "Samma som igår", dagens tid mot schema, veckoremsa i mobilen | Samma – admin rapporterar egen tid |
| **Granska** `#/granska` | Egna rader per vecka, status och nekad-orsak | Alla anställda, filter, godkänn/neka rader eller veckor, markera månad som klar, summeringar, CSV-export |
| **Projekt** `#/projekt` | Läsvy med sök | Kunder & projekt: lägga till, redigera, avsluta, arkivera. Utan projekt heter sidan Kunder |
| **Kom igång** `#/kom-igang` | – | Steg för steg med automatiska bockar |
| **Anställda** `#/anstallda` | – | Lägga till (engångslösenord), redigera, eget schema, inaktivera, återställa lösenord |
| **Material** `#/material` | – | Uttag (nya/hanterade) och artikellista med förslag för bygg. Tillval med egen benämning |
| **Inställningar** `#/installningar` | – | Företag, arbetstid, tidssteg, projekt (på/av), övertid, restid, typer av tid, fordon och milersättning, material, säkerhetskopia, gallring |
| **Profil** `#/profil` | Tema, byta lösenord, logga ut | Samma |

- **Roller** kontrolleras i menyn, i routern, i varje vy och i `store.js`.
- **Tema:** ljust och mörkt, följer systemet eller väljs med knappen. Designunderlaget ligger bara lokalt, inte i repot.
- **Mobil först:** tryckytor minst 48 px, allt fungerar på 390 px bredd.
- **Export:** `tidla-underlag-ÅÅÅÅ-MM.csv` (tid) och `tidla-material-ÅÅÅÅ-MM.csv` – semikolon, decimalkomma, UTF-8 med BOM.
  Filtren läggs till i namnet, t.ex. `tidla-underlag-2026-10-v41-erik-lind-godkanda.csv`. Nekade rader tas bara med
  när man filtrerar på status Nekade.
  Excel visar `########` i datumkolumnen om den är för smal – dubbelklicka på kolumnkanten.

## Filstruktur

```
index.html            skal – laddar js/theme-boot.js, css/tidla.css och js/app.js
manifest.json         för "Lägg till på hemskärmen"
assets/               kopior av logotyper och ikoner (originalen ligger lokalt i tidla-logotyp/, inte i repot)
css/tidla.css         all stil: färgvariabler (ljust/mörkt), komponenter, layout
js/
  app.js              start, hash-router, rollskydd
  routes.js           sidor, roller och menyer
  config.js           DEMO_MODE (testversionen)
  store.js            ENDA modulen som läser/skriver data (byts ut i fas 2)
  auth.js             lösenordshashning (fas 1), roller
  theme.js            ljust/mörkt tema och temaknappar
  theme-boot.js       sätter temat innan sidan ritas (enda undantaget som läser localStorage direkt)
  lib/                html (escapar text), dates (lokal tid), format, icons, ui (dialoger, fält,
                      bekräftelser), csv, export (CSV-filerna), reminders (milersättning),
                      place (projekt eller kund för en rad)
  demo/               testversionen: raden överst med Byt företag
  views/              en fil per sida + shell (menyer), guard (rollkontroll), auth-layout,
                      material-dialog, styleguide (utvecklarsida #/stilguide)
tests/
  store.test.mjs      datalagret – körs i Node mot en lagring i minnet
  export.test.mjs     CSV-filerna
  contrast.test.mjs   färgkontraster enligt WCAG 2.2 AA, läser css/tidla.css
  browser.test.mjs    Edge, Firefox och WebKit: flöden, tangentbord, mobil, axe m.m.
```

## Tester

```
npm install                           # Playwright och axe (bara för webbläsartesterna)
npx playwright install firefox webkit # en gång
npm test                              # datalager, export och kontraster (Node, några sekunder)
npm run test:browser                  # alla webbläsartester (tar några minuter)
```

Webbläsartesterna startar en egen webbserver och använder tomma profiler – de rör aldrig riktig data.
De täcker bland annat hela kedjan i kravlistans "Klart när" (skapa konto → kund → projekt → medarbetare → tid →
godkänd → CSV) enbart via gränssnittet, att alla sidor fungerar på 390 px utan sidledsskroll och att prototypens
`tk-*`-nycklar är orörda.

## Datamodell (fas 1)

Allt ligger i `localStorage` under nycklar som börjar med `tidla:`. Datum lagras som `ÅÅÅÅ-MM-DD`, månader som
`ÅÅÅÅ-MM`, timmar som tal. Id:n är UUID-strängar. Prototypens nycklar (`tk-u3`, `tk-s3`, `tk-c3`, `tk-p3`,
`tk-d3-*`, `tk-session`) läses, migreras och raderas aldrig.

| Nyckel | Innehåll |
|---|---|
| `tidla:schema` | `1` |
| `tidla:session` | `{ userId, createdAt }` – i `localStorage` med "Kom ihåg mig", annars i `sessionStorage` |
| `tidla:theme` | `"light"` / `"dark"` (saknas = följ systemet). Per webbläsare, följer inte med i säkerhetskopian |
| `tidla:settings` | se nedan |
| `tidla:users` | anställda |
| `tidla:customers` | kunder |
| `tidla:projects` | projekt |
| `tidla:entries` | tidrader |
| `tidla:monthLocks` | låsta månader per anställd |
| `tidla:articles` | artikellista för material |
| `tidla:materials` | materialuttag |

**settings:** `companyName`, `orgNumber`, `workWeek { mon … sun }`, `hourStep` (0,25 / 0,5 / 1), `retentionMonths`,
`timeTypes [{ id, name, category: work|overtime|absence, compensation: pay|leave|null, placeless?, hidden }]`
(`placeless` = arbetstid utan kund och projekt, t.ex. kurs),
`overtime { mode: both|pay|leave|off, factor }`,
`travel { enabled, billableDefault, employeeCanChangeBilling, countsTowardSchedule }`, `projects { enabled }`,
`vehicleTypes [{ id, name, isCompanyCar, ratePerMil, rateYear, rateCustom, hidden, retired? }]`, `ratesCheckedAt`,
`materials { enabled, label, allowFreeText }`.

**Milersättning:** beloppen per mil är förifyllda med Skatteverkets skattefria belopp (`VEHICLE_RATES` i `store.js`,
med år och länk). `rateYear` är året beloppet gäller och `rateCustom` att admin har skrivit ett eget belopp. Vid start
får fordon utan eget belopp de aktuella förvalen – egna belopp skrivs aldrig över. När Skatteverket ändrar beloppen
uppdateras `VEHICLE_RATES` (belopp, år och länk). I januari påminns admin om beloppen gäller förra året.
Förmånsbil bensin och diesel är sedan oktober 2026 en rad (`forman`); de gamla typerna finns kvar som `retired` för äldre rader.

**users:** `id, employeeNo*, name, email*, phone, title, role: admin|employee, status: pending|active|inactive,
schedule | null, schedulePeriods [{ from | null, week | null }], passwordHash, salt, mustChangePassword, activatedAt, createdAt, updatedAt`

Eget schema gäller från ett datum (`schedulePeriods`, se `js/lib/schedule.js`) – äldre veckor räknas med schemat som gällde
då. `week: null` = företagets arbetstid, `from: null` = från början. `schedule` är det senast inlagda schemat (visas i formuläret).

**customers:** `id, customerNo*, name, orgNumber, archived, createdAt, updatedAt`

**projects:** `id, customerId, projectNo*, name, address, status: open|closed, closedAt, archived, createdAt, updatedAt`

**entries:** `id, userId, date, timeTypeId, hours, projectId | null, customerId | null, travelHours, travelBillable, vehicleTypeId | null,
vehicleBasis: day|km|null, km, comment, status: draft|approved|rejected, rejectReason, reviewedBy, reviewedAt,
createdAt, updatedAt`

**monthLocks:** `userId, month, lockedBy, lockedAt`

**articles:** `id, name*, unit, articleNo*, hidden, createdAt, updatedAt`

**materials:** `id, userId, date, articleId | null, name, unit, quantity, projectId | null, customerId | null, message, handled, handledBy,
handledAt, createdAt` – namn och enhet sparas på uttaget, så historiken stämmer även om artikeln ändras.

`*` = unikt, oavsett stora/små bokstäver. Äldre data (frånvarotyper, restid som egen typ, "littra") flyttas
automatiskt vid start – se `migrate…`-funktionerna i `store.js`.

## Regler (som API:et i fas 2 också måste upprätthålla)

- Medarbetare ser bara sina egna rader, uttag och månadslås. Admin ser alla.
- Bara admin: kunder, projekt, anställda, inställningar, typer, artiklar, godkänna/neka, låsa månad, export, säkerhetskopia, gallring.
- Tidrader skapas, ändras och tas bort bara av ägaren (även admin rapporterar bara egen tid).
- Godkända rader är låsta. En ändrad nekad rad blir utkast igen.
- I en låst månad kan inget ändras, godkännas eller nekas förrän admin låser upp.
- Arbete och övertid kräver ett pågående projekt (inte avslutat eller arkiverat). Frånvaro har inget projekt och ingen resa.
- Har admin stängt av projekt (`settings.projects.enabled = false`) kräver arbete, övertid och materialuttag i stället en
  kund som inte är arkiverad. Raden sparas med `customerId` och `projectId = null`. Rader med projekt har `customerId = null` –
  kunden fås via projektet. Det som redan är registrerat ändras inte när inställningen byts.
- Arbete + restid per person och dag är högst 24 timmar.
- Övertidstyper och restid får bara användas om admin tillåter dem.
- Kunder med projekt eller registreringar, projekt med tid eller uttag och anställda med registreringar kan inte raderas –
  bara arkiveras/inaktiveras.
- Det måste alltid finnas minst en aktiv administratör. Man kan inte nedgradera eller inaktivera sig själv.
- Nya anställda får ett engångslösenord och måste välja ett eget vid första inloggningen.

## Fas 2: PHP/MySQL på one.com

Alla vyer använder bara funktionerna i `js/store.js`. I fas 2 ersätts filens innehåll med `fetch()`-anrop mot ett API.
Funktionsnamn, argument, returvärden och felkoder ska vara desamma. Fel returneras som
`{ "code": "duplicate", "message": "…", "fields": { "customerNo": "…" } }` så att `store.js` kan kasta
`StoreError(code, message, fields)`. Koder: `unauthenticated` (401), `forbidden` (403), `validation` (422),
`duplicate` (409), `locked` (409), `in-use` (409), `invalid-state` (409), `not-found` (404).

| store-funktion | Förslag på endpoint |
|---|---|
| `needsSetup`, `completeSetup` | `GET /api/setup`, `POST /api/setup` (får bara lyckas när användartabellen är tom) |
| `getSession`, `login`, `logout`, `changePassword` | `GET /api/session`, `POST /api/login`, `POST /api/logout`, `POST /api/password` |
| `getSettings`, `saveSettings` | `GET /api/settings` (utan inloggning), `PATCH /api/settings` |
| `saveTimeType`, `saveVehicleType` | `POST/PUT /api/time-types`, `POST/PUT /api/vehicle-types` |
| `saveVehicleRates`, `confirmVehicleRates` | `PATCH /api/vehicle-types/rates`, `POST /api/vehicle-types/rates/confirm` |
| `listUsers`, `getUser`, `saveUser`, `setUserStatus`, `resetPassword`, `deleteUser` | `/api/users`, `/api/users/{id}`, `…/status`, `…/reset-password` |
| `getWorkWeek`, `getScheduledHours` | `GET /api/users/{id}/schedule` |
| `listCustomers`, `saveCustomer`, `setCustomerArchived`, `deleteCustomer` | `/api/customers`, `/api/customers/{id}` |
| `listProjects`, `saveProject`, `setProjectStatus`, `setProjectArchived`, `deleteProject` | `/api/projects`, `/api/projects/{id}` |
| `listEntries`, `getLastEntryBefore`, `saveEntry`, `deleteEntry` | `/api/entries?from=&to=&userId=&status=…`, `/api/entries/{id}` |
| `saveAbsenceRange` | `POST /api/entries/absence` – frånvaro från–till, en rad per arbetsdag enligt schemat, allt eller inget |
| `approveEntries`, `rejectEntries` | `POST /api/entries/approve`, `POST /api/entries/reject` |
| `listMonthLocks`, `lockMonth`, `unlockMonth` | `/api/month-locks`, `POST/DELETE /api/month-locks/{userId}/{month}` |
| `listArticles`, `saveArticle`, `addArticleTemplate` | `/api/articles`, `POST /api/articles/template` |
| `listMaterials`, `saveMaterial`, `deleteMaterial`, `setMaterialsHandled`, `countNewMaterials` | `/api/materials`, `…/handled`, `…/count` |
| `exportBackup`, `importBackup` | Ersätts troligen av serverns egen backup |
| `countEntriesBefore`, `purgeEntriesBefore` | `GET/DELETE /api/entries?before=` – gäller tidrader, material från lagret och månadslås |

`getThemePreference` / `setThemePreference` ligger kvar i webbläsaren även i fas 2.

**Säkerhet i fas 1:** inloggningen körs i webbläsaren och lösenorden hashas med SHA-256 och salt (`js/auth.js`).
Det är *inte* riktig säkerhet – den som har tillgång till datorn kan läsa och ändra datan. I fas 2 ska inloggningen
ske på servern (`password_hash`/`password_verify`, sessionscookie med HttpOnly) och `js/auth.js` tas bort.

**Driftsättning:** ladda upp `index.html`, `manifest.json`, `assets/`, `css/` och `js/`. `node_modules/`, `tests/`
och designmapparna behövs inte på servern.

## Utanför fas 1

Server och PHP, e-post och "Skicka inloggningslänk", saldo för komptid, lönefiler och integrationer samt
Excel-export (.xlsx).
