import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
    }
  }
}

// Validates a Supabase Auth JWT from the `Authorization: Bearer <token>` header.
// Supabase issues HS256-signed JWTs whose payload contains `sub` (user UUID)
// and `email`. We verify against SUPABASE_JWT_SECRET locally — no API roundtrip
// per request, just signature + expiry check.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Ikke autorisert" });
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error("SUPABASE_JWT_SECRET er ikke satt — kan ikke validere tokens");
    return res.status(500).json({ error: "Auth er ikke konfigurert på server" });
  }
  try {
    const decoded = jwt.verify(token, secret) as {
      sub: string;
      email?: string;
      aud?: string;
      exp?: number;
    };
    if (decoded.aud !== "authenticated") {
      return res.status(401).json({ error: "Ugyldig token (aud)" });
    }
    req.user = { id: decoded.sub, email: decoded.email };
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
