// =============================================================================
// CRYPTO UTILITIES — Secure token generation and hashing
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Two separate needs:
//   1. Generate unpredictable, cryptographically secure random tokens
//      (for email verification, password reset links)
//   2. Hash tokens before storing in the database
//      (so stolen DB records can't be replayed)
//
// HOW IT WORKS:
//   - crypto.randomBytes(n): Node.js built-in CSPRNG (cryptographically secure
//     pseudo-random number generator). Uses OS entropy sources (/dev/urandom on Linux).
//     This is DIFFERENT from Math.random() which is NOT cryptographically secure.
//   - SHA-256: deterministic, fast, one-way hash. Given token → always same hash.
//     Given hash → cannot recover token. Used for storing refresh tokens in DB.
//
// INTERVIEW QUESTION:
//   "Why not use Math.random() for tokens?"
//   Answer: Math.random() is predictable — given the seed and algorithm,
//   an attacker could enumerate possible values. crypto.randomBytes() uses
//   system entropy (hardware events, timing variations) that cannot be predicted.
//   For security tokens, ALWAYS use a CSPRNG.
//
// INTERVIEW QUESTION:
//   "Why hash the refresh token before storing it?"
//   Answer: Defense in depth. If the database is compromised (SQL injection,
//   backup leak), the attacker gets hashed values. SHA-256 is one-way — they
//   can't reverse the hash to get the actual token. Combined with the token
//   being a random 64-byte value, brute force is computationally infeasible.
//   Same reason passwords are stored as bcrypt hashes.
// =============================================================================

import crypto from 'crypto';

// Generate a cryptographically secure random token
// Default: 32 bytes → 64 hex characters (256 bits of entropy)
export const generateSecureToken = (byteLength = 32): string => {
  return crypto.randomBytes(byteLength).toString('hex');
};

// Hash a token with SHA-256 for database storage
// SHA-256 produces a 64-character hex string (256-bit hash)
export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Compare a plain token against its stored hash (timing-safe)
// IMPORTANT: Use crypto.timingSafeEqual to prevent timing attacks
//
// INTERVIEW QUESTION: "What is a timing attack?"
// Answer: If comparison short-circuits on first different character,
// an attacker can measure response time to infer how many characters matched.
// timingSafeEqual always takes the same time regardless of where strings differ.
export const verifyTokenHash = (plainToken: string, storedHash: string): boolean => {
  const computedHash = hashToken(plainToken);
  // Both buffers must be the same length for timingSafeEqual
  const hashBuffer = Buffer.from(storedHash, 'hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');

  if (hashBuffer.length !== computedBuffer.length) return false;

  return crypto.timingSafeEqual(hashBuffer, computedBuffer);
};

// Generate a random 6-digit OTP (for future SMS/email OTP feature)
export const generateOTP = (): string => {
  const otp = crypto.randomInt(100000, 999999);
  return otp.toString();
};
