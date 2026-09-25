// Lösenord och roller.
//
// OBS! DET HÄR ÄR INTE RIKTIG SÄKERHET.
// Allt körs i webbläsaren och all data (även lösenordshashar) ligger i localStorage, där den som
// har tillgång till datorn kan läsa och ändra den. Hashningen (SHA-256 med salt) gör bara att
// lösenorden inte står i klartext. I PHP-fasen ska inloggningen flyttas till servern
// (password_hash/password_verify, sessionscookie med HttpOnly) och den här filen tas bort.

const encoder = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password, salt) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${salt}:${password}`));
  return toHex(digest);
}

export async function verifyPassword(password, salt, expectedHash) {
  const actual = await hashPassword(password, salt);
  // Jämför hela strängen oavsett var första skillnaden finns
  let diff = actual.length ^ expectedHash.length;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ (expectedHash.charCodeAt(i) || 0);
  return diff === 0;
}

// Engångslösenord utan tecken som är lätta att blanda ihop (0/O, 1/l/I)
const OTP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function createOneTimePassword(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => OTP_ALPHABET[b % OTP_ALPHABET.length]).join("");
}

export const MIN_PASSWORD_LENGTH = 8;

export const ROLES = {
  admin: "Administratör",
  employee: "Medarbetare",
};

export const isAdmin = (user) => user?.role === "admin";

export function hasRole(user, roles) {
  return Boolean(user) && roles.includes(user.role);
}
