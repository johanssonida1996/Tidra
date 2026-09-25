// Exempelföretagen i testversionen. Alla namn, kunder och adresser är påhittade.
// Tidraderna skapas av seed.js utifrån profilerna nedan, med datum runt dagens datum.
// E-postadresserna slutar på .example (en domän som är reserverad för exempel och inte finns).

export const DEMO_PASSWORD = "demo1234";

export const DEMO_COMPANIES = [
  {
    key: "bygg",
    name: "Snickeri Exempel AB",
    branch: "Bygg",
    icon: "hammer",
    description: "Snickare hos flera kunder. Resor med egen bil, övertid och material från lagret.",
    settings: {
      workWeek: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
      hourStep: 0.5,
      overtime: { mode: "both", factor: 1.5 },
      travel: { enabled: true, billableDefault: false, employeeCanChangeBilling: true, countsTowardSchedule: false },
      materials: { enabled: true, label: "Material", allowFreeText: true },
    },
    articleTemplate: "bygg",
    // Exempelbelopp – i verkligheten kontrollerar admin dem mot Skatteverket
    vehicleRates: { "privat-bil": 25, "forman-el": 9.5 },
    hiddenVehicles: ["motorcykel"],
    admin: { name: "Anna Berg", email: "anna@snickeri.example", title: "VD", employeeNo: "1" },
    employees: [
      { name: "Erik Lind", email: "erik@snickeri.example", title: "Snickare", employeeNo: "2", projects: [0, 1], vehicle: "privat-bil" },
      { name: "Johanna Svärd", email: "johanna@snickeri.example", title: "Snickare", employeeNo: "3", projects: [2, 3], vehicle: "privat-bil" },
      { name: "Mohammed Rahimi", email: "mohammed@snickeri.example", title: "Lärling", employeeNo: "4", projects: [0, 4] },
      { name: "Petra Kvist", email: "petra@snickeri.example", title: "Arbetsledare", employeeNo: "5", projects: [1, 3, 5], vehicle: "forman-el" },
    ],
    // Har fått sitt engångslösenord men inte loggat in än
    pending: { name: "Oskar Holm", email: "oskar@snickeri.example", title: "Snickare", employeeNo: "6" },
    adminProjects: [5],
    customers: [
      { customerNo: "100", name: "Brf Linden", projects: [["P-101", "Takbyte", "Lindvägen 4"], ["P-102", "Nya balkonger", "Lindvägen 4"]] },
      { customerNo: "200", name: "Familjen Ekström", projects: [["P-201", "Altan och trappa", "Sjövägen 12"]] },
      { customerNo: "300", name: "Kontorshuset Norr", projects: [["P-301", "Innerväggar plan 3", "Norra gatan 8"], ["P-302", "Nytt fikarum", "Norra gatan 8"]] },
      { customerNo: "900", name: "Eget företag", projects: [["P-900", "Verkstad och inköp", ""]] },
    ],
    // Ett avslutat projekt, så att filtret för avslutade projekt har något att visa
    closedProject: { customer: 1, project: ["P-199", "Garageport", "Sjövägen 12"] },
    daily: { overtime: 0.12, trip: 0.45, travelHours: 0.3, twoProjects: 0.3, material: 0.15, sick: 0.02, vab: 0.02 },
    comments: [
      "Rivning klar, bärlinor på plats", "Väntade på leverans en timme", "Monterade reglar", "Slutbesiktning med kund",
      "Gipsat och spacklat", "Hämtade virke på bygghandeln", "Kunden vill ha extra eluttag",
    ],
    materialMessages: ["Beställ mer", "Snart slut", "", "", "Tog sista förpackningen"],
    rejectReason: "Fel projekt – det här var Nya balkonger, inte Takbyte.",
  },
  {
    key: "frisor",
    name: "Salong Exempel",
    branch: "Frisör",
    icon: "scissors",
    description: "Frisörsalong med produkter från lagret och deltid. Ingen restid eller milersättning.",
    settings: {
      workWeek: { mon: 0, tue: 8, wed: 8, thu: 8, fri: 8, sat: 6, sun: 0 },
      hourStep: 0.25,
      overtime: { mode: "pay", factor: 1.5 },
      travel: { enabled: false, billableDefault: false, employeeCanChangeBilling: false, countsTowardSchedule: false },
      materials: { enabled: true, label: "Produkter", allowFreeText: true },
    },
    articleTemplate: "frisor",
    vehicleRates: {},
    hiddenVehicles: ["firmabil", "privat-bil", "forman-bensin", "forman-diesel", "forman-el", "motorcykel"],
    admin: { name: "Lina Sjöberg", email: "lina@salong.example", title: "Ägare", employeeNo: "1" },
    employees: [
      { name: "Amira Haddad", email: "amira@salong.example", title: "Frisör", employeeNo: "2", projects: [0, 1] },
      { name: "Nils Åberg", email: "nils@salong.example", title: "Frisör", employeeNo: "3", projects: [0, 1, 2],
        schedule: { mon: 0, tue: 6, wed: 6, thu: 6, fri: 6, sat: 0, sun: 0 } },
      { name: "Wilma Törnqvist", email: "wilma@salong.example", title: "Frisörelev", employeeNo: "4", projects: [0, 2] },
    ],
    pending: null,
    adminProjects: [0, 3],
    customers: [
      { customerNo: "1", name: "Salongen", projects: [["S-1", "Klippning och färg", "Storgatan 5"], ["S-2", "Behandlingar", "Storgatan 5"], ["S-3", "Utbildning", ""]] },
      { customerNo: "2", name: "Bröllopsmässan", projects: [["E-1", "Styling på mässan", "Mässhallen"]] },
    ],
    closedProject: null,
    daily: { overtime: 0.08, trip: 0, travelHours: 0, twoProjects: 0.35, material: 0.3, sick: 0.03, vab: 0.02 },
    comments: ["Tre färgningar", "Kund kom sent", "Kurs i balayage", "Två bokningar avbokade", "Styling inför fotografering"],
    materialMessages: ["", "Sista tuben", "Beställ nr 7.1", "", "Kund köpte med sig hem"],
    rejectReason: "Du var ledig den dagen – ska det vara semester?",
  },
  {
    key: "stad",
    name: "Städ Exempel AB",
    branch: "Städ",
    icon: "sparkles",
    description: "Städfirma med fasta uppdrag. Firmabil per dag, restid som debiteras och förbrukningsmaterial.",
    settings: {
      workWeek: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
      hourStep: 0.25,
      overtime: { mode: "leave", factor: null },
      travel: { enabled: true, billableDefault: true, employeeCanChangeBilling: false, countsTowardSchedule: true },
      materials: { enabled: true, label: "Förbrukning", allowFreeText: false },
    },
    articleTemplate: "stad",
    vehicleRates: { "privat-bil": 25 },
    hiddenVehicles: ["forman-bensin", "forman-diesel", "forman-el", "motorcykel"],
    admin: { name: "Maria Olofsson", email: "maria@stad.example", title: "Driftchef", employeeNo: "1" },
    employees: [
      { name: "Ahmed Yusuf", email: "ahmed@stad.example", title: "Lokalvårdare", employeeNo: "2", projects: [0, 1], vehicle: "firmabil" },
      { name: "Elin Bergkvist", email: "elin@stad.example", title: "Lokalvårdare", employeeNo: "3", projects: [1, 2], vehicle: "firmabil" },
      { name: "Kalle Nordin", email: "kalle@stad.example", title: "Fönsterputsare", employeeNo: "4", projects: [3, 0], vehicle: "privat-bil" },
      { name: "Sofia Lindqvist", email: "sofia@stad.example", title: "Lokalvårdare", employeeNo: "5", projects: [2, 4],
        schedule: { mon: 6, tue: 6, wed: 6, thu: 6, fri: 0, sat: 0, sun: 0 } },
    ],
    pending: { name: "Jonas Blom", email: "jonas@stad.example", title: "Lokalvårdare", employeeNo: "6" },
    adminProjects: [4],
    customers: [
      { customerNo: "10", name: "Brf Solgården", projects: [["ST-10", "Trappstädning", "Solvägen 1–9"]] },
      { customerNo: "20", name: "Kontorshuset Norr", projects: [["ST-20", "Kontorsstädning", "Norra gatan 8"], ["ST-21", "Storstädning kök", "Norra gatan 8"]] },
      { customerNo: "30", name: "Familjen Ek", projects: [["ST-30", "Fönsterputs", "Ekbacken 3"]] },
      { customerNo: "99", name: "Eget företag", projects: [["ST-99", "Planering och inköp", ""]] },
    ],
    closedProject: { customer: 2, project: ["ST-31", "Flyttstädning", "Ekbacken 3"] },
    daily: { overtime: 0.1, trip: 0.6, travelHours: 0.5, twoProjects: 0.45, material: 0.18, sick: 0.03, vab: 0.02 },
    comments: ["Nyckel hämtad i receptionen", "Extra torkning av entrén", "Kunden var inte hemma", "Bytte mopp", "Avvikelse: trasig lampa i trapphus 3"],
    materialMessages: ["", "Förrådet nästan tomt", "", "Beställ till nästa vecka"],
    rejectReason: "Restiden stämmer inte – ni åkte tillsammans i firmabilen.",
  },
];
