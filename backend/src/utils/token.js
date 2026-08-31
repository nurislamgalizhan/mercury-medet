import jwt from 'jsonwebtoken';

const DEFAULT_EXPIRES_IN = '30d';

export function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN }
  );
}

// Sliding sessions: once a token is past the halfway point of its own lifetime,
// the request handler hands back a fresh one, so anyone who keeps using the site
// is never logged out. Someone who stays away longer than the full window still
// has to sign in again.
export function shouldRenewToken(payload, now = Date.now()) {
  const exp = Number(payload?.exp);
  const iat = Number(payload?.iat);
  if (!Number.isFinite(exp) || !Number.isFinite(iat)) return false;

  const lifetime = exp - iat;
  if (lifetime <= 0) return false;

  const secondsLeft = exp - Math.floor(now / 1000);
  return secondsLeft > 0 && secondsLeft < lifetime / 2;
}
