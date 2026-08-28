export function validBrandColor(value?: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#247A6B";
}

function channels(hex: string) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex: string) {
  const values = channels(hex).map((value) => value / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}

function contrast(first: string, second: string) {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + .05) / (dark + .05);
}

export function accessibleBrandColor(value?: string) {
  let candidate = validBrandColor(value);
  let rgb = channels(candidate);
  while (contrast(candidate, "#FAF7F0") < 4.5) {
    rgb = rgb.map((channel) => Math.max(0, Math.round(channel * .82)));
    candidate = `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return candidate;
}

export function agencyLogoSource(value: string | undefined, agencyId: string | undefined) {
  if (!value) return "";
  if (!value.startsWith("r2://")) return value;
  if (!agencyId) return "";
  const prefix=`r2://agencies/${agencyId}/branding/`;
  if (!value.startsWith(prefix)) return "";
  const fileName=value.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(fileName)
    ? `/api/agency-logo/${agencyId}/${encodeURIComponent(fileName)}` : "";
}
