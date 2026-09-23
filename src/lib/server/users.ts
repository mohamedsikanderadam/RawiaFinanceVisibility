import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ROLES, type Role } from "../session-token";
import { audit, type Actor } from "./audit";
import { hashPassword } from "./auth";

export async function listUsers() {
  return db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role, active: schema.users.active, createdAt: schema.users.createdAt })
    .from(schema.users)
    .orderBy(asc(schema.users.id));
}

function checkRole(role: string): Role {
  if (!(ROLES as readonly string[]).includes(role)) throw new Error("Unknown role.");
  return role as Role;
}

export async function createUser(input: { email: string; name: string; role: string; password: string }, actor: Actor): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("Enter a valid email.");
  if (input.password.length < 10) throw new Error("Password must be at least 10 characters.");
  const exists = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (exists[0]) throw new Error("A user with this email already exists.");
  const [row] = await db
    .insert(schema.users)
    .values({ email, name: input.name.trim() || email, role: checkRole(input.role), passwordHash: await hashPassword(input.password) })
    .returning({ id: schema.users.id });
  await audit(actor, "user.create", "user", row.id, { email, role: input.role });
  return row.id;
}

export async function updateUser(id: number, input: { role: string; active: boolean; password: string }, actor: Actor): Promise<void> {
  if (actor?.id === id && (!input.active || input.role !== "owner")) throw new Error("You cannot deactivate or demote yourself.");
  const set: Partial<typeof schema.users.$inferInsert> = { role: checkRole(input.role), active: input.active };
  if (input.password) {
    if (input.password.length < 10) throw new Error("Password must be at least 10 characters.");
    set.passwordHash = await hashPassword(input.password);
  }
  await db.update(schema.users).set(set).where(eq(schema.users.id, id));
  await audit(actor, "user.update", "user", id, { role: input.role, active: input.active, passwordReset: Boolean(input.password) });
}
