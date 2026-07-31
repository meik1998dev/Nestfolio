import { describe, it, expect } from "vitest";
import { portfolioNavLinks } from "./nav-links";
import type { Portfolio } from "@/lib/types";

const row = (id: string, name: string, parent: string | null): Portfolio => ({
  id,
  user_id: "u1",
  name,
  parent_id: parent,
  target_pct: null,
  created_at: "2026-01-01T00:00:00Z",
});

describe("portfolioNavLinks", () => {
  it("orders parents before children with correct depths and hrefs", () => {
    const links = portfolioNavLinks([
      row("stocks", "Stocks", null),
      row("gold", "Gold", null),
      row("eu", "EU", "stocks"),
      row("us", "US", "stocks"),
    ]);

    expect(links).toEqual([
      { href: "/portfolios/gold", label: "Gold", depth: 0 },
      { href: "/portfolios/stocks", label: "Stocks", depth: 0 },
      { href: "/portfolios/eu", label: "EU", depth: 1 },
      { href: "/portfolios/us", label: "US", depth: 1 },
    ]);
  });

  it("sorts siblings alphabetically at every level", () => {
    const links = portfolioNavLinks([
      row("b", "Beta", null),
      row("a", "Alpha", null),
    ]);
    expect(links.map((l) => l.label)).toEqual(["Alpha", "Beta"]);
  });

  it("returns [] for no portfolios", () => {
    expect(portfolioNavLinks([])).toEqual([]);
  });
});
