import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startV3Impersonation: vi.fn(),
  readMyDepartureStaff: vi.fn(),
}));

vi.mock("../../lib/platform/v3-identity-access", () => ({
  endV3Impersonation: vi.fn(),
  startV3AgencyTravelerImpersonation: vi.fn(),
  startV3Impersonation: mocks.startV3Impersonation,
}));

vi.mock("../../lib/platform/departure-operational-control", () => ({
  readMyDepartureStaff: mocks.readMyDepartureStaff,
}));

import { startImpersonation } from "../../lib/platform/impersonation";

const target = {
  id: "legacy-target",
  nativeId: "019aa0b1-2222-7777-8222-222222222222",
  name: "Utente collaudo",
  email: "collaudo@example.com",
  isSuperAdmin: false,
  isAgencyAdmin: false,
};

describe("startImpersonation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startV3Impersonation.mockResolvedValue(target);
    mocks.readMyDepartureStaff.mockResolvedValue([]);
  });

  it("indirizza il personale assegnato al pannello operatore", async () => {
    mocks.readMyDepartureStaff.mockResolvedValue([{ role: "accompagnatore" }]);

    await expect(
      startImpersonation({ actorId: "019aa0b1-1111-7777-8111-111111111111", targetId: target.nativeId }),
    ).resolves.toMatchObject({ redirectUrl: "/tour-leader" });
  });

  it("indirizza un viaggiatore senza assegnazioni alla sua esperienza", async () => {
    await expect(
      startImpersonation({ actorId: "019aa0b1-1111-7777-8111-111111111111", targetId: target.nativeId }),
    ).resolves.toMatchObject({ redirectUrl: "/viaggio" });
  });

  it("mantiene il pannello agenzia per responsabili e agenti", async () => {
    mocks.startV3Impersonation.mockResolvedValue({ ...target, isAgencyAdmin: true });

    await expect(
      startImpersonation({ actorId: "019aa0b1-1111-7777-8111-111111111111", targetId: target.nativeId }),
    ).resolves.toMatchObject({ redirectUrl: "/agenzia" });
    expect(mocks.readMyDepartureStaff).not.toHaveBeenCalled();
  });
});
