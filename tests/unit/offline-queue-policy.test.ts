import { describe, expect, it } from "vitest";
import { offlineResponseAction, uuidV7 } from "../../lib/pwa/offline-queue";

describe("offline mutation policy", () => {
  it("considera il conflitto idempotente già completato", () => {
    expect(offlineResponseAction(409)).toBe("complete");
  });

  it("ritenta timeout, rate limit ed errori server", () => {
    expect([408, 429, 500, 503].map(offlineResponseAction)).toEqual(["retry", "retry", "retry", "retry"]);
  });

  it("scarta gli altri errori client e accetta le risposte riuscite", () => {
    expect(offlineResponseAction(422)).toBe("drop");
    expect(offlineResponseAction(201)).toBe("complete");
  });

  it("genera identificativi UUIDv7 validi", () => {
    expect(uuidV7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
