import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const groups = await prisma.group.findMany({
      include: {
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(groups);
  } catch (error: any) {
    console.error('Fetch groups error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, memberIds } = await req.json();

    if (!name || !Array.isArray(memberIds) || memberIds.length === 0) {
      return NextResponse.json(
        { error: 'Group name and at least one member are required' },
        { status: 400 }
      );
    }

    const group = await prisma.group.create({
      data: {
        name,
        memberships: {
          create: memberIds.map((userId: string) => ({
            userId,
            joinedAt: new Date(),
          })),
        },
      },
      include: {
        memberships: {
          include: {
            user: true,
          },
        },
      },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error: any) {
    console.error('Create group error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
