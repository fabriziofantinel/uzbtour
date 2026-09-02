import { describe, expect, it } from "vitest";
import {
  accessibleBrandBackground,
  accessibleBrandColor,
  agencyLogoSource,
  validBrandColor,
} from "../../lib/platform/branding-ui";

describe("agency branding", () => {
  it("normalizza colori invalidi e rende accessibili colori estremi", () => {
    expect(validBrandColor("red")).toBe("#247A6B");
    expect(accessibleBrandColor("#ffffff")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(accessibleBrandBackground("#000000")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("accetta soltanto logo R2 appartenenti all'agenzia richiesta", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const file = "22222222-2222-4222-8222-222222222222.png";
    expect(agencyLogoSource(`r2://agencies/${id}/branding/${file}`, id)).toBe(`/api/agency-logo/${id}/${file}`);
    expect(agencyLogoSource(`r2://agencies/other/branding/${file}`, id)).toBe("");
  });
});
