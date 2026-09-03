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
