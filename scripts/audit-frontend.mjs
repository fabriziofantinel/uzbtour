import { readFile } from "node:fs/promises";

const files = {
  globals: await readFile("app/globals.css", "utf8"),
  tour: await readFile("app/tour.css", "utf8"),
  challenges: await readFile("app/challenges.css", "utf8"),
  importReview: await readFile("app/agenzia/importazioni/[id]/review.css", "utf8"),
  importValidation: await readFile("app/agenzia/importazioni/[id]/validation.css", "utf8"),
  importNormalized: await readFile("app/agenzia/importazioni/[id]/normalized.css", "utf8"),
  experience: await readFile("app/viaggio/travel-experience.tsx", "utf8"),
  dialog: await readFile("components/expense-dialog.tsx", "utf8"),
};

const css = [
  files.globals,
  files.tour,
  files.challenges,
  files.importReview,
  files.importValidation,
  files.importNormalized,
].join("\n");
const cssWithoutTokens = css.replace(/:root\s*\{[^}]*\}/gs, "");
const checks = [
  ["Design system", !/(?:#(?:[\da-f]{3,8})\b|rgba?\()/i.test(cssWithoutTokens), "nessun colore fuori dai token"],
  ["Design system", /--text-caption:/.test(files.globals) && /--surface-raised:/.test(files.globals), "scala tipografica e superfici semantiche"],
  ["Design system", !/font-size\s*:\s*(?:[7-9]|10|11)px\b/i.test(css), "nessun testo letterale sotto 12 px"],
  ["Design system", /color-scheme\s*:\s*light/.test(files.globals), "schema cromatico dichiarato"],
  ["Accessibilità", /:focus-visible/.test(files.globals), "focus tastiera visibile"],
  ["Accessibilità", /prefers-reduced-motion/.test(files.tour), "movimento ridotto supportato"],
  ["Accessibilità", /role="dialog"/.test(files.dialog) && /aria-modal="true"/.test(files.dialog), "dialogo modale semantico"],
  ["Accessibilità", /Salta al contenuto del viaggio/.test(files.experience) && /aria-live="polite"/.test(files.experience), "skip link e annunci dinamici"],
  ["Responsive", /@media \(max-width: 700px\)/.test(files.tour) && /@media \(max-width: 800px\)/.test(files.importReview), "layout smartphone dedicato"],
  ["Responsive", /min-height:\s*44px/.test(css), "target tattili da 44 px"],
  ["Responsive", /overflow-x:\s*hidden/.test(files.tour), "protezione overflow orizzontale"],
  ["Responsive", /env\(safe-area-inset-bottom\)/.test(files.tour), "safe area mobile supportata"],
  ["Prestazioni", /dynamic\(/.test(files.experience), "sezioni pesanti caricate su richiesta"],
  ["Prestazioni", /content-visibility:\s*auto/.test(css), "liste lunghe renderizzate progressivamente"],
  ["Prestazioni", /loading="lazy"/.test(files.experience) && /decoding="async"/.test(files.experience), "immagini differite e decodifica asincrona"],
  ["Prestazioni", !/travel\.css/.test(files.experience), "foglio duplicato rimosso"],
  ["Qualità", /tabIndex=\{-1\}/.test(files.experience), "focus gestito al cambio sezione"],
  ["Qualità", /returnFocusRef\.current\?\.focus\(\)/.test(files.dialog), "focus ripristinato alla chiusura"],
  ["Qualità", /event\.key === "Escape"/.test(files.dialog) && /event\.key !== "Tab"/.test(files.dialog), "Escape e focus trap implementati"],
  ["Qualità", /width=\{800\}/.test(files.experience) && /height=\{600\}/.test(files.experience), "dimensioni immagini riservate"],
];

const groups = new Map();
for (const [group, passed, label] of checks) {
  const entries = groups.get(group) ?? [];
  entries.push({ passed, label });
  groups.set(group, entries);
}

let score = 0;
for (const [group, entries] of groups) {
  const points = entries.filter((entry) => entry.passed).length;
  score += points;
  console.log(`${group}: ${points}/4`);
  for (const entry of entries) console.log(`  ${entry.passed ? "OK" : "KO"}  ${entry.label}`);
}
console.log(`\nTOTALE: ${score}/20`);
if (score !== 20) process.exitCode = 1;
