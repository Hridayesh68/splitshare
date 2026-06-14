import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface DebtPayment {
  from: { id: string; name: string };
  to: { id: string; name: string };
  amount: number;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get('groupId');

    if (!groupId) {
      return NextResponse.json(
        { error: 'groupId is required' },
        { status: 400 }
      );
    }

    // 1. Fetch group members
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const members = memberships.map(m => m.user);
    const memberMap = new Map(members.map(u => [u.id, u]));

    // 2. Fetch all expenses with splits
    const expenses = await prisma.expense.findMany({
      where: { groupId },
      include: {
        paidBy: { select: { id: true, name: true } },
        splits: true,
      },
    });

    // 3. Fetch all settlements
    const settlements = await prisma.settlement.findMany({
      where: { groupId },
      include: {
        payer: { select: { id: true, name: true } },
        payee: { select: { id: true, name: true } },
      },
    });

    // Initialize balance tables
    const userSummary: Record<string, {
      userId: string;
      name: string;
      totalPaid: number;       // Converted to base INR
      totalOwed: number;       // Converted to base INR
      totalSettledSent: number; // Converted to base INR
      totalSettledRecv: number; // Converted to base INR
      netBalance: number;       // net balance in base INR
      ledger: any[];           // Rohan's breakdown list
    }> = {};

    members.forEach(u => {
      userSummary[u.id] = {
        userId: u.id,
        name: u.name,
        totalPaid: 0,
        totalOwed: 0,
        totalSettledSent: 0,
        totalSettledRecv: 0,
        netBalance: 0,
        ledger: [],
      };
    });

    // Process expenses for paid amounts
    expenses.forEach(exp => {
      const baseAmount = exp.amount * exp.exchangeRate;
      
      // The payer gets credited in base amount
      if (userSummary[exp.paidById]) {
        userSummary[exp.paidById].totalPaid += baseAmount;
        userSummary[exp.paidById].ledger.push({
          type: 'PAYMENT',
          description: `${exp.description} (Paid)`,
          amount: exp.amount,
          currency: exp.currency,
          baseAmount: baseAmount,
          date: exp.date,
        });
      }

      // Process splits (what members owe)
      exp.splits.forEach(split => {
        if (userSummary[split.userId]) {
          userSummary[split.userId].totalOwed += split.amount;
          userSummary[split.userId].ledger.push({
            type: 'SHARE',
            description: `${exp.description} (Share)`,
            amount: split.amount / exp.exchangeRate, // Convert back to local currency for display if needed
            currency: exp.currency,
            baseAmount: split.amount,
            date: exp.date,
          });
        }
      });
    });

    // Process settlements
    settlements.forEach(set => {
      if (userSummary[set.payerId]) {
        userSummary[set.payerId].totalSettledSent += set.amount;
        userSummary[set.payerId].ledger.push({
          type: 'SETTLEMENT_SENT',
          description: `Settled to ${set.payee.name}`,
          amount: set.amount,
          currency: set.currency,
          baseAmount: set.amount,
          date: set.date,
        });
      }

      if (userSummary[set.payeeId]) {
        userSummary[set.payeeId].totalSettledRecv += set.amount;
        userSummary[set.payeeId].ledger.push({
          type: 'SETTLEMENT_RECV',
          description: `Received settlement from ${set.payer.name}`,
          amount: set.amount,
          currency: set.currency,
          baseAmount: set.amount,
          date: set.date,
        });
      }
    });

    // Compute Net Balances
    // Net Balance = (Total Paid - Total Owed) + (Total Settled Sent - Total Settled Received)
    const netBalances: { id: string; name: string; balance: number }[] = [];
    
    members.forEach(u => {
      const summary = userSummary[u.id];
      summary.netBalance = (summary.totalPaid - summary.totalOwed) + (summary.totalSettledSent - summary.totalSettledRecv);
      // Clean up JS rounding issues
      summary.netBalance = parseFloat(summary.netBalance.toFixed(2));
      
      // Sort ledger by date descending
      summary.ledger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      netBalances.push({
        id: u.id,
        name: u.name,
        balance: summary.netBalance,
      });
    });

    // Aisha's Debt Simplification (Minimization Algorithm)
    const debtors = netBalances
      .filter(x => x.balance < -0.01)
      .map(x => ({ ...x, balance: Math.abs(x.balance) }))
      .sort((a, b) => b.balance - a.balance);

    const creditors = netBalances
      .filter(x => x.balance > 0.01)
      .map(x => ({ ...x }))
      .sort((a, b) => b.balance - a.balance);

    const simplifiedPayments: DebtPayment[] = [];

    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];

      const amountToPay = Math.min(debtor.balance, creditor.balance);
      const roundedAmount = parseFloat(amountToPay.toFixed(2));

      if (roundedAmount > 0) {
        simplifiedPayments.push({
          from: { id: debtor.id, name: debtor.name },
          to: { id: creditor.id, name: creditor.name },
          amount: roundedAmount,
        });
      }

      debtor.balance -= amountToPay;
      creditor.balance -= amountToPay;

      if (debtor.balance < 0.01) dIdx++;
      if (creditor.balance < 0.01) cIdx++;
    }

    return NextResponse.json({
      members: netBalances,
      userSummary: Object.values(userSummary),
      simplifiedPayments,
    });
  } catch (error: any) {
    console.error('Fetch group summary error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
