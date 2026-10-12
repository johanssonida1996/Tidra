// Var en tidrad eller ett uttag hör hemma: ett projekt (och dess kund) – eller bara en kund,
// när företaget inte använder projekt (settings.projects.enabled = false).
// Rena funktioner – projectById/customerById är uppslagsfunktioner (id → post).

export const projectsOn = (settings) => settings?.projects?.enabled !== false;

export function placeOf(row, projectById, customerById) {
  const project = row.projectId ? projectById(row.projectId) ?? null : null;
  const customer = customerById(project ? project.customerId : row.customerId) ?? null;
  return { project, customer };
}

// Nyckel för att gruppera och filtrera: projektet, annars kunden
export const placeKey = (row) => (row.projectId ? `p:${row.projectId}` : row.customerId ? `c:${row.customerId}` : "");

// "Brf Linden · P-101 Takbyte" eller "Brf Linden"
export function placeLabel(row, projectById, customerById, { short = false } = {}) {
  const { project, customer } = placeOf(row, projectById, customerById);
  const customerName = customer?.name ?? "Okänd kund";
  if (!row.projectId) return customerName;
  if (!project) return `${customerName} · Okänt projekt`;
  return short ? `${customerName} · ${project.projectNo}` : `${customerName} · ${project.projectNo} ${project.name}`;
}

// Länkar för projektets adress och kontakt
export const mapUrl = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
export const telUrl = (phone) => `tel:${phone.replace(/[^\d+]/g, "")}`;
