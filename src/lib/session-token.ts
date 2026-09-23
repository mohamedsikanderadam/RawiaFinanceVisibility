import { SignJWT, jwtVerify } from "jose";

/** Edge-safe session token helpers (no database or Node-only imports); also used by proxy.ts. */
export const SESSION_COOKIE = "rawia_finance_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export const ROLES = ["owner", "manager", "staff", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export type Session = { id: number; email: string; name: string; role: Role };

const ROLE_SET = new Set<string>(ROLES);

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(s: Session): Promise<string> {
  return new SignJWT({ email: s.email, name: s.name, role: s.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(s.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    const { email, name, role } = payload;
    if (!Number.isInteger(id) || typeof email !== "string" || typeof name !== "string" || typeof role !== "string" || !ROLE_SET.has(role)) {
      return null;
    }
    return { id, email, name, role: role as Role };
  } catch {
    return null;
  }
}
