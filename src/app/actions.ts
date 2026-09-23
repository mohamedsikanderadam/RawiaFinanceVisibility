"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LEDGER_TYPES } from "@/db/schema";
import { isIsoDate } from "@/lib/dates";
import type { CostingOverride } from "@/lib/costing/snapshot";
import { PREP_STATES, settingsSchema } from "@/lib/settings";
import { audit, type Actor } from "@/lib/server/audit";
import { AuthError, clearSessionCookie, getSession, requirePermission, setSessionCookie, verifyCredentials, type Permission } from "@/lib/server/auth";
import { activateVersion, archiveVersion, deriveVersion, getVersion, importWorkbook } from "@/lib/server/costing";
import { addAdjustment, finalizeDay, setDecision, voidAdjustment } from "@/lib/server/day";
import { addLedgerEntry, voidLedgerEntry } from "@/lib/server/ledger";
import { commitImport, createPreview, deleteMapping, discardImport, saveMapping } from "@/lib/server/sales";
import { saveSettings } from "@/lib/server/settings";
import { createUser, updateUser } from "@/lib/server/users";

export type ActionState = { ok: boolean; message: string } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const date = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!isIsoDate(v)) throw new Error("Choose a valid date.");
  return v;
};
const decimal = (v: string, what: string, allowNegative = false) => {
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`${what} must be a number.`);
  if (!allowNegative && v.startsWith("-")) throw new Error(`${what} must not be negative.`);
  return v;
};

/** Wraps a mutation: authorizes inside the action, converts errors into a message. */
async function run(p: Permission, fn: (actor: NonNullable<Actor>) => Promise<string>, paths: string[] = ["/"]): Promise<ActionState> {
  try {
    const s = await requirePermission(p);
    const msg = await fn({ id: s.id, name: s.name });
    for (const path of paths) revalidatePath(path, "layout");
    return { ok: true, message: msg };
  } catch (e) {
    if (e instanceof Error && (e.message === "NEXT_REDIRECT" || "digest" in e)) throw e;
    return { ok: false, message: e instanceof AuthError || e instanceof Error ? e.message : "Something went wrong." };
  }
}

// ---------- auth ----------

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email");
  const s = await verifyCredentials(email, String(fd.get("password") ?? ""));
  if (!s) {
    await audit(null, "auth.login_failed", "user", null, { email: email.toLowerCase() });
    return { ok: false, message: "Email or password is incorrect." };
  }
  await setSessionCookie(s);
  await audit({ id: s.id, name: s.name }, "auth.login", "user", s.id);
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction(): Promise<void> {
  const s = await getSession();
  if (s) await audit({ id: s.id, name: s.name }, "auth.logout", "user", s.id);
  await clearSessionCookie();
  redirect("/login");
}

// ---------- sales import ----------

export async function uploadSalesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await run("import", async (actor) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV or Excel sales file.");
    if (!/\.(csv|xlsx|xlsm)$/i.test(file.name)) throw new Error("Only .csv and .xlsx files are supported.");
    const scope = str(fd, "scope") === "all_dates" ? "all_dates" : "selected_date";
    const d = scope === "selected_date" ? date(fd, "date") : isIsoDate(str(fd, "date")) ? str(fd, "date") : null;
    id = await createPreview(Buffer.from(await file.arrayBuffer()), file.name, d, scope, actor);
    return "Preview ready.";
  }, []);
  if (res?.ok) redirect(`/upload/${id}`);
  return res;
}

export async function saveMappingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("map", async (actor) => {
    const posName = str(fd, "posName");
    const choice = str(fd, "menuCode");
    if (!posName) throw new Error("Missing POS name.");
    if (!choice) throw new Error("Choose a workbook item.");
    await saveMapping(posName, choice === "__ignore" ? null : choice, choice === "__ignore", str(fd, "note"), actor);
    return choice === "__ignore" ? `"${posName}" will be ignored.` : `"${posName}" mapped.`;
  });
}

export async function deleteMappingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("map", async (actor) => {
    await deleteMapping(str(fd, "posName"), actor);
    return "Mapping removed.";
  });
}

export async function commitImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "/";
  const res = await run("import", async (actor) => {
    const id = Number(str(fd, "importId"));
    const r = await commitImport(id, { changedPolicy: str(fd, "changedPolicy") === "replace" ? "replace" : "keep", includePossible: fd.getAll("includePossible").map(String) }, actor);
    target = r.dates.length === 1 ? `/day/${r.dates[0]}?imported=${r.inserted + r.replaced}` : `/upload?committed=${id}`;
    return `Imported ${r.inserted} new and ${r.replaced} replaced orders; ${r.skipped} skipped.`;
  });
  if (res?.ok) redirect(target);
  return res;
}

export async function discardImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await run("import", async (actor) => {
    await discardImport(Number(str(fd, "importId")), actor);
    return "Import discarded.";
  });
  if (res?.ok) redirect("/upload");
  return res;
}

// ---------- day ----------

const ADJ_TYPES = ["staff_meal", "complimentary", "wastage", "batch_count", "manual_cost"] as const;

