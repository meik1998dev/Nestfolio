import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("Next.js page cache policy", () => {
  it("keeps dynamic and static page segments fresh for five minutes", () => {
    expect(nextConfig.experimental?.staleTimes).toEqual({
      dynamic: 300,
      static: 300,
    });
  });
});
