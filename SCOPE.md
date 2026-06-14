# SCOPE.md — Anomaly Log & Database Schema

This document details the 12 deliberate data problems identified in `expenses_export.csv` and the complete relational database schema implemented in SplitShare.

---

## 1. Anomaly Log — 12 Deliberate Data Problems

The CSV file `expenses_export.csv` contains 13 data rows (plus a header) and encodes exactly 12 deliberate data problems across those rows. Below is every anomaly found, the detection logic, and the resolution policy applied.

| # | Row | Anomaly Type | Raw CSV Evidence | Detection Logic | Resolution Policy |
|---|-----|-------------|-----------------|----------------|-------------------|
| **1** | 2 & 3 | **Duplicate Entry** | Row 2: `2026-02-05,Rent,12000,Aisha,...` Row 3: `02/05/2026,Rent,12000,Aisha,...` | Hash match of `normalizedDate + Description + Amount + PaidBy`. Row 3's date is first normalized from `MM/DD/YYYY` → `2026-02-05` before hashing, revealing an exact match with Row 2. | **Interactive approval (Meera's Request).** User chooses: *Skip Duplicate (Discard)* or *Keep Duplicate*. |
| **2** | 3 | **Inconsistent Date Format** | `02/05/2026` instead of `2026-02-05` | Regex `^\d{2}\/\d{2}\/\d{4}$` detects alternate format. Parsed as `MM/DD/YYYY` → `2026-02-05`. | **Auto-normalize** to `YYYY-MM-DD`. Resolution: `AUTO_CORRECT_DATE`. |
| **3** | 4 | **Negative Amount** | `Groceries,-1500,Rohan,...` | `parseFloat(amount) < 0` check. | **Prompt user.** Option to convert to absolute value (`AUTO_CORRECT_ABS`) or discard. |
| **4** | 5 | **Non-numeric Amount** | `Dinner,abc,Priya,...` | `isNaN(parseFloat(amount))` check. | **Discard row** automatically (`DISCARD_ROW`). Logged as un-importable. |
| **5** | 6 | **Empty / Missing SharedWith** | `Internet,1000,Meera,,INR,EQUAL` | `row.sharedWith` is blank. | **Prompt user** to add default split group (all active members) or discard. |
| **6** | 7 | **Inconsistent Currency (USD)** | `Trip Cab,50,Priya,...,USD,EQUAL` | `currency.toUpperCase() === 'USD'` check. | **Prompt user for exchange rate (Priya's Request).** Converted at user-supplied rate (default: 83 INR/USD). Resolution: `CONVERT_USD_INR`. |
| **7** | 8 | **Settlement Logged as Expense** | `"Aisha paid Meera 2000",2000,Aisha,Meera,INR,SETTLEMENT` | `splitType === 'SETTLEMENT'` OR description contains keyword `"paid"` AND only one member in `SharedWith`. | **Convert to Settlement record** (`CONVERT_TO_SETTLEMENT`). Stored in `Settlement` table, not `Expense`. |
| **8** | 10 | **Early Member Split (Sam)** | `Electricity Bill,4000,Rohan,Aisha;Rohan;Priya;Meera;Sam,...` on `2026-03-25` | `expenseDate < membership.joinedAt` — Sam joined April 15; this expense is March 25. | **Exclude Sam from split** (`EXCLUDE_MEMBER_SPLIT|Sam`). Remaining 4 members share equally. |
| **9** | 11 | **Late Member Split (Meera)** | `Groceries,3000,Aisha,Aisha;Rohan;Priya;Meera,...` on `2026-04-05` | `expenseDate > membership.leftAt` — Meera left March 31; this expense is April 5. | **Exclude Meera from split** (`EXCLUDE_MEMBER_SPLIT|Meera`). Remaining 3 members share equally. |
| **10** | 12 | **Trip Member Split Mismatch (Dev)** | `Trip Dinner (Late),150,Priya,Aisha;Rohan;Priya;Dev,...` on `2026-04-10` | `expenseDate > membership.leftAt` — Dev left March 15; this expense is April 10. | **Exclude Dev from split** (`EXCLUDE_MEMBER_SPLIT|Dev`). Remaining 3 members share equally. |
| **11** | 13 | **Name Whitespace / Inconsistency** | `"Aisha "` (trailing space in PaidBy column) | `rawName !== rawName.trim()` detects trailing/leading whitespace. | **Auto-trim** and normalize name (`AUTO_TRIM_NAME|Aisha`). Requires user acknowledgment. |
| **12** | 14 | **Split Sum Mismatch** | `Special Dinner,5000,Rohan,Aisha:50;Rohan:30;Priya:30,...,PERCENTAGE` | Parses percentage values after `:` separator; `50+30+30 = 110 ≠ 100`. | **User chooses:** *Split Equally* (`REDISTRIBUTE_EQUAL_PERCENTAGE`) or *Discard Row*. |

> **Note on Row 9 (USD Trip Dinner, Dev):** Row 9 also has `CURRENCY_USD` anomaly in addition to any membership constraints — Dev was active on March 12, so no temporal anomaly applies here. This is correctly detected as only a currency issue.

---

## 2. Database Schema

The database uses **Supabase PostgreSQL**, with models managed via **Prisma ORM v7**.

### `User`
Tracks individual user credentials and group relationships.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key, auto-generated |
| `name` | String | Display name |
| `email` | String | Unique login identifier |
| `passwordHash` | String | SHA-256 hash of password |

**Relations:** Has many `GroupMembership`, `Expense` (paid), `ExpenseSplit`, `Settlement` (sent/received).

---

### `Group`
Represents a shared living or expense space.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key |
| `name` | String | Group display name |
| `createdAt` | DateTime | Auto-set on creation |

**Relations:** Has many `GroupMembership`, `Expense`, `Settlement`.

---

### `GroupMembership`
Tracks **temporal** group membership — when a user joined and when (if ever) they left.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key |
| `groupId` | String (FK) | References `Group` |
| `userId` | String (FK) | References `User` |
| `joinedAt` | DateTime | Membership start date |
| `leftAt` | DateTime? | Membership end date (nullable = still active) |

**Unique constraint:** `(groupId, userId, joinedAt)` — supports re-joining.  
**Used for:** Temporal membership checks: `joinedAt ≤ expenseDate ≤ leftAt`.

---

### `Expense`
Records a shared bill paid by one member on behalf of the group.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key |
| `groupId` | String (FK) | References `Group` |
| `description` | String | Expense label |
| `amount` | Float | Original amount in source currency |
| `currency` | String | `"INR"` or `"USD"` |
| `exchangeRate` | Float | Rate used to convert to INR (default: 1.0) |
| `paidById` | String (FK) | References `User` |
| `date` | DateTime | Date of expense |
| `createdAt` | DateTime | Record creation timestamp |
| `splitType` | String | `"EQUAL"`, `"PERCENTAGE"`, or `"EXACT"` |

---

### `ExpenseSplit`
Specifies each member's individual share of an expense (in base INR).

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key |
| `expenseId` | String (FK) | References `Expense` |
| `userId` | String (FK) | References `User` |
| `amount` | Float | This user's share in INR |

**Unique constraint:** `(expenseId, userId)`.

---

### `Settlement`
Records a direct debt payment from one member to another.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key |
| `groupId` | String (FK) | References `Group` |
| `payerId` | String (FK) | Who paid (References `User`) |
| `payeeId` | String (FK) | Who received (References `User`) |
| `amount` | Float | Amount paid |
| `currency` | String | Currency of payment |
| `date` | DateTime | Date of settlement |

---

### `ImportLog`
Tracks each CSV ingestion attempt.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key |
| `fileName` | String | Original CSV filename |
| `importedAt` | DateTime | Ingestion timestamp |
| `status` | String | `"PENDING"`, `"COMPLETED"`, or `"FAILED"` |

---

### `Anomaly`
Logs every data problem detected during a CSV import, with resolution tracking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (UUID) | Primary Key |
| `importLogId` | String (FK) | References `ImportLog` |
| `rowNumber` | Int | CSV row number (1-indexed, with header = row 1) |
| `columnName` | String? | Affected column (e.g. `"Amount"`, `"Date"`) |
| `rawValue` | String? | The original problematic value |
| `errorType` | String | e.g. `"DUPLICATE"`, `"NEGATIVE_AMOUNT"`, `"TEMPORAL_MEMBERSHIP_PRE_JOIN_SPLIT"` |
| `description` | String | Human-readable explanation |
| `resolutionPolicy` | String? | Policy applied (e.g. `"AUTO_CORRECT_ABS\|1500"`) |
| `status` | String | `"PENDING"`, `"APPROVED"`, `"IGNORED"`, `"RESOLVED"` |
| `createdAt` | DateTime | Detection timestamp |

---

### Entity Relationship Diagram

```
User ──< GroupMembership >── Group
 │                              │
 ├──< Expense (paidBy) ────── Group
 │       │
 │       └──< ExpenseSplit >── User
 │
 ├──< Settlement (payer) ─── Group
 │       │
 │       └── Settlement (payee) ── User
 │
Group ──< ImportLog ──< Anomaly
```
