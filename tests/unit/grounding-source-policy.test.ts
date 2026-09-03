import { afterEach, describe, expect, test } from "vitest";
import { isAllowedGroundingSource, validateGroundingSources } from "../../lib/platform/grounding-source-policy";

afterEach(() => delete process.env.AWS_BEDROCK_GROUNDING_ALLOWED_DOMAINS);

describe("grounding source policy", () => {
  test("accepts official and government HTTPS sources", () => {
    expect(isAllowedGroundingSource("https://www.viaggiaresicuri.it/find-country/country/UZB")).toBe(true);
    expect(isAllowedGroundingSource("https://travel.state.gov/content/travel.html")).toBe(true);
    expect(isAllowedGroundingSource("http://www.esteri.it/example")).toBe(false);
  });

  test("rejects blogs and commercial portals", () => {
    expect(() => validateGroundingSources(["https://example-travel-blog.com/country"])).toThrow("privo di fonti");
    expect(isAllowedGroundingSource("https://gov.example.com/deceptive-path")).toBe(false);
    expect(isAllowedGroundingSource("https://example.gov.com/deceptive-path")).toBe(false);
  });

  test("accepts government labels only in the public suffix position", () => {
    expect(isAllowedGroundingSource("https://travel.state.gov/content/travel.html")).toBe(true);
    expect(isAllowedGroundingSource("https://www.salute.gov.it/example")).toBe(true);
    expect(isAllowedGroundingSource("https://www.gov.uk/foreign-travel-advice")).toBe(true);
    expect(isAllowedGroundingSource("https://www.gob.mx/example")).toBe(true);
  });

  test("keeps trusted citations and removes incidental untrusted citations", () => {
    expect(
      validateGroundingSources([
        "https://digital-strategy.ec.europa.eu/it/policies/112",
        "https://it.wikipedia.org/wiki/112",
        "https://www.salute.gov.it/example",
      ]),
    ).toEqual(["https://digital-strategy.ec.europa.eu/it/policies/112", "https://www.salute.gov.it/example"]);
  });

  test("supports an explicit operational allowlist", () => {
    process.env.AWS_BEDROCK_GROUNDING_ALLOWED_DOMAINS = "official-tourism.example";
    expect(isAllowedGroundingSource("https://visit.official-tourism.example/place")).toBe(true);
  });
});
