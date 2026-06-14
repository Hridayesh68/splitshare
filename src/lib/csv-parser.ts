import { prisma } from './prisma';

export interface RawRow {
  index: number;
  date: string;
  description: string;
  amount: string;
  paidBy: string;
  sharedWith: string;
  currency: string;
  splitType: string;
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

export function parseCSV(csvContent: string): RawRow[] {
  const lines = csvContent.split(/\r?\n/);
  const rows: RawRow[] = [];
  
  if (lines.length === 0) return rows;
  
  // Parse headers
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Simple CSV line parser handling commas and potential quotes
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    
    const rowData: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowData[header] = values[index] !== undefined ? values[index] : '';
    });
    
    rows.push({
      index: i + 1,
      date: rowData['date'] || '',
      description: rowData['description'] || '',
      amount: rowData['amount'] || '',
      paidBy: rowData['paidby'] || '',
      sharedWith: rowData['sharedwith'] || '',
      currency: rowData['currency'] || 'INR',
      splitType: rowData['splittype'] || 'EQUAL',
    });
  }
  
  return rows;
}

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
      anomalies.push({
        rowNumber: row.index,
        description: `Row has missing critical data (Date: "${row.date}", Desc: "${row.description}", Amount: "${row.amount}", PaidBy: "${row.paidBy}")`,
        errorType: "MISSING_FIELD",
        suggestedResolution: "DISCARD_ROW",
      });
      continue;
    }

    // 2. Normalize and check Date Format
    let parsedDate: Date | null = null;
    let originalDateStr = row.date;
    let normalizedDateStr = originalDateStr;
    
    // Support YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(originalDateStr)) {
      parsedDate = new Date(originalDateStr);
      normalizedDateStr = originalDateStr;
    } 
    // Support DD/MM/YYYY or MM/DD/YYYY
    else if (/^\d{2}\/\d{2}\/\d{4}$/.test(originalDateStr)) {
      const parts = originalDateStr.split('/');
      // In expenses_export.csv, row 3 "02/05/2026" represents Feb 5, 2026, which is a duplicate of Row 2.
      // Thus, we parse this as MM/DD/YYYY.
      const month = parseInt(parts[0], 10) - 1;
      const day = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      parsedDate = new Date(year, month, day);
      normalizedDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      anomalies.push({
        rowNumber: row.index,
        columnName: "Date",
        rawValue: originalDateStr,
        errorType: "INCONSISTENT_DATE_FORMAT",
        description: `Date "${originalDateStr}" is formatted as MM/DD/YYYY. Normalizing to YYYY-MM-DD.`,
        suggestedResolution: `AUTO_CORRECT_DATE|${normalizedDateStr}`,
      });
    }

    if (!parsedDate || isNaN(parsedDate.getTime())) {
      anomalies.push({
        rowNumber: row.index,
        columnName: "Date",
        rawValue: row.date,
        errorType: "INVALID_DATE",
        description: `Date "${row.date}" cannot be parsed.`,
        suggestedResolution: "DISCARD_ROW",
      });
      continue;
    }

    // 3. Check for Non-numeric Amount
    const amountVal = parseFloat(row.amount.replace(/,/g, ''));
    if (isNaN(amountVal)) {
      anomalies.push({
        rowNumber: row.index,
        columnName: "Amount",
        rawValue: row.amount,
        errorType: "INVALID_AMOUNT",
        description: `Amount "${row.amount}" is not a valid number.`,
        suggestedResolution: "DISCARD_ROW",
      });
      continue;
    }

    // 4. Check for Negative Amount
    if (amountVal < 0) {
      anomalies.push({
        rowNumber: row.index,
        columnName: "Amount",
        rawValue: row.amount,
        errorType: "NEGATIVE_AMOUNT",
        description: `Negative amount of ${amountVal} detected. Is this a refund or error?`,
        suggestedResolution: `AUTO_CORRECT_ABS|${Math.abs(amountVal)}`,
      });
      hasAnomaly = true;
    }

    // 5. Check for Duplicate Entries
    const payerNameClean = row.paidBy.trim().toLowerCase();
    const rowHash = `${normalizedDateStr}|${row.description.trim().toLowerCase()}|${amountVal}|${payerNameClean}`;
    if (seenRows.has(rowHash)) {
      anomalies.push({
        rowNumber: row.index,
        errorType: "DUPLICATE",
        description: `Duplicate transaction row found: ${row.description} on ${normalizedDateStr} for amount ${row.amount}.`,
        suggestedResolution: "PENDING_APPROVAL_DELETE",
      });
      hasAnomaly = true;
    } else {
      seenRows.add(rowHash);
    }

    // 6. Check for USD Currencies (Priya's USD vs INR issue)
    const currencyStr = row.currency.trim().toUpperCase();
    if (currencyStr === 'USD') {
      anomalies.push({
        rowNumber: row.index,
        columnName: "Currency",
        rawValue: row.currency,
        errorType: "CURRENCY_USD",
        description: `Transaction is in USD ($${amountVal}). Requires conversion to INR.`,
        suggestedResolution: "CONVERT_USD_INR",
      });
      hasAnomaly = true;
    }

    // 7. Check for Settlements Logged as Expenses (Aisha's payment)
    const descLower = row.description.toLowerCase();
    const isSettlementType = row.splitType.toUpperCase() === 'SETTLEMENT';
    const hasSettlementKeywords = descLower.includes('paid') || descLower.includes('settle') || descLower.includes('received');
    
    if (isSettlementType || (hasSettlementKeywords && !row.sharedWith.includes(';'))) {
      anomalies.push({
        rowNumber: row.index,
        columnName: "Description",
        rawValue: row.description,
        errorType: "SETTLEMENT_LOGGED_AS_EXPENSE",
        description: `Potential settlement logged as expense: "${row.description}". Should be processed as a direct payment.`,
        suggestedResolution: "CONVERT_TO_SETTLEMENT",
      });
      hasAnomaly = true;
    }

    // 8. Normalise Names (Aisha with trailing space, etc.)
    const rawPayerName = row.paidBy.trim();
    const payerName = rawPayerName.toLowerCase();
    
    if (rawPayerName !== row.paidBy) {
      anomalies.push({
        rowNumber: row.index,
        columnName: "PaidBy",
        rawValue: row.paidBy,
        errorType: "INCONSISTENT_NAME_WHITESPACE",
        description: `Payer name "${row.paidBy}" contains trailing or leading whitespace. Normalizing to "${rawPayerName}".`,
        suggestedResolution: `AUTO_TRIM_NAME|${rawPayerName}`,
      });
      hasAnomaly = true;
    }

    if (!memberNames.includes(payerName)) {
      anomalies.push({
        rowNumber: row.index,
        columnName: "PaidBy",
        rawValue: row.paidBy,
        errorType: "UNKNOWN_USER",
        description: `User "${row.paidBy}" is not a member of this group.`,
        suggestedResolution: "DISCARD_ROW",
      });
      continue;
    }

    // Check sharedWith members
    const rawSharedMembers = row.sharedWith ? row.sharedWith.split(';').map(m => m.trim()) : [];
    const normalizedSharedMembers: string[] = [];

    for (const member of rawSharedMembers) {
      const parts = member.split(':');
      const memberName = parts[0].trim();
      const nMember = memberName.toLowerCase();
      if (!memberNames.includes(nMember)) {
        anomalies.push({
          rowNumber: row.index,
          columnName: "SharedWith",
          rawValue: member,
          errorType: "UNKNOWN_USER_SPLIT",
          description: `Split member "${memberName}" is not a registered user.`,
          suggestedResolution: "EXCLUDE_USER_FROM_SPLIT",
        });
        hasAnomaly = true;
      } else {
        normalizedSharedMembers.push(memberName);
      }
    }

    // 9. Temporal Membership Constraints (Sam's early charge & Meera's late charge)
    // Check Payer membership
    const payerMembership = memberMap.get(payerName);
    if (payerMembership) {
      const joined = new Date(payerMembership.joinedAt);
      const left = payerMembership.leftAt ? new Date(payerMembership.leftAt) : null;
      
      if (parsedDate < joined) {
        anomalies.push({
          rowNumber: row.index,
          columnName: "PaidBy",
          rawValue: row.paidBy,
          errorType: "TEMPORAL_MEMBERSHIP_PRE_JOIN",
          description: `Payer "${row.paidBy}" paid for an expense on ${row.date}, but they only joined on ${payerMembership.joinedAt.toISOString().split('T')[0]}.`,
          suggestedResolution: "DISCARD_ROW",
        });
        continue;
      }
      
      if (left && parsedDate > left) {
        anomalies.push({
          rowNumber: row.index,
          columnName: "PaidBy",
          rawValue: row.paidBy,
          errorType: "TEMPORAL_MEMBERSHIP_POST_LEAVE",
          description: `Payer "${row.paidBy}" paid for an expense on ${row.date}, but they moved out on ${payerMembership.leftAt?.toISOString().split('T')[0]}.`,
          suggestedResolution: "DISCARD_ROW",
        });
        continue;
      }
    }

    // Check Split Members membership
    for (const member of normalizedSharedMembers) {
      const memberMembership = memberMap.get(member.toLowerCase());
      if (memberMembership) {
        const joined = new Date(memberMembership.joinedAt);
        const left = memberMembership.leftAt ? new Date(memberMembership.leftAt) : null;
        
        if (parsedDate < joined) {
          anomalies.push({
            rowNumber: row.index,
            columnName: "SharedWith",
            rawValue: member,
            errorType: "TEMPORAL_MEMBERSHIP_PRE_JOIN_SPLIT",
            description: `Member "${member}" is charged for an expense on ${row.date}, but they only joined on ${memberMembership.joinedAt.toISOString().split('T')[0]} (Sam's Request).`,
            suggestedResolution: `EXCLUDE_MEMBER_SPLIT|${member}`,
          });
          hasAnomaly = true;
        }
        
        if (left && parsedDate > left) {
          anomalies.push({
            rowNumber: row.index,
            columnName: "SharedWith",
            rawValue: member,
            errorType: "TEMPORAL_MEMBERSHIP_POST_LEAVE_SPLIT",
            description: `Member "${member}" is charged for an expense on ${row.date}, but they moved out on ${memberMembership.leftAt?.toISOString().split('T')[0]} (Meera/Sam's Request).`,
            suggestedResolution: `EXCLUDE_MEMBER_SPLIT|${member}`,
          });
          hasAnomaly = true;
        }
      }
    }

    // 10. Split Shares Total Check (Percentage split verification)
    if (row.splitType.toUpperCase() === 'PERCENTAGE' && row.sharedWith) {
      let totalPercentage = 0;
      const parts = row.sharedWith.split(';');
      for (const part of parts) {
        const shareParts = part.split(':');
        if (shareParts.length === 2) {
          const pctVal = parseFloat(shareParts[1]);
          if (!isNaN(pctVal)) totalPercentage += pctVal;
        }
      }
      if (totalPercentage !== 100 && totalPercentage !== 0) {
        anomalies.push({
          rowNumber: row.index,
          columnName: "SharedWith",
          rawValue: row.sharedWith,
          errorType: "SPLIT_SHARE_MISMATCH",
          description: `Percentage split shares sum up to ${totalPercentage}% instead of 100%.`,
          suggestedResolution: "REDISTRIBUTE_EQUAL_PERCENTAGE",
        });
        hasAnomaly = true;
      }
    }

    // If row has no block-level errors, add it to potential valid list
    validRows.push(row);
  }

  return { anomalies, validRows };
}
