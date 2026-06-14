# IMPORT_REPORT.md — CSV Ingestion Anomaly Report

**File Imported:** `expenses_export.csv`  
**Import Date:** 2026-06-14  
**Group:** Flatmates Room  
**Total Rows Parsed:** 13 (excluding header)  
**Import Status:** ✅ COMPLETED  
**Anomalies Detected:** 13  
**Valid Rows Committed:** 11 expenses + 1 settlement = 12 records

---

## Row-by-Row Anomaly Report

### ✅ Row 2 — `2026-02-05, Rent, 12000, Aisha, Aisha;Rohan;Priya;Meera, INR, EQUAL`
**Status:** COMMITTED  
**Action:** No anomalies. Committed as equal-split expense of ₹12,000 → ₹3,000 per member (Aisha, Rohan, Priya, Meera).

---

### ⚠️ Row 3 — `02/05/2026, Rent, 12000, Aisha, Aisha;Rohan;Priya;Meera, INR, EQUAL`
**Status:** DISCARDED  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `INCONSISTENT_DATE_FORMAT` | Date `02/05/2026` matched `MM/DD/YYYY` pattern instead of `YYYY-MM-DD` | Auto-normalized to `2026-02-05` |
| 2 | `DUPLICATE` | Normalized date + description + amount + payer hash matched Row 2 exactly | **User approved discard** — row skipped |

---

### ⚠️ Row 4 — `2026-02-10, Groceries, -1500, Rohan, Aisha;Rohan;Priya;Meera, INR, EQUAL`
**Status:** COMMITTED (corrected)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `NEGATIVE_AMOUNT` | `parseFloat("-1500") < 0` | **User approved conversion to absolute value** → ₹1,500 |

Committed as equal-split expense of ₹1,500 → ₹375 per member (Aisha, Rohan, Priya, Meera).

---

### ❌ Row 5 — `2026-02-15, Dinner, abc, Priya, Aisha;Rohan;Priya;Meera, INR, EQUAL`
**Status:** DISCARDED  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `INVALID_AMOUNT` | `isNaN(parseFloat("abc"))` | **Auto-discarded** — un-importable row |

---

### ✅ Row 6 — `2026-02-20, Internet, 1000, Meera, , INR, EQUAL`
**Status:** COMMITTED  
**Note:** `SharedWith` field was blank. Defaulted to all members active on `2026-02-20` (Aisha, Rohan, Priya, Meera).  
Committed as equal-split expense of ₹1,000 → ₹250 per member.

> **Anomaly 5 (Empty SharedWith):** Handled by defaulting to all active members during resolution.

---

### ⚠️ Row 7 — `2026-03-05, Trip Cab, 50, Priya, Aisha;Rohan;Priya;Meera;Dev, USD, EQUAL`
**Status:** COMMITTED (converted)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `CURRENCY_USD` | `currency === "USD"` | **User confirmed rate: 1 USD = ₹83** |

Committed as equal-split expense of $50 (₹4,150) → ₹830 per member (Aisha, Rohan, Priya, Meera, Dev). Exchange rate stored: 83.0.

---

### ⚠️ Row 8 — `2026-03-10, Aisha paid Meera 2000, 2000, Aisha, Meera, INR, SETTLEMENT`
**Status:** COMMITTED as Settlement  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `SETTLEMENT_LOGGED_AS_EXPENSE` | `splitType === "SETTLEMENT"` and description contains keyword `"paid"` | **Converted to Settlement record** |

Committed as direct Settlement: Aisha → Meera, ₹2,000. Not recorded as a shared expense.

---

### ⚠️ Row 9 — `2026-03-12, Trip Dinner, 100, Dev, Aisha;Rohan;Priya;Meera;Dev, USD, EQUAL`
**Status:** COMMITTED (converted)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `CURRENCY_USD` | `currency === "USD"` | **User confirmed rate: 1 USD = ₹83** |

Committed as equal-split expense of $100 (₹8,300) → ₹1,660 per member (Aisha, Rohan, Priya, Meera, Dev). Exchange rate stored: 83.0.

---

### ⚠️ Row 10 — `2026-03-25, Electricity Bill, 4000, Rohan, Aisha;Rohan;Priya;Meera;Sam, INR, EQUAL`
**Status:** COMMITTED (Sam excluded)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `TEMPORAL_MEMBERSHIP_PRE_JOIN_SPLIT` | Expense date `2026-03-25` < Sam's `joinedAt` (`2026-04-15`) | **Sam excluded from split** |

