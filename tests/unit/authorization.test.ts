import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedActor: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/current-user", () => mocks);
vi.mock("../../lib/platform/v3-identity-access", () => ({ resolveV3UserAccess: vi.fn() }));
vi.mock("../../lib/platform/departure-operational-control", () => ({
  canOperateDeparture: vi.fn(),
  readDepartureStaffRole: vi.fn(),
}));

import { requireCurrentAgencyAdmin } from "../../lib/platform/authorization";

const agencyUser = {
  id: "legacy-agency-user",
  nativeId: "019aa0b1-1111-7777-8111-111111111111",
  isAgencyAdmin: true,
  isSuperAdmin: false,
};

describe("requireCurrentAgencyAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("usa l'identità corrente, inclusa quella impersonata", async () => {
    mocks.getCurrentUser.mockResolvedValue(agencyUser);

    await expect(requireCurrentAgencyAdmin()).resolves.toBe(agencyUser);
    expect(mocks.getAuthenticatedActor).not.toHaveBeenCalled();
  });

  it("nega il superuser non impersonato", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...agencyUser, isSuperAdmin: true });

    await expect(requireCurrentAgencyAdmin()).rejects.toMatchObject({
      status: 403,
    });
  });

  it("richiede una sessione autenticata", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(requireCurrentAgencyAdmin()).rejects.toMatchObject({
      status: 401,
    });
  });
});
