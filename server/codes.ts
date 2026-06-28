// =============================================================================
// server/codes.ts — short, human-friendly identifiers.
//  - game codes: 6 chars, uppercase, from an UNAMBIGUOUS alphabet (no 0/O/1/I)
//    so they're easy to read aloud and type. ~1.07e9 possibilities.
//  - tokens: opaque per-player secrets used to authorize that player's actions.
// Uses crypto.randomInt for unbiased selection.
// =============================================================================
import { randomInt, randomBytes } from 'node:crypto';

// Crockford-ish: dropped 0/O/1/I/L to avoid read-aloud confusion.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function makeCode(length = CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

// Normalize user-typed codes: strip whitespace and uppercase. The alphabet
// already excludes ambiguous glyphs (0/O/1/I/L), so codes never contain them and
// no further folding is needed — keeping this lossless avoids corrupting input.
export function normalizeCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isWellFormedCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export function makeToken(): string {
  return randomBytes(24).toString('base64url');
}

export function makePlayerId(): string {
  return 'p_' + randomBytes(6).toString('hex');
}
