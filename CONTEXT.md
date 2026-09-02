# Nestfolio

A personal portfolio tracker: a trade ledger (manual + synced wallet) valued at real stock prices, with profit, allocation, and performance views.

## Language

### Ledger

**Holding**:
A quantity of one asset the user currently owns, optionally assigned to a Portfolio.
_Avoid_: position (in UI copy), balance

**Trade**:
One ledger row: a buy, sell, delivery, or send of an asset on a date. Manual or wallet-sourced.
_Avoid_: transaction (reserved for the manual-entry page), event

**Delivery**:
A wallet trade where shares arrived on-chain with no cash leg; it was paid off-chain. Priced at the historical stock price on that day.

**Send**:
A wallet trade where shares left on-chain with no cash leg. The mirror of a Delivery.

**Deposit**:
Stablecoin cash arriving in the wallet. Cash, not a trade; never enters the position ledger.

### Portfolio structure

**Portfolio**:
A named node in the user's tree, holding Holdings and child Portfolios. A Portfolio always means the node plus everything nested under it.
_Avoid_: sub-portfolio, subtree, whole portfolio

### Profit

**Realized P&L**:
Locked-in gain or loss from disposals, under average cost.

**Unrealized P&L**:
Paper gain or loss on what is still held, at the live price.

**Invested**:
Net cost of what is still held. Excludes P&L.
_Avoid_: cost basis (in UI copy), capital

### Performance

**External cash flow**:
Money entering or leaving the measured universe: acquisition cost on a buy or delivery (in), proceeds on a sell or send (out). Deposits and idle cash are not cash flows.
_Avoid_: deposit, contribution

**Time-weighted return**:
Growth of one dollar held in the Portfolio over the window, with the effect of External cash flows removed. Measures the picks, not the timing.
_Avoid_: TWRR (in UI copy), portfolio return

**Money-weighted return**:
The rate that makes all External cash flows plus today's value net to zero. Measures the user's actual result, including timing. The UI shows the rate over the selected window; the per-year figure appears only once the window is a year or longer.
_Avoid_: IRR, XIRR, MWRR (in UI copy)

**Return on cost**:
Total P&L divided by Invested. The simple figure shown today.

**Benchmark**:
The market index the Portfolio is compared against. One index for every scope.

**Risk-free rate**:
The yield of the 13-week US Treasury bill, used as the "no risk" baseline in ratios.

**Max drawdown**:
The largest fall from a peak to a later trough in the Time-weighted growth line within the window.
_Avoid_: worst loss, dip (in code)

**Closed trade**:
One sell or send event together with its realized P&L. Partial sells are separate Closed trades.
_Avoid_: round trip

**Attribution**:
Each Holding's share of the scope's total P&L, in dollars and as a percentage. May exceed 100 percent.

**Readiness**:
Whether a metric has enough history to be shown: ready, low confidence, or waiting for data.

**Verdict**:
The plain-language band a metric falls in, such as Good, OK, Weak, or Low, Moderate, High.
