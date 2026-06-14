# DECISIONS.md — Decision Log

This document records every significant design and engineering decision made during the development of SplitShare, the options that were considered, and the rationale for each choice.

---

## 1. Tech Stack Selection

**Decision:** Next.js (TypeScript, App Router) + Prisma 7 + PostgreSQL (Supabase) + Tailwind CSS v4

**Options Considered:**

| Option | Stack | Trade-offs |
|--------|-------|-----------|
| **A (Chosen)** | Next.js + Prisma 7 + PostgreSQL (Supabase) | SSR + API Routes in one repo, type-safe ORM, WASM compiler, Vercel-native deployment |
| B | React (Vite) + Express.js + Sequelize + PostgreSQL | Separate frontend/backend repos, more boilerplate, no built-in SSR |
| C | Python (Django) Monolith | Strong ORM, but diverges from TypeScript ecosystem; heavier runtime |

**Rationale:** Next.js provides server-side rendering and co-located API endpoints — no CORS complexity, single deploy. Prisma 7's native WASM adapter (`@prisma/adapter-pg`) removes the Rust sidecar engine dependency and compiles faster. TypeScript end-to-end catches schema mismatches at compile time. Tailwind CSS v4 enables rapid, consistent UI development.

---

## 2. Modeling Temporal Memberships

**Decision:** A dedicated `GroupMembership` join-table with explicit `joinedAt` and `leftAt` (nullable) DateTime columns.

**Options Considered:**

| Option | Approach | Problem |
|--------|----------|---------|
| A | Store `userId[]` array directly on `Group` model | No date information — cannot answer "Was Sam a member on March 25?" |
| B | Boolean `isActive` flag on membership | Cannot reconstruct history — once a user leaves, past expenses become ambiguous |
| **C (Chosen)** | `GroupMembership` with `joinedAt` + `leftAt?` | Full temporal history; supports re-joining; enables precise date-range queries |

**Rationale:** The flatmates have fluid membership (Meera leaves March 31, Sam joins April 15, Dev joins temporarily for a trip March 1–15). The date-range check:

```
joinedAt ≤ expenseDate ≤ leftAt
```

resolves Sam's complaint ("Why should March electricity affect my balance?") and Meera's ("I left before April — don't charge me for April groceries") automatically during CSV import and manual expense creation.

---

## 3. Ingestion & Duplicate Handling Policy (Meera's Request)

**Decision:** Two-stage import pipeline — Stage 1 (Validate & Stage) → Stage 2 (Resolve & Commit).

**Options Considered:**

| Option | Approach | Problem |
|--------|----------|---------|
| A | Silent fixes — importer auto-corrects all anomalies | Violates Meera's requirement and the assignment's explicit rule: *"A silent guess is a failing answer"* |
| B | Abort on first error | One bad row blocks all clean rows from being imported |
| **C (Chosen)** | Stage anomalies in DB; surface interactive resolution wizard | Every anomaly is persisted with its row, error type, and suggested policy. User approves/changes each before commit. |

**Rationale:** Meera explicitly requested: *"Clean up the duplicates — but I want to approve anything the app deletes or changes."* Staging anomalies in the `Anomaly` table allows full audit visibility and interactive approvals via the frontend wizard, without blocking the import of other valid rows.

---

## 4. Multi-currency Handling (Priya's Request)

**Decision:** Store `currency` and `exchangeRate` explicitly on the `Expense` model; convert all amounts to INR for balance calculations.

**Options Considered:**

