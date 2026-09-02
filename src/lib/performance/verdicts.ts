export type VerdictKind = "return" | "market-gap" | "volatility" | "drawdown" | "var";

interface VerdictBand {
  min: number;
  label: string;
}

export const VERDICT_BANDS: Record<VerdictKind, readonly VerdictBand[]> = {
  return: [
    { min: 0.1, label: "Strong" },
    { min: 0, label: "Positive" },
    { min: Number.NEGATIVE_INFINITY, label: "Weak" },
  ],
  "market-gap": [
    { min: 0.02, label: "Beat market" },
    { min: -0.02, label: "Close" },
    { min: Number.NEGATIVE_INFINITY, label: "Behind" },
  ],
  volatility: [
    { min: 0.2, label: "High" },
    { min: 0.1, label: "Moderate" },
    { min: Number.NEGATIVE_INFINITY, label: "Low" },
  ],
  drawdown: [
    { min: -0.1, label: "Low" },
    { min: -0.25, label: "Moderate" },
    { min: Number.NEGATIVE_INFINITY, label: "High" },
  ],
  var: [
    { min: -0.01, label: "Low" },
    { min: -0.025, label: "Moderate" },
    { min: Number.NEGATIVE_INFINITY, label: "High" },
  ],
};

export function verdictFor(kind: VerdictKind, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Not ready";
  return VERDICT_BANDS[kind].find((band) => value >= band.min)!.label;
}

export function verdictBandText(kind: VerdictKind): string {
  if (kind === "return") return "Strong: 10% or more. Positive: 0% to 10%. Weak: below 0%.";
  if (kind === "market-gap") return "Beat market: 2% ahead. Close: within 2%. Behind: more than 2% behind.";
  if (kind === "volatility") return "Low: below 10%. Moderate: 10% to 20%. High: 20% or more.";
  if (kind === "drawdown") return "Low: under 10%. Moderate: 10% to 25%. High: over 25%.";
  return "Low: under 1%. Moderate: 1% to 2.5%. High: over 2.5%.";
}
