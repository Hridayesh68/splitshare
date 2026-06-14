# SCOPE.md — Anomaly Log & Database Schema

This document details the anomalies identified in `expenses_export.csv` and details the relational database schema implemented in SplitShare.

---

## 1. Anomaly Log (12 Deliberate Data Problems)

We identified 12 deliberate data problems in the spreadsheet export. Here is how the import engine detects and handles each of them:

| # | Anomaly Type | Description / Example | Detection Policy | Handling & Resolution Policy |
|---|---|---|---|---|
| **1** | **Duplicate Entries** | Same transaction (Rent) logged twice on Feb 5 | Hash match of `Date + Description + Amount + PaidBy` | Flag for manual approval. User chooses to keep one or both (Meera's Request). |
| **2** | **Inconsistent Date Format** | `02/05/2026` vs `2026-02-05` | Regex validation against `YYYY-MM-DD` | Parse alternate format (`DD/MM/YYYY`) and auto-normalize. |
| **3** | **Negative Amount** | Groceries logged as `-1500` | Checks if float `< 0` | Prompts user. Option to convert to absolute value (treat as positive) or discard. |
| **4** | **Non-numeric Amount** | Dinner amount logged as `abc` | Checks if float parsing fails (`isNaN`) | Discard row; log as un-importable error. |
| **5** | **Empty / Missing Fields** | Internet expense with empty `SharedWith` column | Checks if required columns are blank | Prompt to add default split group or discard. |
| **6** | **Inconsistent Currency** | Trip Cab logged as `50` with currency `USD` | Checks if currency code equals `"USD"` | Convert USD amount to INR using user-inputted exchange rate (Priya's Request). |
| **7** | **Settlement as Expense** | "Aisha paid Meera 2000" logged as a shared expense | Identifies split type `SETTLEMENT` or keyword text | Converts row to a direct `Settlement` record instead of creating an `Expense` with splits. |
| **8** | **Early Member split** | Sam charged for March electricity (he joined April 15) | Date comparison: `ExpenseDate < User.joinedAt` | Exclude Sam from the split, distributing his share among other active members (Sam's Request). |
| **9** | **Late Member split** | Meera charged for April groceries (she left March 31) | Date comparison: `ExpenseDate > User.leftAt` | Exclude Meera from the split, re-adjusting shares among remaining members (Meera's Request). |
| **10** | **Trip Member split mismatch** | Dev charged for April dinner (trip ended March 15) | Date comparison: `ExpenseDate > User.leftAt` | Exclude Dev from split; adjust shares of active members. |
| **11** | **Name Whitespace / Inconsistency** | `"Aisha "` has a trailing space | String length comparison: `rawName !== rawName.trim()` | Auto-trim whitespace and normalize name to match database records. |
| **12** | **Split Sum Mismatch** | Percentages in a split sum to 110% instead of 100% | Calculates sum of shares in `SharedWith` | Flags mismatch. Auto-redistribute equally or prompt user to edit shares manually. |

---

## 2. Database Schema

The database utilizes **Supabase PostgreSQL**. Models are managed via Prisma:

### `User`
Tracks individual user credentials and relationships:
- `id` (String, UUID, PK)
- `name` (String)
- `email` (String, Unique)
- `passwordHash` (String)

### `Group`
Represents shared spaces:
- `id` (String, UUID, PK)
- `name` (String)
- `createdAt` (DateTime)

### `GroupMembership`
Tracks temporal membership (joining and leaving):
- `id` (String, UUID, PK)
- `groupId` (String, FK)
- `userId` (String, FK)
- `joinedAt` (DateTime)
- `leftAt` (DateTime, Nullable)

### `Expense`
Tracks transactional shared bills:
- `id` (String, UUID, PK)
- `groupId` (String, FK)
- `description` (String)
- `amount` (Float, base INR)
- `currency` (String, "INR" or "USD")
- `exchangeRate` (Float)
- `paidById` (String, FK)
- `date` (DateTime)
- `createdAt` (DateTime)
- `splitType` (String, "EQUAL", "PERCENTAGE", etc.)

### `ExpenseSplit`
Specifies individual shares:
- `id` (String, UUID, PK)
- `expenseId` (String, FK)
- `userId` (String, FK)
- `amount` (Float)

### `Settlement`
Records direct debt payments:
- `id` (String, UUID, PK)
- `groupId` (String, FK)
- `payerId` (String, FK)
- `payeeId` (String, FK)
- `amount` (Float)
- `currency` (String)
- `date` (DateTime)

### `ImportLog` & `Anomaly`
Logs CSV ingestions and tracks unresolved anomalies:
- `ImportLog` (`id`, `fileName`, `importedAt`, `status`)
- `Anomaly` (`id`, `importLogId` (FK), `rowNumber`, `columnName`, `rawValue`, `errorType`, `description`, `resolutionPolicy`, `status`)