| Option | Approach | Problem |
|--------|----------|---------|
| A | Silently treat USD as INR 1:1 | Exactly what the CSV did — produces wrong balances (Priya's original complaint) |
| B | Store only INR amounts | Loses original currency data; Rohan cannot trace back to source transaction |
| **C (Chosen)** | Store both `amount` (original) + `exchangeRate`; compute base INR in splits | Retains traceability (Rohan's request), enables accurate calculations, user confirms rate |

**Rationale:** The `Expense` schema stores `amount` (original value in source currency) and `exchangeRate` (user-confirmed conversion rate). All `ExpenseSplit` amounts are stored in base INR (`amount × exchangeRate`). The UI shows both the original currency and the converted value for full traceability.

---

## 5. Debt Minimization Algorithm (Aisha's Request)

**Decision:** Graph-based debt simplification (Splitwise algorithm variant).

**Options Considered:**

| Option | Approach | Problem |
|--------|----------|---------|
| A | Show raw pairwise balances | N² transactions — 6 members could require up to 15 payments |
| B | Settle via a central "bank" | Artificial intermediary; not real-money flows |
| **C (Chosen)** | Net-balance simplification: group into creditors/debtors, greedily pair largest | O(N) transactions; mathematically optimal; matches Splitwise's approach |

**Rationale:** Aisha's requirement: *"Who pays whom, how much, done."* The algorithm:
1. Computes each user's net balance: `(Total Paid − Total Owed) + (Settlements Sent − Settlements Received)`
2. Splits users into **Creditors** (balance > 0) and **Debtors** (balance < 0)
3. Greedily pairs the largest debtor with the largest creditor, recording a payment of `min(|debtor|, creditor)`
4. Advances the pointer of whichever side is fully settled

This reduces 6 members' balances to at most 5 transactions.

---

## 6. Authentication Strategy

**Decision:** Native JWT authentication stored in an `HttpOnly` cookie — no third-party auth library.

**Options Considered:**

| Option | Approach | Trade-offs |
|--------|----------|-----------|
| A | NextAuth.js | Overkill for 6 seeded users; adds external OAuth complexity not needed here |
| B | Session stored in `localStorage` | XSS-vulnerable; not suitable for production patterns |
| **C (Chosen)** | Signed JWT in `HttpOnly` cookie via native `jose` / `crypto` | Secure by default, no JS access, simple to implement, no external auth dependency |

**Rationale:** The assignment focuses on expense logic, not auth complexity. A lightweight native JWT approach demonstrates understanding of auth principles without adding irrelevant external dependencies.

---

## 7. Split Sum Rounding Strategy

**Decision:** Running-total approach — the last user in a split absorbs the remaining amount.

**Options Considered:**

| Option | Approach | Problem |
|--------|----------|---------|
| A | `amount / n` for all users | Rounding drift: e.g. `5000 / 3 = 1666.67` → three shares sum to `4999.99` not `5000.00` |
| B | Round up for all, adjust later | Produces overpayment records |
| **C (Chosen)** | Last user gets `totalAmount − runningTotal` | Guarantees sum of splits always equals exact expense amount, no ledger imbalance |

**Rationale:** Financial ledgers must balance exactly. A ₹0.01 rounding error across many transactions compounding over time produces incorrect net balances and undermines Rohan's traceability requirement.

---

## 8. Percentage Split Name Parsing in CSV

**Decision:** Parse member names from `Name:Percentage` colon-separated format before membership lookup.

**Context:** The CSV column `SharedWith` uses semicolons to separate members and colons to denote percentage shares:
```
Aisha:50;Rohan:30;Priya:30
```

**Problem:** The original parser checked `"Aisha:50"` as a username — correctly flagging it as `UNKNOWN_USER_SPLIT` since no user is named `"Aisha:50"`.

**Fix:** Split each entry on `:` before lookup:
```typescript
const memberName = member.split(':')[0].trim();
```

This correctly identifies `Aisha`, `Rohan`, and `Priya` as valid group members, and only flags the `SPLIT_SHARE_MISMATCH` anomaly (110% ≠ 100%) — which is the actual data problem.

---

## 9. Transaction Timeout Handling in Resolve API

**Decision:** Extend Prisma interactive transaction timeout to 30 seconds and batch anomaly status updates.

**Problem:** The `/api/import/resolve` route executed one `tx.anomaly.update()` call per anomaly inside a single Prisma interactive transaction. For 13 anomalies, each requiring a DB round-trip to Supabase (with network latency), the default 5-second transaction timeout (`P2028`) was exceeded.

**Options Considered:**

| Option | Approach | Trade-off |
|--------|----------|-----------|
| A | Increase timeout only | Still O(N) round-trips; fragile under load |
| **B (Chosen)** | Increase timeout to 30s + batch `updateMany` grouped by status | Reduces round-trips from N to ≤ 3 (one per distinct status value); robust |
| C | Move anomaly updates outside transaction | Risks partial failure — expenses committed but anomaly statuses not updated |

**Rationale:** Option B keeps atomicity (all-or-nothing) while dramatically reducing the number of sequential DB round-trips inside the transaction window.