export async function addAdjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("adjust", async (actor) => {
    const businessDate = date(fd, "date");
    const type = z.enum(ADJ_TYPES).parse(str(fd, "type"));
    const note = str(fd, "note");
    const target = str(fd, "target");
    const qty = str(fd, "qty");
    const amount = str(fd, "amount");
    if (type === "batch_count") {
      if (!/^\d+$/.test(qty)) throw new Error("Batch count must be a whole number (0 = not prepared today).");
      await addAdjustment({ businessDate, type, menuCode: null, itemKey: null, qty, amount: null, note: note || (qty === "0" ? "Not prepared today" : `${qty} batch(es)`) }, actor);
      return qty === "0" ? "Karak marked as not prepared." : `Karak batches set to ${qty}.`;
    }
    if (type === "manual_cost") {
      if (!note) throw new Error("Describe the manual adjustment.");
      await addAdjustment({ businessDate, type, menuCode: null, itemKey: target.startsWith("item:") ? target.slice(5) : null, qty: "1", amount: decimal(amount, "Amount", true), note }, actor);
      return "Manual adjustment added.";
    }
    if (!target) throw new Error("Choose a menu item or ingredient.");
    decimal(qty, "Quantity");
    if (Number(qty) <= 0) throw new Error("Quantity must be more than zero.");
    await addAdjustment(
      {
        businessDate,
        type,
        menuCode: target.startsWith("menu:") ? target.slice(5) : null,
        itemKey: target.startsWith("item:") ? target.slice(5) : null,
        qty,
        amount: null,
        note,
      },
      actor,
    );
    return "Adjustment added.";
  });
}

export async function voidAdjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("adjust", async (actor) => {
    await voidAdjustment(Number(str(fd, "id")), actor);
    return "Adjustment removed.";
  });
}

export async function setDecisionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("adjust", async (actor) => {
    const prep = z.enum(PREP_STATES).parse(str(fd, "prep"));
    await setDecision(str(fd, "orderKey"), prep, str(fd, "note"), actor);
    return "Preparation status saved.";
  });
}

export async function finalizeDayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("finalize", async (actor) => {
    const d = date(fd, "date");
    const rev = await finalizeDay(d, str(fd, "reason"), actor);
    return rev === 1 ? "Day finalized." : `Revision ${rev} finalized.`;
  });
}

// ---------- ledger ----------

export async function addLedgerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("ledger", async (actor) => {
    const type = z.enum(LEDGER_TYPES).parse(str(fd, "type"));
    const account = z.enum(["cash", "bank", "none"]).parse(type === "liabilities_statement" ? "none" : str(fd, "account"));
    await addLedgerEntry(
      {
        entryDate: date(fd, "entryDate"),
        type,
        account,
        amount: decimal(str(fd, "amount"), "Amount", type === "adjustment"),
        counterparty: str(fd, "counterparty") || null,
        fromReserve: fd.get("fromReserve") === "on",
        description: str(fd, "description"),
      },
      actor,
    );
    return "Ledger entry recorded.";
  });
}

export async function voidLedgerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("ledger", async (actor) => {
    await voidLedgerEntry(Number(str(fd, "id")), actor);
    return "Entry voided.";
  });
}

// ---------- costing ----------

export async function importWorkbookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await run("costing", async (actor) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose the costing workbook (.xlsx).");
    if (!/\.xlsx$/i.test(file.name)) throw new Error("Only .xlsx workbooks are supported.");
    const v = await importWorkbook(Buffer.from(await file.arrayBuffer()), file.name, actor, str(fd, "note"));
    id = v.id;
    return `Imported ${v.label}.`;
  });
  if (res?.ok) redirect(`/costing/${id}`);
  return res;
}

export async function addOverrideAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await run("costing", async (actor) => {
    const from = Number(str(fd, "versionId"));
    const itemKey = str(fd, "itemKey");
    const kind = str(fd, "kind");
    const note = str(fd, "note");
    if (!note) throw new Error("Add a note explaining the correction.");
    const base = await getVersion(from);
    if (!base) throw new Error("Costing version not found.");
    if (!base.snapshot.items.some((i) => i.key === itemKey)) throw new Error("Unknown item.");
    const o: CostingOverride = kind === "zero" ? { type: "item_zero", itemKey, note } : { type: "item_cost", itemKey, unitCost: decimal(str(fd, "unitCost"), "Unit cost"), note };
    const v = await deriveVersion(from, [o], note, actor);
    id = v.id;
    return `Created ${v.label} (draft). Activate it to use the correction.`;
  });
  if (res?.ok) redirect(`/costing/${id}`);
  return res;
}

export async function activateVersionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("costing", async (actor) => {
    await activateVersion(Number(str(fd, "id")), date(fd, "effectiveFrom"), actor);
    return "Costing version activated. Finalized days keep the version they were finalized with.";
  });
}

export async function archiveVersionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("costing", async (actor) => {
    await archiveVersion(Number(str(fd, "id")), actor);
    return "Costing version archived.";
  });
}

// ---------- settings ----------

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("settings", async (actor) => {
    let raw: unknown;
    try {
      raw = JSON.parse(str(fd, "settings"));
    } catch {
      throw new Error("Settings could not be read.");
    }
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid settings: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    await saveSettings(parsed.data, date(fd, "effectiveFrom"), str(fd, "note"), actor);
    return "Settings saved. Finalized days are not changed; revise them to apply the new settings.";
  });
}

// ---------- users ----------

export async function createUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("users", async (actor) => {
    await createUser({ email: str(fd, "email"), name: str(fd, "name"), role: str(fd, "role"), password: String(fd.get("password") ?? "") }, actor);
    return "User created.";
  });
}

export async function updateUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run("users", async (actor) => {
    await updateUser(Number(str(fd, "id")), { role: str(fd, "role"), active: fd.get("active") === "on", password: String(fd.get("password") ?? "") }, actor);
    return "User updated.";
  });
}
