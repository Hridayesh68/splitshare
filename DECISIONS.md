# DECISIONS.md — Decision Log

This document records the major design and engineering decisions made during the development of the SplitShare application, outlining the alternatives considered and the rationale behind each choice.

---

## 1. Tech Stack Selection
*   **Decisions:** Next.js (TypeScript, App Router) + Prisma + PostgreSQL (Supabase) + Tailwind CSS.
*   **Options Considered:**
    1.  *Option 1: Next.js + Prisma + PostgreSQL (Supabase) [Chosen]*
    2.  *Option 2: React (Vite) + Express.js + Sequelize + PostgreSQL*
    3.  *Option 3: Python (Django) Monolith*
*   **Rationale:** Next.js provides server-side rendering for speed, API endpoints inside the same repo (easy deployment), and TypeScript safety. Moving to Prisma 7 with native driver adapters (`@prisma/adapter-pg`) reduces application dependencies, improves build times, and compiles straight to WASM. Tailwind CSS was chosen for rapid, clean design implementation.

---

## 2. Modeling Temporal Memberships
*   **Decision:** Implement a join-table `GroupMembership` containing `joinedAt` and `leftAt` (nullable DateTime) columns.
*   **Rationale:** The flatmates' room layout has fluid membership (Meera leaves, Sam joins, Dev is temporary). A simple array of user IDs on the `Group` model is insufficient because it does not capture the date a user joined or left. Having explicit `joinedAt` and `leftAt` columns lets us perform date range checks:
    $$\text{joinedAt} \le \text{ExpenseDate} \le \text{leftAt}$$
    This answers Sam's requirement ("Why should March electricity affect my balance?"). If an expense date is March 15, Sam's membership (started April 15) is not active, so he is automatically excluded from the split.

---

## 3. Ingestion & Duplicate Handling Policy (Meera's Request)
*   **Decision:** Two-stage import pipeline (Stage 1: Validation & Staging; Stage 2: Resolution & Commit).
*   **Options Considered:**
    1.  *Silent Guess:* Importer makes assumptions and fixes anomalies silently (Failed answer per instructions).
    2.  *Crash on Error:* Aborts the entire upload on any anomaly.
    3.  *Staging Log with Interactive Resolution [Chosen]*: Stores raw CSV lines in a pending state, parses and creates `Anomaly` records in the database, and displays them on a frontend dashboard. The user explicitly selects a policy (e.g., "Ignore Duplicate", "Normalize Name", "Change Split") before rows are written to the `Expense` table.
*   **Rationale:** Meera explicitly requested: *"Clean up the duplicates — but I want to approve anything the app deletes or changes."* Staging anomalies in the DB allows full visibility and interactive approvals without blocking imports of other clean, valid rows.

---

## 4. Multi-currency Handling (Priya's Request)
*   **Decision:** Store currency and exchange rate explicitly on the `Expense` model, converting all USD amounts to a base currency (INR) for balance calculations.
*   **Rationale:** Priya noted that the spreadsheet treated USD as INR 1:1. Our schema stores `currency` ("INR" or "USD") and `exchangeRate` (float, e.g. 83.0) on the `Expense` row. During import:
    1.  The importer flags USD rows as anomalies.
    2.  The UI asks the user to confirm the conversion rate (e.g. 1 USD = 83 INR).
    3.  The backend stores the USD amount, saves the conversion rate, and writes the computed base amount (in INR) to the splits. This retains the original currency data for Rohan's traceability while ensuring the split calculation math is accurate.

---

## 5. Debt Minimization Algorithm (Aisha's Request)
*   **Decision:** Graph-based debt simplification algorithm.
*   **Rationale:** Aisha wants a simplified summary: "Who pays whom, how much, done." The classic Splitwise simplification algorithm computes the net balance of each user (Total Paid - Total Share). Users are split into Creditors (net balance > 0) and Debtors (net balance < 0). We iteratively pair the largest debtor with the largest creditor, reducing the number of total transactions from $O(N^2)$ to $O(N)$ and simplifying settlements.
