# SplitShare — Shared Expenses Manager

SplitShare is a full-stack Next.js web application built to manage shared roommate expenses, handle temporal group memberships, perform multi-currency conversions, minimize debt balances, and import spreadsheets containing imperfect records using an interactive anomaly-resolution pipeline.

This project is built as part of the **Spreetail Software Engineer Intern Assignment**.

---

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (TypeScript, React, App Router, Server-side API endpoints) |
| **Database ORM** | Prisma Client v7.8.0 (WASM compiler with native adapter) |
| **Database** | Supabase PostgreSQL (via `@prisma/adapter-pg` native driver) |
| **Styling** | Tailwind CSS v4 + Vanilla CSS (dark glassmorphic design) |
| **Auth** | Native JWT (no external auth library) |

---

## 📋 Roommate Requirements Implemented

| Roommate | Requirement | Implementation |
|----------|------------|----------------|
| **Aisha** | Debt Minimization | Graph-based ledger simplification: net balances → creditor/debtor pairs → O(N) transactions |
| **Rohan** | Traceability | Ledger breakdown per user showing every transaction, date, and share amount |
| **Priya** | Multi-currency Support | Detects USD amounts, flags them, prompts for exchange rate, stores original + converted |
| **Sam** | Temporal Membership | `joinedAt`/`leftAt` date window checks exclude members from expenses outside their active period |
| **Meera** | Duplicate Approvals | Two-stage staging pipeline — every anomaly requires user approval before DB commit |

---

## 🛠️ Installation & Setup

### Prerequisites
- Node.js v20+
- npm v10+
- A Supabase PostgreSQL database (or any PostgreSQL instance)

### 1. Clone & Install Dependencies

```bash
cd splitshare
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root (`splitshare/.env`):

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<database>"
```

> **Note:** URL-encode any special characters in the password (e.g. `?` → `%3F`, `&` → `%26`).

### 3. Run Database Migrations

Prisma 7 uses a central config file `prisma.config.ts`. Apply the schema to your database:

```bash
npx prisma migrate dev --name init
```

### 4. Generate Prisma Client

```bash
npx prisma generate
```

### 5. Seed the Database

Populate the default flatmates (Aisha, Rohan, Priya, Meera, Dev, Sam) and their membership timeline:

```bash
node --env-file=.env prisma/seed.js
```

Seed credentials (email format: `name@splitshare.com`, password: `name`):
- aisha / aisha
- rohan / rohan
- priya / priya
- meera / meera
- dev / dev
- sam / sam

### 6. Verify CSV Parser (CLI Dry-Run)

Run a dry-run test of the anomaly detection engine against `expenses_export.csv`:

```powershell
# PowerShell:
$env:DATABASE_URL="<your_connection_string>"; npx tsx prisma/test-parser.ts
```

Expected output: **13 anomalies** detected across the 13 rows of the CSV.

### 7. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 Project Structure

```
splitshare/
├── prisma/
│   ├── schema.prisma          # DB Models (User, Group, Membership, Expense, Settlement, Anomaly logs)
│   ├── seed.js                # Mock roommates & membership timeline seeder
│   └── test-parser.ts         # CLI dry-run verification of anomaly detection
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          # Login, Logout, Me (JWT-based)
│   │   │   ├── expenses/      # CRUD for shared expenses
│   │   │   ├── groups/        # Group listing + balance summary API
│   │   │   ├── import/        # CSV ingestion + staging
│   │   │   │   └── resolve/   # Anomaly resolution + DB commit
│   │   │   └── settlements/   # Direct payment recording
│   │   ├── globals.css        # Global styles
│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Single-page React application (all views)
│   └── lib/
│       ├── auth.ts            # Password hashing + session management
│       ├── csv-parser.ts      # Anomaly detection & normalization engine
│       ├── jwt.ts             # JWT sign/verify
│       └── prisma.ts          # Prisma client singleton (with pg adapter)
├── .env                       # Environment variables (not committed)
├── SCOPE.md                   # Anomaly log & database schema
├── DECISIONS.md               # Decision log
├── AI_USAGE.md                # AI collaboration log
├── IMPORT_REPORT.md           # CSV import anomaly report
└── README.md                  # This file
```

---

## 🤖 AI Used in Development

This project was developed with AI assistance from **Antigravity** (powered by Google DeepMind). The AI was used as a pair programmer for:

- Scaffolding the Next.js project structure and Prisma schema
- Generating the anomaly detection logic in `csv-parser.ts`
- Building the interactive anomaly resolution wizard UI
- Debugging Prisma 7 breaking changes (WASM adapter, config migration)
- Implementing the graph-based debt minimization algorithm

All AI-generated code was reviewed, tested, and corrected where needed. Three specific cases where the AI produced incorrect output are documented in `AI_USAGE.md`.

---

## 🌐 Live Deployment

The application is deployed on Vercel:  
**[https://splitshare.vercel.app](https://splitshare.vercel.app)** *(if applicable)*
