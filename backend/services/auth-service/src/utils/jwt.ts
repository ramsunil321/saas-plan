// =============================================================================
// JWT UTILITIES — Access and Refresh Token management
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   All JWT logic is centralized here. If we need to change the signing
//   algorithm, add a new claim, or rotate secrets, there's ONE place to edit.
//
// HOW JWT WORKS (important for interviews):
//   A JWT has 3 parts: Header.Payload.Signature (base64url encoded, dot-separated)
//
//   Header:  { alg: "HS256", typ: "JWT" }
//   Payload: { sub: "userId", email: "...", iat: 1234, exp: 1234 }
//   Signature: HMAC_SHA256(base64(Header) + "." + base64(Payload), SECRET)
//
//   The server SIGNS the token with a secret. When the token comes back,
//   the server VERIFIES the signature. If anything in the payload was tampered
//   with, the signature won't match → token rejected.
//
//   Key insight: JWT is NOT encrypted by default (just base64 encoded).
//   Anyone can decode the payload and READ it. Don't put sensitive data in JWT.
//   It IS signed — so it can't be FORGED without the secret.
//
// TOKEN STRATEGY:
//   Access Token  (15 min): Short-lived, sent in Authorization header on every request
//   Refresh Token (7 days): Long-lived, stored in httpOnly cookie, used ONLY to get new access tokens
//
//   WHY TWO TOKENS?
//   - If we only used access tokens: long expiry = security risk if stolen
//   - If we used only one long-lived token: can't easily revoke without a DB check
//   - Two tokens: short access token limits damage if stolen (expires fast),
//     refresh token stored in httpOnly cookie (inaccessible to JavaScript = XSS safe)
//
// INTERVIEW QUESTION:
//   "What is the difference between HS256 and RS256?"
//   Answer: HS256 uses a single shared secret for both signing and verification.
//   All services must share the secret. RS256 uses a private key to SIGN and a
//   public key to VERIFY. The private key stays on the auth server; other services
//   only need the public key. RS256 is better for microservices — no secret sharing.
//   We use HS256 here for simplicity; in production microservices, use RS256.
// =============================================================================

import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { UnauthorizedError } from './errors';

// =============================================================================
// TOKEN PAYLOAD INTERFACES
// =============================================================================

// What we put INSIDE the access token
// Keep this minimal — avoid PII (email is ok, don't put full user object)
export interface AccessTokenPayload {
  sub: string;           // Subject — the user's UUID
  email: string;
  organizationId?: string; // Current active organization (set after org selection)
  role?: string;         // Role within the organization
}

// What we put INSIDE the refresh token
// Minimal payload — refresh tokens only need to identify the user + token record
export interface RefreshTokenPayload {
  sub: string;   // User UUID
  jti: string;   // JWT ID — unique ID for THIS token (enables per-token revocation)
  type: 'refresh'; // Prevent refresh tokens from being used as access tokens
}

// The full decoded payload (includes JWT registered claims: iat, exp)
export type DecodedAccessToken = AccessTokenPayload & JwtPayload;
export type DecodedRefreshToken = RefreshTokenPayload & JwtPayload;

// =============================================================================
// ACCESS TOKEN
// =============================================================================

export const generateAccessToken = (payload: AccessTokenPayload): string => {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as string,
    algorithm: 'HS256',
    issuer: 'flowforge-auth',   // Who issued this token
    audience: 'flowforge-api',  // Who should accept this token
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
};

export const verifyAccessToken = (token: string): DecodedAccessToken => {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'flowforge-auth',
      audience: 'flowforge-api',
    }) as DecodedAccessToken;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid access token');
    }
    throw new UnauthorizedError('Token verification failed');
  }
};

// =============================================================================
// REFRESH TOKEN
// =============================================================================

export interface GeneratedRefreshToken {
  token: string; // The actual JWT string to send to the client
  jti: string;   // The unique ID — store its HASH in the database
}

export const generateRefreshToken = (userId: string): GeneratedRefreshToken => {
  // jti (JWT ID) is a UUID — unique identifier for THIS token
  // We store SHA-256(jti) in the database, not the full token
  const jti = uuidv4();

  const payload: RefreshTokenPayload = {
    sub: userId,
    jti,
    type: 'refresh',
  };

  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as string,
    algorithm: 'HS256',
    issuer: 'flowforge-auth',
    // Different audience from access token — prevents cross-use
    audience: 'flowforge-auth-refresh',
  };

  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, options);

  return { token, jti };
};

export const verifyRefreshToken = (token: string): DecodedRefreshToken => {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
      issuer: 'flowforge-auth',
      audience: 'flowforge-auth-refresh',
    }) as DecodedRefreshToken;

    // Extra safety check — make sure this is actually a refresh token
    if (decoded.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }

    return decoded;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }
    throw new UnauthorizedError('Invalid refresh token');
  }
};

// Decode without verification — useful for logging/debugging only
// NEVER use this for authentication decisions
export const decodeTokenUnsafe = (token: string): JwtPayload | null => {
  return jwt.decode(token) as JwtPayload | null;
};

// Calculate token expiry as a Date object (for storing in DB)
export const getTokenExpiryDate = (expiresIn: string): Date => {
  const now = Date.now();
  // Parse "7d", "15m", "1h" into milliseconds
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiresIn format: ${expiresIn}`);
  const [, amount, unit] = match;
  return new Date(now + parseInt(amount) * multipliers[unit]);
};
