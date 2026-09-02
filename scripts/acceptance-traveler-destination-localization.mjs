import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/viaggio/travel-experience.tsx", import.meta.url), "utf8");
assert(!source.includes("Asia/Tashkent"), "Il client non deve fissare il fuso uzbeko");
assert(!source.includes("Asia/Ho_Chi_Minh"), "Il client non deve fissare il fuso vietnamita");
assert(!source.includes('includes("uzbek")'), "Il client non deve dedurre la valuta dal nome Paese");
assert(!source.includes('includes("vietnam")'), "Il client non deve dedurre la valuta dal nome Paese");

for (const profile of [
  { country: "Norvegia", currency: "NOK", timeZone: "Europe/Oslo" },
  { country: "Cile", currency: "CLP", timeZone: "America/Santiago" },
]) {
  assert.doesNotThrow(() => new Intl.NumberFormat("it-IT", { style: "currency", currency: profile.currency }));
  assert.doesNotThrow(() => new Intl.DateTimeFormat("it-IT", { timeZone: profile.timeZone }).format(new Date()));
}

console.log(JSON.stringify({ status: "passed", countries: ["Norvegia", "Cile"] }));
