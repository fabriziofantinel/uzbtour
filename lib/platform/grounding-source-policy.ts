const trustedDomains = ["esteri.it", "viaggiaresicuri.it", "unesco.org", "who.int", "worldbank.org", "europa.eu"];

function configuredDomains() {
  return (process.env.AWS_BEDROCK_GROUNDING_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isGovernmentHostname(hostname: string) {
  const labels = hostname.split(".");
  return labels.some((label) => ["gov", "gob", "go", "gouv", "gc", "admin"].includes(label));
}

export function isAllowedGroundingSource(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname.endsWith(".museum")) return true;
    return (
      [...trustedDomains, ...configuredDomains()].some((domain) => matchesDomain(hostname, domain)) ||
      isGovernmentHostname(hostname)
    );
  } catch {
    return false;
  }
}

export function validateGroundingSources(urls: Iterable<string>) {
  const unique = [...new Set(urls)];
  const accepted = unique.filter(isAllowedGroundingSource);
  if (accepted.length === 0) throw new Error("Grounding privo di fonti autorizzate");
  return accepted;
}
