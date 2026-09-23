import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken, verifySessionToken, type Role, type Session } from "../session-token";

export type Permission =
  | "view"
  | "view_finance"
  | "import"
  | "adjust"
  | "map"
  | "finalize"
  | "ledger"
  | "settings"
  | "costing"
  | "users"
  | "backup";

const GRANTS: Record<Role, Permission[]> = {
  owner: ["view", "view_finance", "import", "adjust", "map", "finalize", "ledger", "settings", "costing", "users", "backup"],
  manager: ["view", "view_finance", "import", "adjust", "map", "finalize", "ledger"],
  staff: ["view", "import", "adjust"],
  viewer: ["view", "view_finance"],
};

export function can(role: Role, p: Permission): boolean {
  return GRANTS[role].includes(p);
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const s = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, s.id)).limit(1);
  const u = rows[0];
  if (!u || !u.active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export class AuthError extends Error {}

/** For server actions and route handlers: throws when the caller lacks the permission. */
export async function requirePermission(p: Permission): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthError("Not signed in.");
  if (!can(s.role, p)) throw new AuthError("You do not have permission to do this.");
  return s;
}

/** For pages: redirects to login or home instead of throwing. */
export async function pageSession(p: Permission = "view"): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!can(s.role, p)) redirect("/?denied=1");
  return s;
}

export async function setSessionCookie(s: Session): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

const DUMMY_HASH = "$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

export async function verifyCredentials(email: string, password: string): Promise<Session | null> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase())).limit(1);
  const u = rows[0];
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok || !u.active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
