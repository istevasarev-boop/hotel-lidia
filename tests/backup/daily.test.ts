import { describe, expect, it } from "vitest";
import { shouldCreateDailyBackup } from "@/lib/firebase/backups";

describe("daily backup scheduling", () => {
  const now = new Date("2026-05-21T12:00:00.000Z");

  it("creates a daily backup when none exists", () => {
    expect(shouldCreateDailyBackup([], now)).toBe(true);
  });

  it("skips backup before 24 hours have passed", () => {
    expect(
      shouldCreateDailyBackup([
        { type: "daily", timestamp: "2026-05-20T13:00:00.000Z" }
      ], now)
    ).toBe(false);
  });

  it("creates backup after 24 hours have passed", () => {
    expect(
      shouldCreateDailyBackup([
        { type: "daily", timestamp: "2026-05-20T12:00:00.000Z" }
      ], now)
    ).toBe(true);
  });

  it("ignores non-daily backups", () => {
    expect(
      shouldCreateDailyBackup([
        { type: "manual", timestamp: "2026-05-21T11:59:00.000Z" }
      ], now)
    ).toBe(true);
  });
});
