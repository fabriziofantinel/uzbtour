import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import sharp from "sharp";

const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
assert.equal(manifest.start_url, "/viaggio");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.orientation, "portrait");
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
assert.deepEqual(
  manifest.icons.map((icon) => icon.sizes),
  ["192x192", "512x512"],
);
assert.ok(manifest.icons.every((icon) => icon.purpose.includes("any") && icon.purpose.includes("maskable")));
assert.deepEqual(
  manifest.shortcuts.map((shortcut) => shortcut.url),
  ["/viaggio?tab=programma&day=oggi", "/viaggio?tab=spese", "/viaggio?tab=documenti"],
);

const expectedImages = [
  ["public/icons/icon-192.png", 192, 192],
  ["public/icons/icon-512.png", 512, 512],
  ["public/icons/apple-touch-icon.png", 180, 180],
  ["public/icons/shortcut-programme.png", 96, 96],
  ["public/icons/shortcut-expenses.png", 96, 96],
  ["public/icons/shortcut-documents.png", 96, 96],
  ["public/splash/iphone-1170x2532.png", 1170, 2532],
  ["public/splash/iphone-1290x2796.png", 1290, 2796],
  ["public/splash/iphone-1242x2688.png", 1242, 2688],
];
for (const [path, width, height] of expectedImages) {
  await access(path);
  const metadata = await sharp(path).metadata();
  assert.equal(metadata.width, width, `${path}: larghezza errata`);
  assert.equal(metadata.height, height, `${path}: altezza errata`);
}
const companion = await readFile("components/pwa-companion.tsx", "utf8");
assert.match(companion, /beforeinstallprompt/);
assert.match(companion, /event\.preventDefault\(\)/);
assert.match(companion, /installPrompt\.prompt\(\)/);
assert.match(companion, /Aggiungi alla schermata Home/);
assert.match(companion, /Installa app/);
assert.match(companion, /sessionStorage/);
assert.match(companion, /display-mode: standalone/);
assert.match(companion, /SKIP_WAITING/);
const register = await readFile("components/service-worker-register.tsx", "utf8");
assert.match(register, /register\("\/sw\.js", \{ scope: "\/", updateViaCache: "none" \}\)/);
const layout = await readFile("app/layout.tsx", "utf8");
assert.doesNotMatch(layout, /manifest:/);
assert.match(layout, /viewportFit: "cover"/);
assert.match(layout, /rel="manifest" href="\/api\/pwa\/manifest\?v=3" crossOrigin="use-credentials"/);
const dynamicManifest = await readFile("app/api/pwa/manifest/route.ts", "utf8");
assert.match(dynamicManifest, /agencyName/);
assert.match(dynamicManifest, /\/api\/pwa\/icon\?size=/);
assert.match(dynamicManifest, /source=/);
const dynamicIcon = await readFile("app/api/pwa/icon/route.ts", "utf8");
assert.match(dynamicIcon, /branding\?\.logoUrl/);
assert.match(dynamicIcon, /resize\(/);
assert.match(dynamicIcon, /base64url/);
const traveler = await readFile("app/viaggio/travel-experience.tsx", "utf8");
assert.match(traveler, /<title>\{experience\.journey\.agencyName\}<\/title>/);
assert.match(traveler, /rel="apple-touch-icon"/);
assert.match(traveler, /apple-touch-startup-image/g);
console.log(
  JSON.stringify({
    status: "passed",
    manifest: true,
    icons: expectedImages.length,
    shortcuts: manifest.shortcuts.length,
    androidPrompt: true,
    iosGuide: true,
    serviceWorkerRegistration: true,
    updateFlow: true,
  }),
);
