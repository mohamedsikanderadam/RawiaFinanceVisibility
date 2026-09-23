import { desc, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { defaultSettings, settingsSchema, type Settings } from "../settings";
import type { CostingSnapshot } from "../costing/types";
import { audit, type Actor } from "./audit";

export type SettingsForDate = { id: number; effectiveFrom: string | null; value: Settings; isDefault: boolean };

export async function settingsFor(date: string, snap: CostingSnapshot | null): Promise<SettingsForDate> {
  const rows = await db
    .select()
    .from(schema.settingsVersions)
    .where(lte(schema.settingsVersions.effectiveFrom, date))
    .orderBy(desc(schema.settingsVersions.effectiveFrom), desc(schema.settingsVersions.id))
    .limit(1);
  const r = rows[0];
  if (r) return { id: r.id, effectiveFrom: r.effectiveFrom, value: settingsSchema.parse(r.value), isDefault: false };
  return { id: 0, effectiveFrom: null, value: defaultSettings(snap), isDefault: true };
}

export async function listSettingsVersions() {
  return db.select().from(schema.settingsVersions).orderBy(desc(schema.settingsVersions.effectiveFrom), desc(schema.settingsVersions.id));
}

export async function saveSettings(value: Settings, effectiveFrom: string, note: string, actor: Actor): Promise<number> {
  const parsed = settingsSchema.parse(value);
  const [row] = await db
    .insert(schema.settingsVersions)
    .values({ value: parsed, effectiveFrom, note, createdBy: actor?.id ?? null })
    .returning({ id: schema.settingsVersions.id });
  await audit(actor, "settings.save", "settings_version", row.id, { effectiveFrom, note, value: parsed });
  return row.id;
}
