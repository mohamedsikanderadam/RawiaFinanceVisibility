import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

async function main() {
  const { db, schema } = await import("../src/db");
  const { importWorkbook, activateVersion } = await import("../src/lib/server/costing");

  const users = await db.$count(schema.users);
  if (users === 0) {
    const email = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
    const password = process.env.SEED_OWNER_PASSWORD ?? "";
    if (!email || password.length < 10) throw new Error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD (min 10 characters) to create the first owner.");
    await db.insert(schema.users).values({ email, name: process.env.SEED_OWNER_NAME || "Owner", role: "owner", passwordHash: await bcrypt.hash(password, 12) });
    console.log(`Created owner ${email}`);
  } else console.log(`${users} user(s) already exist; no owner created.`);

  const wb = process.env.SEED_WORKBOOK;
  const versions = await db.$count(schema.costingVersions);
  if (wb && versions === 0) {
    const file = path.resolve(wb);
    if (!existsSync(file)) throw new Error(`SEED_WORKBOOK not found: ${file}`);
    const v = await importWorkbook(readFileSync(file), path.basename(file), null, "Seeded from SEED_WORKBOOK");
    await activateVersion(v.id, "2000-01-01", null);
    console.log(`Imported and activated costing ${v.label}: ${v.snapshot.items.length} items, ${v.snapshot.menu.length} menu items, ${v.snapshot.issues.length} issues.`);
  } else if (versions > 0) console.log(`${versions} costing version(s) already exist; workbook not re-imported.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