Committed as equal-split expense of ₹4,000 → ₹1,000 per member (Aisha, Rohan, Priya, Meera). Sam's share redistributed.

---

### ⚠️ Row 11 — `2026-04-05, Groceries, 3000, Aisha, Aisha;Rohan;Priya;Meera, INR, EQUAL`
**Status:** COMMITTED (Meera excluded)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `TEMPORAL_MEMBERSHIP_POST_LEAVE_SPLIT` | Expense date `2026-04-05` > Meera's `leftAt` (`2026-03-31`) | **Meera excluded from split** |

Committed as equal-split expense of ₹3,000 → ₹1,000 per member (Aisha, Rohan, Priya). Meera's share redistributed.

---

### ⚠️ Row 12 — `2026-04-10, Trip Dinner (Late), 150, Priya, Aisha;Rohan;Priya;Dev, USD, EQUAL`
**Status:** COMMITTED (USD converted + Dev excluded)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `CURRENCY_USD` | `currency === "USD"` | **User confirmed rate: 1 USD = ₹83** |
| 2 | `TEMPORAL_MEMBERSHIP_POST_LEAVE_SPLIT` | Expense date `2026-04-10` > Dev's `leftAt` (`2026-03-15`) | **Dev excluded from split** |

Committed as equal-split expense of $150 (₹12,450) → ₹4,150 per member (Aisha, Rohan, Priya). Dev excluded.

---

### ⚠️ Row 13 — `2026-04-20, Rent, 15000, Aisha , Aisha;Rohan;Priya;Sam, INR, EQUAL`
**Status:** COMMITTED (name trimmed)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `INCONSISTENT_NAME_WHITESPACE` | `"Aisha " !== "Aisha ".trim()` → trailing space detected | **Auto-trimmed and normalized** — user acknowledged |

Committed as equal-split expense of ₹15,000 → ₹3,750 per member (Aisha, Rohan, Priya, Sam). Payer correctly identified as Aisha.

---

### ⚠️ Row 14 — `2026-04-25, Special Dinner, 5000, Rohan, Aisha:50;Rohan:30;Priya:30, INR, PERCENTAGE`
**Status:** COMMITTED (redistributed equally)  

| # | Anomaly | Detection | Action Taken |
|---|---------|-----------|-------------|
| 1 | `SPLIT_SHARE_MISMATCH` | Parsed percentages: `50 + 30 + 30 = 110 ≠ 100` | **User chose: Redistribute Equally** |

Committed as equal-split expense of ₹5,000 → ₹1,667 (Aisha) + ₹1,667 (Rohan) + ₹1,666 (Priya). Last-penny rounding applied.

---

## Final Summary

| Metric | Value |
|--------|-------|
| Total rows in CSV | 13 |
| Rows with no anomalies | 1 (Row 2) |
| Rows with anomalies, committed | 10 |
| Rows discarded | 2 (Row 3 — duplicate; Row 5 — invalid amount) |
| Anomalies detected | 13 |
| Anomalies auto-resolved | 4 (date normalize, name trim, split sum → equal) |
| Anomalies requiring user decision | 9 |
| Expenses committed | 11 |
| Settlements committed | 1 |

---

## Resulting Member Balances

After processing all 12 records:

| Member | Total Paid (INR) | Total Owed (INR) | Net Balance |
|--------|-----------------|-----------------|-------------|
| Aisha | ₹30,000 | ₹17,682 | **+₹14,318** |
| Dev | ₹8,300 | ₹2,490 | **+₹5,810** |
| Priya | ₹16,600 | ₹17,681 | **−₹1,081** |
| Sam | ₹0 | ₹3,750 | **−₹3,750** |
| Rohan | ₹10,500 | ₹17,682 | **−₹7,182** |
| Meera | ₹1,000 | ₹7,115 | **−₹8,115** |

## Simplified Payments (Debt Minimization — Aisha's Request)

| Payer | Payee | Amount |
|-------|-------|--------|
| Meera | Aisha | ₹8,115 |
| Rohan | Aisha | ₹6,203 |
| Rohan | Dev | ₹979 |
| Sam | Dev | ₹3,750 |
| Priya | Dev | ₹1,081 |
