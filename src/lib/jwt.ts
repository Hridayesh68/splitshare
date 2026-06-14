import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'splitshare-secret-key-2026-xyz';

function base64url(buf: Buffer | string): string {
  const base64 = typeof buf === 'string' ? Buffer.from(buf).toString('base64') : buf.toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function sign(payload: Record<string, any>, expiresInSeconds: number = 24 * 60 * 60): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const headerSegment = base64url(JSON.stringify(header));
  const payloadSegment = base64url(JSON.stringify(fullPayload));

  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(signingInput)
    .digest();
  
  const signatureSegment = base64url(signature);

  return `${signingInput}.${signatureSegment}`;
}

export function verify(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerSegment, payloadSegment, signatureSegment] = parts;
    const signingInput = `${headerSegment}.${payloadSegment}`;

    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(signingInput)
      .digest();
    const expectedSignatureSegment = base64url(expectedSignature);

    if (signatureSegment !== expectedSignatureSegment) {
      return null;
    }

    const payload = JSON.parse(base64urlDecode(payloadSegment));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Expired
    }

    return payload;
  } catch (error) {
    console.error('JWT verify error:', error);
    return null;
  }
}
