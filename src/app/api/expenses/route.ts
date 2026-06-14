import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    const expenses = await prisma.expense.findMany({
      where: { groupId },
      include: {
        paidBy: {
          select: { id: true, name: true, email: true },
        },
        splits: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    return NextResponse.json(expenses);
  } catch (error: any) {
    console.error('Fetch expenses error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      groupId,
      description,
      amount,
      currency,
      exchangeRate,
      paidById,
      date,
      splitType,
      customSplits, // Array of { userId, value } for PERCENTAGE or EXACT splits
    } = await req.json();

    if (!groupId || !description || !amount || !paidById || !date) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const expenseDate = new Date(date);
    const floatAmount = parseFloat(amount);
    const rate = parseFloat(exchangeRate || 1.0);
    const convertedAmount = floatAmount * rate; // Normalized to base currency (INR)

    // Fetch memberships active on the expense date
    const activeMemberships = await prisma.groupMembership.findMany({
      where: {
        groupId,
        joinedAt: { lte: expenseDate },
        OR: [
          { leftAt: null },
          { leftAt: { gte: expenseDate } },
        ],
      },
      include: { user: true },
    });

    if (activeMemberships.length === 0) {
      return NextResponse.json(
        { error: 'No active members in this group on the specified date' },
        { status: 400 }
      );
    }

    let splitsToCreate: { userId: string; amount: number }[] = [];

    if (splitType === 'EQUAL') {
      const share = convertedAmount / activeMemberships.length;
      splitsToCreate = activeMemberships.map(m => ({
        userId: m.userId,
        amount: parseFloat(share.toFixed(2)),
      }));
    } else if (splitType === 'PERCENTAGE' && Array.isArray(customSplits)) {
      // customSplits has { userId, value } where value is the percentage
      splitsToCreate = customSplits.map(s => {
        const pct = parseFloat(s.value);
        return {
          userId: s.userId,
          amount: parseFloat(((convertedAmount * pct) / 100).toFixed(2)),
        };
      });
    } else if (splitType === 'EXACT' && Array.isArray(customSplits)) {
      // customSplits has { userId, value } where value is the exact converted amount
      splitsToCreate = customSplits.map(s => ({
        userId: s.userId,
        amount: parseFloat((parseFloat(s.value) * rate).toFixed(2)),
      }));
    } else {
      return NextResponse.json(
        { error: 'Invalid splitType or missing custom splits data' },
        { status: 400 }
      );
    }

    // Run in a transaction
    const expense = await prisma.$transaction(async (tx) => {
      const createdExpense = await tx.expense.create({
        data: {
          groupId,
          description,
          amount: floatAmount,
          currency: currency || 'INR',
          exchangeRate: rate,
          paidById,
          date: expenseDate,
          splitType: splitType || 'EQUAL',
        },
      });

      await tx.expenseSplit.createMany({
        data: splitsToCreate.map(s => ({
          expenseId: createdExpense.id,
          userId: s.userId,
          amount: s.amount,
        })),
      });

      return createdExpense;
    });

    return NextResponse.json(expense, { status: 201 });
  } catch (error: any) {
    console.error('Create expense error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
