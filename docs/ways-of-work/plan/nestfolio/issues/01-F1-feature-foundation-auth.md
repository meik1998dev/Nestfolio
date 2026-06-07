# Feature: Platform Foundation & Auth

**ID:** F1 · **Type:** Feature · **Epic:** E1
**Labels:** `feature` `priority-critical` `value-high` `infrastructure`
**Estimate:** M (13 pts)
**Blocked by:** none · **Blocks:** F2, F3, F4, F5

## Description
Stand up the app skeleton: Next.js App Router (backend in API routes), Supabase
Postgres + Auth with Row-Level Security, and Google OAuth sign-in. This unblocks
every other feature.

## Enablers & Stories
- [ ] EN1.1 — Next.js + Vercel scaffold
- [ ] EN1.2 — Supabase schema + RLS
- [ ] EN1.3 — Google OAuth
- [ ] S1.1 — Sign in with Google
- [ ] T1.1 — Auth + RLS isolation test

## Acceptance Criteria
- [ ] App deploys to Vercel; envs wired to Supabase.
- [ ] All core tables exist with RLS scoping rows to the owner.
- [ ] Google sign-in works end-to-end.

## Definition of Done
- [ ] Stories + enablers complete.
- [ ] Auth-isolation E2E passes.
