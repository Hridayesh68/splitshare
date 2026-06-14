import { prisma } from './prisma';

export interface RawRow {
  index: number;
  date: string;
  description: string;
  amount: string;
  paidBy: string;
  sharedWith: string;   // semicolon-separated names (or "Name:pct" for PERCENTAGE)
  splitDetails: string; // split_details column from new format (also "Name:pct")
  currency: string;
  splitType: string;
  notes: string;
}

export interface CSVAnomaly {
  rowNumber: number;
  columnName?: string;
  rawValue?: string;
  errorType: string;
  description: string;
  suggestedResolution: string;
}

export interface ParseResult {
  fileName: string;
  anomalies: CSVAnomaly[];
  validRows: RawRow[];
}

// ---------------------------------------------------------------------------
// Column name normalizer
// Maps any known alias to a canonical key.
// Handles both snake_case (new format) and PascalCase / nospace (old format).
// ---------------------------------------------------------------------------
function canonicalHeader(raw: string): string {
  const h = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  switch (h) {
    case 'date':                          return 'date';
    case 'description':                   return 'description';
    case 'amount':                        return 'amount';
    case 'paidby':  case 'paid_by':
    case 'paidby':                        return 'paidby';
    case 'sharedwith': case 'split_with':
    case 'splitwith':                     return 'sharedwith';
    case 'splitdetails': case 'split_details':
    case 'splitdetail':                   return 'splitdetails';
    case 'currency':                      return 'currency';
    case 'splittype': case 'split_type':
    case 'type':                          return 'splittype';
    case 'notes': case 'note':            return 'notes';
    default:                              return h;
  }
}

