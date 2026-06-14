# SplitShare - Shared Expenses App

SplitShare is a full-stack Next.js web application built to manage shared roommate expenses, handle temporal group memberships, perform multi-currency conversions, minimize debt balances, and import spreadsheets containing imperfect records using an interactive anomaly-resolution pipeline.

This project is built as part of the Spreetail Software Engineer Intern Assignment.

## 🚀 Tech Stack
- **Framework:** Next.js (TypeScript, React, App Router, Server-side API endpoints)
- **Database ORM:** Prisma Client (v7.8.0)
- **Database:** Supabase PostgreSQL (utilizing the native driver adapter for modern WASM compilation)
- **Styling:** Tailwind CSS + Vanilla CSS (featuring a dark, responsive, glassmorphic layout)

## 📋 Features & Roommate Requirements Resolved
1. **Aisha (Debt Minimization):** Implements a simplified "who pays whom and how much" debt minimization algorithm (Graph-based ledger simplification) to output one final number per person.
2. **Rohan (Traceability):** Provides a transparent drilldown ledger showing every transaction item, date, and share that composes a roommate's current balance (no magic numbers).
3. **Priya (Multi-currency Support):** Detects USD transactions from the historical spreadsheet, flags them, and prompts for an exchange rate to convert amounts properly.
4. **Sam (Temporal Membership):** Respects group membership dates. Users are only charged for expenses occurred during their active membership window.
5. **Meera (Duplicate Approvals):** Implements an interactive review screen where duplicate rows are flagged and require manual approval before they are saved to the database.

## 🛠️ Installation & Setup

### 1. Clone & Install Dependencies
Navigate to the project folder and install dependencies:
```bash
cd splitshare
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root folder (`splitshare/.env`) and add your Supabase connection string:
```env
DATABASE_URL="postgresql://postgres.swppfqwanhomaiqygegs:2sHT%3Fdf%26k9Ndyu7@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
```
*(Note: The database password has been URL-encoded to escape special characters like `?` and `&`.)*

### 3. Run Database Migrations
Prisma 7 uses a central config hub `prisma.config.ts`. Apply migrations to establish the database schema on Supabase:
```bash
npx prisma migrate dev --name init
```

### 4. Seed the Database
Populate the database with the default flatmates (Aisha, Rohan, Priya, Meera, Dev, Sam) and their membership timeline:
```bash
node --env-file=.env prisma/seed.js
```

### 5. Verify Parser & Anomalies (CLI Test)
You can run a dry-run test of the parser against the mock CSV file `expenses_export.csv` containing the 12 deliberate data problems:
```bash
# In PowerShell:
$env:DATABASE_URL="postgresql://postgres.swppfqwanhomaiqygegs:2sHT%3Fdf%26k9Ndyu7@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"; npx tsx prisma/test-parser.ts
```

### 6. Start the Local Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

## 📁 Project Structure
- `prisma/schema.prisma` - DB Models (User, Group, Membership, Expense, Settlement, Anomaly logs).
- `prisma/seed.js` - Mock roommates & active periods configuration.
- `src/lib/prisma.ts` - Database client singleton.
- `src/lib/csv-parser.ts` - Automated anomaly detection and normalization engine.
- `src/app/` - Next.js page routes, layouts, and API handlers.
