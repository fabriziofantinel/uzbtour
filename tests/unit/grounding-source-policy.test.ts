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
    expect(() => validateGroundingSources(["https://example-travel-blog.com/country"])).toThrow(
      "fonti non autorizzate",
    );
  });

  test("supports an explicit operational allowlist", () => {
    process.env.AWS_BEDROCK_GROUNDING_ALLOWED_DOMAINS = "official-tourism.example";
    expect(isAllowedGroundingSource("https://visit.official-tourism.example/place")).toBe(true);
  });
});
