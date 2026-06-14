import { NextRequest } from 'next/server';
import { verify } from './jwt';

export function getAuthUser(req: NextRequest): { id: string; name: string; email: string } | null {
  try {
    // 1. Try Authorization header
    const authHeader = req.headers.get('authorization');
    let token = '';
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      // 2. Try 'token' cookie
      const tokenCookie = req.cookies.get('token');
      if (tokenCookie) {
        token = tokenCookie.value;
      }
    }

    if (!token) return null;

    const payload = verify(token);
    if (!payload || !payload.id || !payload.name) {
      return null;
    }

    return {
      id: payload.id,
      name: payload.name,
      email: payload.email,
    };
  } catch (err) {
    console.error('getAuthUser helper error:', err);
    return null;
  }
}
