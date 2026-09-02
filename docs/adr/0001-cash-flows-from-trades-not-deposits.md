---
status: accepted
date: 2026-09-02
---

# Money "enters" the portfolio on the trade date, not the deposit date

To compute time-weighted and money-weighted returns, the app must know when money entered and left the portfolio. We decided: money enters on the day of a buy or delivery (the cost of that trade), and leaves on the day of a sell or send (the proceeds). USDT deposits into the wallet and idle cash are ignored.

## Example

You send 1,400 USDT to the wallet on 1 June and buy NVDA with it on 8 June. The app counts 1,400 entering on 8 June. The 7 idle days do not count.

## Why not deposits

- Most stocks arrived as deliveries, paid on Binance off-chain. There is no on-chain deposit for them, so a deposit-based rule would see no money entering at all.
- Manual trades typed into the app have no deposit either.
- The S&P 500 comparison already uses the trade date. One rule for both keeps the comparison fair.

## What we accept

- Idle cash never lowers the reported return. A separate "cash drag" metric can show that later without changing this rule.
- Selling one stock and buying another on the same day shows as money out and money in on that day. The daily calculation handles this correctly.

## Why this is recorded

Changing this rule changes every return number in the app. A future reader may expect deposits and "fix" it by mistake.
