import { describe, it, expect } from "vitest";
import {
  tokenToTicker,
  resolveToken,
  isTokenizedStock,
  isStablecoin,
  isFiat,
  isCashLike,
} from "./ticker";

describe("isTokenizedStock", () => {
  it("detects Ondo …on tokens", () => {
    expect(isTokenizedStock("NVDAon")).toBe(true);
    expect(isTokenizedStock("GOOGLon")).toBe(true);
    expect(isTokenizedStock("METAon")).toBe(true);
  });

  it("rejects non-tokenized symbols", () => {
    expect(isTokenizedStock("USDT")).toBe(false);
    expect(isTokenizedStock("BNB")).toBe(false);
    expect(isTokenizedStock("PAXG")).toBe(false);
  });
});

describe("tokenToTicker", () => {
  it("strips the trailing on", () => {
    expect(tokenToTicker("NVDAon")).toBe("NVDA");
    expect(tokenToTicker("GOOGLon")).toBe("GOOGL");
    expect(tokenToTicker("NVOon")).toBe("NVO");
  });

  it("returns null for non-stock tokens", () => {
    expect(tokenToTicker("USDT")).toBeNull();
    expect(tokenToTicker("BNB")).toBeNull();
  });
});

describe("isStablecoin", () => {
  it("recognizes the cash-equivalents", () => {
    for (const s of ["USDT", "USDC", "BUSD", "FDUSD"]) {
      expect(isStablecoin(s)).toBe(true);
    }
    expect(isStablecoin("NVDAon")).toBe(false);
  });
});

describe("isFiat / isCashLike", () => {
  it("treats plain fiat (USD / CASH) as cash-like, not a stablecoin", () => {
    expect(isFiat("USD")).toBe(true);
    expect(isFiat("cash")).toBe(true);
    expect(isFiat("USD CASH")).toBe(true);
    expect(isStablecoin("USD")).toBe(false); // USD is fiat, not a stablecoin
    expect(isCashLike("USD")).toBe(true);
    expect(isCashLike("USDT")).toBe(true); // stablecoins are cash-like too
    expect(isCashLike("BNB")).toBe(false);
  });
});

describe("resolveToken", () => {
  it("resolves plain fiat (USD) to cash at $1 with no ticker", () => {
    const r = resolveToken("USD");
    expect(r.kind).toBe("stablecoin"); // the shared cash-like bucket
    expect(r.ticker).toBeNull();
  });

  it("resolves tokenized stocks to the equity ticker, never the DEX price", () => {
    const r = resolveToken("NVDAon");
    expect(r.kind).toBe("stock");
    expect(r.ticker).toBe("NVDA");
    expect(r.issuer).toBe("Ondo Global Markets");
  });

  it("resolves stablecoins to cash with no ticker", () => {
    const r = resolveToken("USDT");
    expect(r.kind).toBe("stablecoin");
    expect(r.ticker).toBeNull();
  });

  it("resolves crypto to a Yahoo pair", () => {
    expect(resolveToken("BNB").ticker).toBe("BNB-USD");
    expect(resolveToken("BTCB").ticker).toBe("BTC-USD");
    expect(resolveToken("SOL").ticker).toBe("SOL-USD");
  });

  it("treats PAXG as gold via its deep-liquidity pair", () => {
    const r = resolveToken("PAXG");
    expect(r.kind).toBe("gold");
    expect(r.ticker).toBe("PAXG-USD");
  });

  it("resolves Binance bStocks to the equity ticker", () => {
    const r = resolveToken("MUB");
    expect(r.kind).toBe("stock");
    expect(r.ticker).toBe("MU");
    expect(r.displayName).toBe("Micron Technology");
    expect(r.issuer).toBe("Binance bStocks");
    expect(resolveToken("TSLAB").ticker).toBe("TSLA");
    expect(resolveToken("SMHB").ticker).toBe("SMH");
  });

  it("aliases Moralis's stale M2B metadata to Micron", () => {
    const r = resolveToken("M2B");
    expect(r.kind).toBe("stock");
    expect(r.ticker).toBe("MU");
  });

  it("aliases Moralis's stale SM7B metadata to SMH", () => {
    const r = resolveToken("SM7B");
    expect(r.kind).toBe("stock");
    expect(r.ticker).toBe("SMH");
  });

  it("keeps BTCB as crypto despite the B suffix", () => {
    expect(resolveToken("BTCB").kind).toBe("crypto");
  });

  it("flags unknown tokens rather than silently mispricing", () => {
    const r = resolveToken("SCAMTOKEN");
    expect(r.kind).toBe("unknown");
    expect(r.ticker).toBeNull();
  });
});
