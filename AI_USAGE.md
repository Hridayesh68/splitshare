# AI_USAGE.md — AI Collaboration Log

This document details the AI tools used during development of SplitShare, key prompts submitted, and **five concrete cases** where the AI produced incorrect or incomplete output — how each was caught and what was corrected.

---

## 1. AI Tools Used

| Tool | Role |
|------|------|
| **Antigravity (Google DeepMind)** | Primary pair-programming assistant — scaffolding, debugging, code generation, refactoring |
| **Gemini 3.5 Flash (High)** | Model used for most of the session |
| **Claude Sonnet 4.6 (Thinking)** | Model used for final documentation and importer fixes |

---

## 2. Key Prompts

The following were the most impactful prompts during development:

1. *"Explain the objective of this assignment and create an implementation plan using the tech stack best suited for this. Show me multiple options."*
2. *"Proceed with Next.js + Prisma + Supabase. Create the project scaffold, documentation, and README. Name it SplitShare."*
3. *"Implement the CSV anomaly detection engine in csv-parser.ts. It must detect all 12 data problems listed in SCOPE.md, and it must NOT silently fix anything — every anomaly must be logged for user review."*
4. *"Build a glassmorphic dark-mode UI with an interactive anomaly wizard. Users must be able to choose a resolution action (discard, convert, exclude, keep) for each anomaly card before committing."*
5. *"Make changes to the project necessarily to make the output of the importer match the requirements of the CSV columns and the assignment task."*
6. *"The resolve API is timing out. Fix it without losing atomicity."*

---

## 3. Concrete Cases Where the AI Was Wrong

### Case 1: Prisma 7 Schema — `url` Property Removed

**What the AI generated:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Why it was wrong:** Prisma 7 introduced a breaking change that removes `url` from `schema.prisma`. Database connection is now managed exclusively through `prisma.config.ts`. The `url` field causes a hard compile error.

**How it was caught:** Running `npx prisma migrate dev --name init` threw:
```
Error code: P1012
The datasource property 'url' is no longer supported in schema files.
```

**What was changed:** The `url` line was removed from `schema.prisma`. The connection string is now read by `prisma.config.ts` from the `DATABASE_URL` environment variable automatically.

---

### Case 2: Prisma 7 Client — WASM Adapter Not Configured

**What the AI generated:**
```typescript
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
```

**Why it was wrong:** Prisma 7 deprecates the Rust-based sidecar query engine. In Node.js without an explicit adapter, it throws a constructor validation error.

**How it was caught:** Running `node --env-file=.env prisma/seed.js` crashed:
```
PrismaClientConstructorValidationError:
Using engine type "client" requires either "adapter" or "accelerateUrl"
```

**What was changed:** Installed `@prisma/adapter-pg` and `pg`. The client is now instantiated with the native adapter:
```typescript
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
```

---

### Case 3: Silent Whitespace Trimming Violated Meera's Requirement

**What the AI generated:** The `parseCSV` function automatically called `.trim()` on all cell values:
```typescript
rowData[header] = values[index]?.trim() ?? '';
```

**Why it was wrong:** This silently corrected `"Aisha "` (trailing space in Row 13) to `"Aisha"` without logging any anomaly. This directly violated:
- Meera's requirement: *"I want to approve anything the app deletes or changes."*
- The assignment's explicit rule: *"A silent guess is a failing answer."*

**How it was caught:** During the CLI test with `npx tsx prisma/test-parser.ts`, Row 13's payer name anomaly was completely absent from the output. Comparing the raw CSV (`"Aisha "`) with the parsed result confirmed the silent fix.

**What was changed:** `parseCSV` was refactored to return **raw, untrimmed** strings. The `validateCSVRows` function was updated to explicitly detect whitespace with `rawName !== rawName.trim()` and log it as `INCONSISTENT_NAME_WHITESPACE` for user approval.

---

### Case 4: Duplicate Detection Used Raw Date String (Not Normalized)

**What the AI generated:**
```typescript
const rowHash = `${row.date}|${row.description.trim().toLowerCase()}|${amountVal}|${row.paidBy.trim().toLowerCase()}`;
```

**Why it was wrong:** Row 2's date is `"2026-02-05"` and Row 3's date is `"02/05/2026"`. Although both represent February 5, 2026, their raw string representations differ — so the hash never matched and the duplicate was **never detected**.

**How it was caught:** Running the parser test showed 16 anomalies instead of 13. Row 3 appeared with `INCONSISTENT_DATE_FORMAT` but **no** `DUPLICATE` anomaly, even though Rows 2 and 3 are clearly the same Rent transaction.

**What was changed:** The normalized date string (computed after date parsing) is now used in the hash:
```typescript
const rowHash = `${normalizedDateStr}|${row.description.trim().toLowerCase()}|${amountVal}|${payerNameClean}`;
```
This ensures `"2026-02-05"` and `"02/05/2026"` both normalize to `"2026-02-05"` before hashing, correctly triggering the duplicate detection.

---

### Case 5: Percentage Split Members Flagged as Unknown Users

**What the AI generated:**
```typescript
for (const member of rawSharedMembers) {
  const nMember = member.toLowerCase(); // e.g. "aisha:50"
  if (!memberNames.includes(nMember)) { // fails — "aisha:50" ≠ "aisha"
    anomalies.push({ errorType: "UNKNOWN_USER_SPLIT", ... });
  }
}
```

**Why it was wrong:** The CSV format for percentage splits is `Aisha:50;Rohan:30;Priya:30`. The parser compared the full token `"aisha:50"` against registered usernames like `"aisha"` — they never matched. This caused three false `UNKNOWN_USER_SPLIT` anomalies for Row 14, masking the actual data problem (the percentages summing to 110%).

**How it was caught:** The parser test showed 16 anomalies instead of 13. Row 14 had three `UNKNOWN_USER_SPLIT` entries for `"Aisha:50"`, `"Rohan:30"`, `"Priya:30"` — which are all valid members. The real anomaly (`SPLIT_SHARE_MISMATCH` for 110%) was present but buried beneath the false positives.

**What was changed:** Each member token is split on `:` before lookup:
```typescript
const parts = member.split(':');
const memberName = parts[0].trim();   // "Aisha", "Rohan", "Priya"
const nMember = memberName.toLowerCase();
```

After this fix, all three members are correctly identified as valid group members, and only the `SPLIT_SHARE_MISMATCH` anomaly is raised — which is the correct and intended data problem for Row 14.

---

## 4. Summary

| Case | Error Type | Detection Method | Impact |
|------|-----------|-----------------|--------|
| 1 | Prisma 7 schema `url` removed | CLI error on `prisma migrate dev` | Hard blocker — migration failed |
| 2 | Prisma 7 WASM adapter required | Runtime crash in seed script | Hard blocker — DB seeding failed |
| 3 | Silent `.trim()` on CSV cells | Missing anomaly in parser test output | Violated Meera's requirement silently |
| 4 | Raw date used in duplicate hash | Duplicate not detected in parser test | Core feature failure — Row 3 duplicate missed |
| 5 | Colon-separated percentage tokens not parsed | False `UNKNOWN_USER_SPLIT` anomalies | 3 wrong anomalies; real anomaly obscured |
