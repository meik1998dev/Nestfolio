# Feature: BNB Wallet Sync & Pricing

**ID:** F4 · **Type:** Feature · **Epic:** E1
**Labels:** `feature` `priority-high` `value-high` `backend` `integration`
**Estimate:** M (20 pts)
**Blocked by:** F1, F2 · **Blocks:** F5, F6

## Description
Read-only sync of a public BNB-chain address via **Moralis** (behind a swappable
`WalletProvider`): BNB + BEP20 balances + transfer history. Synced tokens go to an
unassigned bucket for manual assignment (S3.2). Includes a `PriceProvider` that
values tokenized stocks by the **underlying equity price** (not the unreliable DEX
price) plus gold/PAXG/crypto, and resolves Ondo `…on` tokens to tickers.

## Enablers & Stories
- [ ] EN4.1 — Provider integration (Moralis)
- [ ] EN4.2 — Sync service + unassigned bucket
- [ ] EN4.3 — PriceProvider (stocks/gold/crypto, live+historical)
- [ ] EN4.4 — Tokenized-stock resolution (Ondo → ticker)
- [ ] S4.1 — Sync a BNB address
- [ ] T4.1 — Sync + graceful failure test

## Acceptance Criteria
- [ ] Valid address → balances + USD appear (stocks priced via equity feed); only public address stored.
- [ ] Tokenized stocks resolve to tickers and are NOT priced by their DEX price.
- [ ] Sync failure degrades gracefully (last-known + error).

## Definition of Done
- [ ] Stories + enablers done; integration test green.
