import { describe, expect, it } from "vitest";
import { pushConfig } from "@/lib/push";

// What the server sends to push services as its contact. Apple's push service (every iPhone)
// rejects anything that is not an https: URL or a mailto: address, and rejects localhost.

const keys = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };

describe("pushConfig", () => {
  it("uses VAPID_SUBJECT when it is set", () => {
    expect(pushConfig({ ...keys, VAPID_SUBJECT: "https://nont.example" })).toEqual({
      subject: "https://nont.example",
      problems: [],
    });
  });

  it("falls back to the site's own address on Vercel, so a forgotten VAPID_SUBJECT still works", () => {
    expect(pushConfig({ ...keys, VERCEL_PROJECT_PRODUCTION_URL: "nont-water-abc.vercel.app" }).subject).toBe(
      "https://nont-water-abc.vercel.app",
    );
    expect(pushConfig({ ...keys, SITE_URL: "https://water.example/" }).subject).toBe("https://water.example");
  });

  it("reports a subject Apple would reject", () => {
    expect(pushConfig({ ...keys, VAPID_SUBJECT: "nont-water.vercel.app" }).problems).toEqual(["subject-format"]);
    expect(pushConfig({ ...keys, VAPID_SUBJECT: "http://nont.example" }).problems).toEqual(["subject-format"]);
    expect(pushConfig({ ...keys, VAPID_SUBJECT: "https://localhost:3000" }).problems).toEqual(["subject-localhost"]);
    expect(pushConfig({ ...keys, VAPID_SUBJECT: "mailto:dev@nont-water.test" }).problems).toEqual([]);
  });

  it("reports missing keys and a missing subject", () => {
    expect(pushConfig({}).problems).toEqual(["public-key", "private-key", "subject-missing"]);
  });
});
