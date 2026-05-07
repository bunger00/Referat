import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
    }
  }
}

// Supabase signs auth JWTs with an ECC (P-256) key by default. The public key
// is published at <SUPABASE_URL>/auth/v1/.well-known/jwks.json. We fetch and
// cache it via jose's remote JWKS helper, then verify each token's signature
// locally — no API roundtrip per request.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const ISSUER = `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
const JWKS = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`))
  : null;

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Ikke autorisert" });
  }
  if (!JWKS) {
    console.error("SUPABASE_URL er ikke satt — kan ikke validere tokens");
    return res.status(500).json({ error: "Auth er ikke konfigurert på server" });
  }
  const token = authHeader.slice("Bearer ".length).trim();

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: "authenticated",
    });
    const sub = (payload as JWTPayload & { sub?: string; email?: string }).sub;
    if (!sub) {
      return res.status(401).json({ error: "Token mangler sub-claim" });
    }
    req.user = { id: sub, email: (payload as any).email };
    next();
  } catch (err: any) {
    return res.status(401).json({ error: "Ugyldig eller utløpt token" });
  }
}

// Use only inside requireAuth-protected routes — throws if user is missing.
export function getUserId(req: Request): string {
  if (!req.user?.id) throw new Error("getUserId called without auth");
  return req.user.id;
}