// ---------------------------------------------------------------------------
// Auto-detect delimiter: tab or comma
// ---------------------------------------------------------------------------
function detectDelimiter(headerLine: string): string {
  const tabCount   = (headerLine.match(/\t/g)  || []).length;
  const commaCount = (headerLine.match(/,/g)   || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

// ---------------------------------------------------------------------------
// Split a single line on `delimiter`, respecting double-quoted fields
// ---------------------------------------------------------------------------
function splitLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let c = 0; c < line.length; c++) {
    const char = line[c];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

// ---------------------------------------------------------------------------
// Normalize a date string to YYYY-MM-DD.
// Supports:
//   YYYY-MM-DD  (ISO, no change)
//   MM/DD/YYYY  (old CSV — 02/05/2026 → 2026-02-05)
//   DD-MM-YYYY  (new CSV — 01-02-2026 → 2026-02-01)
//   DD/MM/YYYY  (alternate slash-separated)
// Returns { normalized, wasAlternate, format } or null if unparseable.
// ---------------------------------------------------------------------------
export function normalizeDate(raw: string): {
  date: Date;
  normalized: string;
  wasAlternate: boolean;
  detectedFormat: string;
} | null {
  const s = raw.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00');
    if (!isNaN(d.getTime())) return { date: d, normalized: s, wasAlternate: false, detectedFormat: 'YYYY-MM-DD' };
  }

  // MM/DD/YYYY  (used in old expenses_export.csv)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [mm, dd, yyyy] = s.split('/');
    const normalized = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    const d = new Date(normalized + 'T00:00:00');
    if (!isNaN(d.getTime())) return { date: d, normalized, wasAlternate: true, detectedFormat: 'MM/DD/YYYY' };
  }

  // DD-MM-YYYY  (new format — 01-02-2026)
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('-');
    const normalized = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    const d = new Date(normalized + 'T00:00:00');
    if (!isNaN(d.getTime())) return { date: d, normalized, wasAlternate: true, detectedFormat: 'DD-MM-YYYY' };
  }

  // DD/MM/YYYY  (alternate slash)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    const normalized = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    const d = new Date(normalized + 'T00:00:00');
    if (!isNaN(d.getTime())) return { date: d, normalized, wasAlternate: true, detectedFormat: 'DD/MM/YYYY' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main CSV parser
// ---------------------------------------------------------------------------
export function parseCSV(csvContent: string): RawRow[] {
  const lines = csvContent.split(/\r?\n/);
  const rows: RawRow[] = [];

  if (lines.length === 0) return rows;

  // Detect delimiter from header line
  const delimiter = detectDelimiter(lines[0]);

  // Parse and normalize headers
  const rawHeaders = splitLine(lines[0], delimiter);
  const headers = rawHeaders.map(canonicalHeader);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = splitLine(line, delimiter);

    const rowData: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowData[header] = values[index] !== undefined ? values[index] : '';
    });

    // Resolve the "shared with" field — prefer split_details when populated
    // (split_details carries "Name:pct" for PERCENTAGE rows in the new format)
    const splitDetailsRaw = rowData['splitdetails'] || '';
    const sharedWithRaw   = rowData['sharedwith']   || '';
    const effectiveSharedWith = splitDetailsRaw.trim() !== ''
      ? splitDetailsRaw.trim()
      : sharedWithRaw.trim();

    rows.push({
      index: i + 1,   // 1-indexed; header is row 1
      date:         rowData['date']         || '',
      description:  rowData['description']  || '',
      amount:       rowData['amount']        || '',
      paidBy:       rowData['paidby']        || '',
      sharedWith:   effectiveSharedWith,
      splitDetails: splitDetailsRaw,
      currency:     (rowData['currency']     || 'INR').trim(),
      splitType:    (rowData['splittype']    || 'EQUAL').trim(),
      notes:        rowData['notes']         || '',
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Validation engine
// ---------------------------------------------------------------------------
export async function validateCSVRows(
  rows: RawRow[],
  groupId: string
): Promise<{ anomalies: CSVAnomaly[]; validRows: RawRow[] }> {
  const anomalies: CSVAnomaly[] = [];
  const validRows: RawRow[] = [];
  const seenRows = new Set<string>();

  // Fetch group memberships and user details from DB
  const memberships = await prisma.groupMembership.findMany({
    where: { groupId },
    include: { user: true },
  });

  const memberNames = memberships.map(m => m.user.name.toLowerCase());
  const memberMap = new Map(memberships.map(m => [m.user.name.toLowerCase(), m]));

  for (const row of rows) {
    let hasAnomaly = false;

    // 1. Check for missing critical fields
    if (!row.date || !row.description || !row.amount || !row.paidBy) {
      const missing: string[] = [];
      if (!row.date)        missing.push('date');
      if (!row.description) missing.push('description');
      if (!row.amount)      missing.push('amount');
      if (!row.paidBy)      missing.push('paid_by');
      anomalies.push({
        rowNumber: row.index,
        description: `Row ${row.index} is missing required fields: ${missing.join(', ')}. (Date: "${row.date}", Desc: "${row.description}", Amount: "${row.amount}", PaidBy: "${row.paidBy}")`,
        errorType: 'MISSING_FIELD',
        suggestedResolution: 'DISCARD_ROW',
      });
      continue;
    }

    // 2. Normalize and check Date Format
    const dateResult = normalizeDate(row.date);

    if (dateResult && dateResult.wasAlternate) {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'date',
        rawValue: row.date,
        errorType: 'INCONSISTENT_DATE_FORMAT',
        description: `Date "${row.date}" is formatted as ${dateResult.detectedFormat}. Normalizing to YYYY-MM-DD: ${dateResult.normalized}.`,
        suggestedResolution: `AUTO_CORRECT_DATE|${dateResult.normalized}`,
      });
    }

    if (!dateResult || isNaN(dateResult.date.getTime())) {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'date',
        rawValue: row.date,
        errorType: 'INVALID_DATE',
        description: `Date "${row.date}" cannot be parsed into a valid date.`,
        suggestedResolution: 'DISCARD_ROW',
      });
      continue;
    }

    const parsedDate      = dateResult.date;
    const normalizedDateStr = dateResult.normalized;

    // 3. Check for Non-numeric Amount
    const amountVal = parseFloat(row.amount.replace(/,/g, ''));
    if (isNaN(amountVal)) {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'amount',
        rawValue: row.amount,
        errorType: 'INVALID_AMOUNT',
        description: `Amount "${row.amount}" is not a valid number.`,
        suggestedResolution: 'DISCARD_ROW',
      });
      continue;
    }

    // 4. Check for Negative Amount
    if (amountVal < 0) {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'amount',
        rawValue: row.amount,
        errorType: 'NEGATIVE_AMOUNT',
        description: `Negative amount of ${amountVal} detected. Is this a refund or data entry error?`,
        suggestedResolution: `AUTO_CORRECT_ABS|${Math.abs(amountVal)}`,
      });
      hasAnomaly = true;
    }

    // 5. Check for Duplicate Entries
    const payerNameClean = row.paidBy.trim().toLowerCase();
    const rowHash = `${normalizedDateStr}|${row.description.trim().toLowerCase()}|${Math.abs(amountVal)}|${payerNameClean}`;
    if (seenRows.has(rowHash)) {
      anomalies.push({
        rowNumber: row.index,
        errorType: 'DUPLICATE',
        description: `Duplicate transaction found: "${row.description}" on ${normalizedDateStr} for ${Math.abs(amountVal)} paid by ${row.paidBy.trim()}.`,
        suggestedResolution: 'PENDING_APPROVAL_DELETE',
      });
      hasAnomaly = true;
    } else {
      seenRows.add(rowHash);
    }

    // 6. Check for USD Currency (Priya's USD vs INR issue)
    const currencyStr = row.currency.trim().toUpperCase();
    if (currencyStr === 'USD') {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'currency',
        rawValue: row.currency,
        errorType: 'CURRENCY_USD',
        description: `Transaction is in USD ($${Math.abs(amountVal)}). Requires conversion to INR.`,
        suggestedResolution: 'CONVERT_USD_INR',
      });
      hasAnomaly = true;
    }

    // 7. Check for Settlements Logged as Expenses
    const descLower = row.description.toLowerCase();
    const isSettlementType = row.splitType.toUpperCase() === 'SETTLEMENT';
    const hasSettlementKeywords =
      descLower.includes('paid') || descLower.includes('settle') || descLower.includes('received');

    if (isSettlementType || (hasSettlementKeywords && !row.sharedWith.includes(';'))) {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'description',
        rawValue: row.description,
        errorType: 'SETTLEMENT_LOGGED_AS_EXPENSE',
        description: `Potential settlement logged as expense: "${row.description}". Should be processed as a direct payment.`,
        suggestedResolution: 'CONVERT_TO_SETTLEMENT',
      });
      hasAnomaly = true;
    }

    // 8. Normalize Names (trailing / leading whitespace)
    const rawPayerName = row.paidBy.trim();
    const payerName    = rawPayerName.toLowerCase();

    if (rawPayerName !== row.paidBy) {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'paid_by',
        rawValue: row.paidBy,
        errorType: 'INCONSISTENT_NAME_WHITESPACE',
        description: `Payer name "${row.paidBy}" contains extra whitespace. Normalizing to "${rawPayerName}".`,
        suggestedResolution: `AUTO_TRIM_NAME|${rawPayerName}`,
      });
      hasAnomaly = true;
    }

    if (!memberNames.includes(payerName)) {
      anomalies.push({
        rowNumber: row.index,
        columnName: 'paid_by',
        rawValue: row.paidBy,
        errorType: 'UNKNOWN_USER',
        description: `User "${row.paidBy.trim()}" is not a registered member of this group.`,
        suggestedResolution: 'DISCARD_ROW',
      });
      continue;
    }

    // 9. Check sharedWith / split_with members
    const rawSharedMembers = row.sharedWith
      ? row.sharedWith.split(';').map(m => m.trim()).filter(Boolean)
      : [];
    const normalizedSharedMembers: string[] = [];

    for (const member of rawSharedMembers) {
      const memberName = member.split(':')[0].trim();
      const nMember    = memberName.toLowerCase();
      if (!memberNames.includes(nMember)) {
        anomalies.push({
          rowNumber: row.index,
          columnName: 'split_with',
          rawValue: member,
          errorType: 'UNKNOWN_USER_SPLIT',
          description: `Split member "${memberName}" is not a registered member of this group.`,
          suggestedResolution: 'EXCLUDE_USER_FROM_SPLIT',
        });
        hasAnomaly = true;
      } else {
        normalizedSharedMembers.push(memberName);
      }
    }

    // 10. Temporal Membership Constraints — Payer
    const payerMembership = memberMap.get(payerName);
    if (payerMembership) {
      const joined = new Date(payerMembership.joinedAt);
      const left   = payerMembership.leftAt ? new Date(payerMembership.leftAt) : null;

      if (parsedDate < joined) {
        anomalies.push({
          rowNumber: row.index,
          columnName: 'paid_by',
          rawValue: row.paidBy,
          errorType: 'TEMPORAL_MEMBERSHIP_PRE_JOIN',
          description: `Payer "${rawPayerName}" paid on ${normalizedDateStr} but only joined on ${payerMembership.joinedAt.toISOString().split('T')[0]}.`,
          suggestedResolution: 'DISCARD_ROW',
        });
        continue;
      }

      if (left && parsedDate > left) {
        anomalies.push({
          rowNumber: row.index,
          columnName: 'paid_by',
          rawValue: row.paidBy,
          errorType: 'TEMPORAL_MEMBERSHIP_POST_LEAVE',
          description: `Payer "${rawPayerName}" paid on ${normalizedDateStr} but moved out on ${left.toISOString().split('T')[0]}.`,
          suggestedResolution: 'DISCARD_ROW',
        });
        continue;
      }
    }

    // 11. Temporal Membership Constraints — Split Members
    for (const member of normalizedSharedMembers) {
      const memberMembership = memberMap.get(member.toLowerCase());
      if (memberMembership) {
        const joined = new Date(memberMembership.joinedAt);
        const left   = memberMembership.leftAt ? new Date(memberMembership.leftAt) : null;

        if (parsedDate < joined) {
          anomalies.push({
            rowNumber: row.index,
            columnName: 'split_with',
            rawValue: member,
            errorType: 'TEMPORAL_MEMBERSHIP_PRE_JOIN_SPLIT',
            description: `Member "${member}" is charged on ${normalizedDateStr} but only joined on ${joined.toISOString().split('T')[0]}.`,
            suggestedResolution: `EXCLUDE_MEMBER_SPLIT|${member}`,
          });
          hasAnomaly = true;
        }

        if (left && parsedDate > left) {
          anomalies.push({
            rowNumber: row.index,
            columnName: 'split_with',
            rawValue: member,
            errorType: 'TEMPORAL_MEMBERSHIP_POST_LEAVE_SPLIT',
            description: `Member "${member}" is charged on ${normalizedDateStr} but moved out on ${left.toISOString().split('T')[0]}.`,
            suggestedResolution: `EXCLUDE_MEMBER_SPLIT|${member}`,
          });
          hasAnomaly = true;
        }
      }
    }

    // 12. Split Sum Mismatch (Percentage rows)
    const effectiveSplitType = row.splitType.toUpperCase();
    if (effectiveSplitType === 'PERCENTAGE' && row.sharedWith) {
      let totalPct = 0;
      for (const part of row.sharedWith.split(';')) {
        const share = part.split(':');
        if (share.length === 2) {
          const pct = parseFloat(share[1]);
          if (!isNaN(pct)) totalPct += pct;
        }
      }
      if (totalPct !== 100 && totalPct !== 0) {
        anomalies.push({
          rowNumber: row.index,
          columnName: 'split_with',
          rawValue: row.sharedWith,
          errorType: 'SPLIT_SHARE_MISMATCH',
          description: `Percentage split shares sum to ${totalPct}% instead of 100%.`,
          suggestedResolution: 'REDISTRIBUTE_EQUAL_PERCENTAGE',
        });
        hasAnomaly = true;
      }
    }

    validRows.push(row);
  }

  return { anomalies, validRows };
}
