import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { sign } from '@/lib/jwt';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username/Email and password are required' },
        { status: 400 }
      );
    }

    const lookup = username.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: lookup },
          { name: { equals: username.trim(), mode: 'insensitive' } }
        ]
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username/email or password' },
        { status: 401 }
      );
    }

    const inputHash = hashPassword(password);
    if (inputHash !== user.passwordHash) {
      return NextResponse.json(
        { error: 'Invalid username/email or password' },
        { status: 401 }
      );
    }

    // Generate JWT token
    const { passwordHash, ...safeUser } = user;
    const token = sign({
      id: safeUser.id,
      name: safeUser.name,
      email: safeUser.email,
    });

    const response = NextResponse.json({
      message: 'Login successful',
      user: safeUser,
      token,
    });

    // Set secure HTTP-only cookie
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24, // 1 day
      path: '/',
    });

    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
