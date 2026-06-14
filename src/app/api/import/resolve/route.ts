import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface ResolvedRow {
  rowNumber: number;
  date: string;
  description: string;
  amount: number;       // Base amount
  currency: string;
  exchangeRate: number;
  paidById: string;
  splitType: string;
  splits: { userId: string; amount: number }[];
  isSettlement?: boolean;
  settlementPayeeId?: string;
}

interface ResolutionLog {
  anomalyId: string;
  policy: string; // e.g. "APPROVED_DELETE", "CONVERTED_USD_INR", "EXCLUDED_MEMBER"
  status: string; // "APPROVED" | "IGNORED" | "RESOLVED"
}

export async function POST(req: NextRequest) {
  try {
    const { groupId, importLogId, resolvedRows, resolutions } = await req.json() as {
      groupId: string;
      importLogId: string;
      resolvedRows: ResolvedRow[];
      resolutions: ResolutionLog[];
    };

    if (!groupId || !importLogId || !Array.isArray(resolvedRows)) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Process all entries in a single database transaction
    await prisma.$transaction(async (tx) => {
      // 1. Insert Resolved Expenses
      for (const row of resolvedRows) {
        if (row.isSettlement && row.settlementPayeeId) {
          // It's a settlement transaction
          await tx.settlement.create({
            data: {
              groupId,
              payerId: row.paidById,
              payeeId: row.settlementPayeeId,
              amount: row.amount,
              currency: row.currency,
              date: new Date(row.date),
            },
          });
        } else {
          // It's a regular shared expense
          const createdExpense = await tx.expense.create({
            data: {
              groupId,
              description: row.description,
              amount: row.amount,
              currency: row.currency,
              exchangeRate: row.exchangeRate || 1.0,
              paidById: row.paidById,
              date: new Date(row.date),
              splitType: row.splitType || 'EQUAL',
            },
          });

          if (row.splits && row.splits.length > 0) {
            await tx.expenseSplit.createMany({
              data: row.splits.map(s => ({
                expenseId: createdExpense.id,
                userId: s.userId,
                amount: s.amount,
              })),
            });
          }
        }
      }

      // 2. Update Anomaly Log Statuses
      if (Array.isArray(resolutions)) {
        for (const res of resolutions) {
          await tx.anomaly.update({
            where: { id: res.anomalyId },
            data: {
              status: res.status,
              resolutionPolicy: res.policy,
            },
          });
        }
      }

      // 3. Mark Import Log as COMPLETED
      await tx.importLog.update({
        where: { id: importLogId },
        data: { status: 'COMPLETED' },
      });
    });

    return NextResponse.json({ message: 'CSV data imported and anomalies resolved successfully.' });
  } catch (error: any) {
    console.error('Resolve anomalies error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
