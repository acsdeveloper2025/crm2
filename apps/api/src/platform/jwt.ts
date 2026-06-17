import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { loadEnv } from '@crm2/config';

/**
 * JWT-pair signing/verification (ADR-0014). HS256 with JWT_SECRET.
 *  - access: stateless, claims { sub, role, typ:'access' }
 *  - refresh: claims { sub, jti, typ:'refresh' }; the jti is tracked server-side for rotation.
 */
const ALG = 'HS256';
const secret = (): Uint8Array => new TextEncoder().encode(loadEnv().JWT_SECRET);

export interface AccessClaims {
  userId: string;
  // open role catalog (ADR-0022) - the code is resolved to attributes per request, never name-checked
  role: string;
}
export interface RefreshClaims {
  userId: string;
  jti: string;
}

export async function signAccessToken(claims: AccessClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ role: claims.role, typ: 'access' })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

export async function signRefreshToken(claims: RefreshClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ typ: 'refresh' })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.userId)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

async function verify(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
  return payload;
}

/** Returns access claims or null when the token is invalid/expired/not an access token. */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const p = await verify(token);
    if (p['typ'] !== 'access' || typeof p.sub !== 'string' || typeof p['role'] !== 'string') return null;
    return { userId: p.sub, role: p['role'] };
  } catch {
    return null;
  }
}

/** Returns refresh claims or null when the token is invalid/expired/not a refresh token. */
export async function verifyRefreshToken(token: string): Promise<RefreshClaims | null> {
  try {
    const p = await verify(token);
    if (p['typ'] !== 'refresh' || typeof p.sub !== 'string' || typeof p.jti !== 'string') return null;
    return { userId: p.sub, jti: p.jti };
  } catch {
    return null;
  }
}
