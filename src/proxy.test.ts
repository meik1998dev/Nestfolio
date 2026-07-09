import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("proxy matcher", () => {
  it("leaves the web app manifest publicly reachable", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/manifest.webmanifest")).toBe(false);
  });
});
