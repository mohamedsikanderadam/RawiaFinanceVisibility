import { createHash } from "node:crypto";
import {
  addr,
  colIndex,
  colLetter,
  findHeader,
  formulaRefs,
  levenshtein,
  loadWorkbook,
  nameVariants,
  normName,
  num,
  slug,
  text,
  type SheetGrid,
} from "./grid";
import { normalizeUnit } from "./units";
import type {
  AggregatorRate,
  CostingIssue,
  CostingSnapshot,
  CostItem,
  FixedExpense,
  MenuItem,
  PackagingLine,
  RecipeLine,
  SheetInfo,
} from "./types";
import { finalizeSnapshot } from "./snapshot";

type RawBomRow = {
  row: number;
  code: string | null;
  menuName: string | null;
  recipeType: string | null;
  ingredient: string | null;
  qty: number | null;
  qtyInvalid: boolean;
  unit: string | null;
  bomUnitCost: number | null;
  source: string;
};

function findSheet(sheets: SheetGrid[], test: (normalized: string) => boolean): SheetGrid | undefined {
  return sheets.find((s) => test(s.name.toLowerCase().replace(/[^a-z]+/g, " ").trim()));
}

class NameIndex<T> {
  private map = new Map<string, T>();
  private entries: { variants: string[]; value: T }[] = [];
  add(name: string, value: T, replace = false) {
    const variants = nameVariants(name);
    for (const v of variants) if (replace || !this.map.has(v)) this.map.set(v, value);
    this.entries.push({ variants, value });
  }
  exact(name: string): T | undefined {
    for (const v of nameVariants(name)) {
      const hit = this.map.get(v);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  /** Unique close match (edit distance ≤ 2 and ≤ 20% of length). */
  fuzzy(name: string): T | undefined {
    const q = normName(name);
    if (q.length < 5) return undefined;
    let best: { d: number; value: T } | null = null;
    let tie = false;
    for (const e of this.entries) {
      for (const v of e.variants) {
        const d = levenshtein(q, v);
        if (d > 2 || d > Math.floor(Math.max(q.length, v.length) * 0.2)) continue;
        if (!best || d < best.d) {
          best = { d, value: e.value };
          tie = false;
        } else if (d === best.d && best.value !== e.value) tie = true;
      }
    }
    return best && !tie ? best.value : undefined;
  }
}

export async function parseCostingWorkbook(buffer: Buffer, fileName: string): Promise<CostingSnapshot> {
  const sheets = await loadWorkbook(buffer);
  return parseCostingGrids(sheets, fileName, createHash("sha256").update(buffer).digest("hex"));
}

export function parseCostingGrids(sheets: SheetGrid[], fileName: string, sha256: string): CostingSnapshot {
  const issues: CostingIssue[] = [];
  const roles = new Map<string, string>();

  const ingSheet = findSheet(sheets, (n) => n.includes("ingredient") && n.includes("master"));
  const bomSheet = findSheet(sheets, (n) => n.includes("bom") || n.includes("recipe"));
  const menuSheet =
    findSheet(sheets, (n) => n.includes("menu master") && n.includes("packaging")) ??
    findSheet(sheets, (n) => n.includes("menu master"));
  const pkgSheet = findSheet(sheets, (n) => n.includes("packaging") && !n.includes("menu"));
  const fixedSheet = findSheet(sheets, (n) => n.includes("fixed"));
  const aggSheet = findSheet(sheets, (n) => n.includes("aggregator"));

  if (ingSheet) roles.set(ingSheet.name, "Ingredient Master");
  if (bomSheet) roles.set(bomSheet.name, "Recipe BOM");
  if (menuSheet) roles.set(menuSheet.name, "Menu Master (packaging)");
  if (pkgSheet) roles.set(pkgSheet.name, "Packaging price list");
  if (fixedSheet) roles.set(fixedSheet.name, "Fixed costs");
  if (aggSheet) roles.set(aggSheet.name, "Aggregator commissions");
  for (const s of sheets) {
    if (roles.has(s.name)) continue;
    const n = s.name.toLowerCase();
    if (n.includes("sales")) roles.set(s.name, "Sales history (import via Daily upload)");
    else if (n.includes("menu master")) roles.set(s.name, "Menu Master (food only, reference)");
    else if (n.includes("inventory")) roles.set(s.name, "Inventory tracker (reference, not imported)");
    else if (n.includes("supplier")) roles.set(s.name, "Supplier tracker (reference)");
  }

  for (const [label, sheet] of [
    ["Ingredient Master", ingSheet],
    ["Recipe BOM", bomSheet],
    ["Menu Master", menuSheet],
    ["Packaging price list", pkgSheet],
  ] as const) {
    if (!sheet) issues.push({ severity: "error", code: "sheet_missing", message: `No ${label} sheet was found in the workbook.` });
  }

  const items: CostItem[] = [];
  const itemIndex = new NameIndex<CostItem>();
  const byKey = new Map<string, CostItem>();
  const addItem = (it: CostItem) => {
    let key = it.key;
    let n = 2;
    while (byKey.has(key)) key = `${it.key}-${n++}`;
    it.key = key;
    items.push(it);
    byKey.set(key, it);
    return it;
  };

  // ---------- Packaging ----------
  const packagingByRow = new Map<number, CostItem>();
  if (pkgSheet) {
    const h = findHeader(
      pkgSheet,
      {
        item: /^item$/i,
        supplier: /supplier|manufacturer/i,
        qty: /^qty$/i,
        unitPrice: /^unit price$/i,
        unitPriceTax: /unit price.*tax/i,
      },
      ["item"],
    );
    if (!h) issues.push({ severity: "error", code: "header_missing", message: `Could not find the header row in ${pkgSheet.name}.` });
    else {
      for (let r = h.row + 1; r <= pkgSheet.rowCount; r++) {
        const name = text(pkgSheet.cell(r, h.cols.item!));
        if (!name) continue;
        const exVat = h.cols.unitPrice ? num(pkgSheet.cell(r, h.cols.unitPrice)).value : null;
        const incVat = h.cols.unitPriceTax ? num(pkgSheet.cell(r, h.cols.unitPriceTax)).value : null;
        const src = addr(pkgSheet.name, r, h.cols.item!);
        const short = name.split(" - ")[0].trim();
        const unitCost = incVat ?? null;
        const it = addItem({
          key: `pkg:${slug(short)}`,
          kind: "packaging",
          name: short,
          sku: name,
          supplier: h.cols.supplier ? text(pkgSheet.cell(r, h.cols.supplier)) : null,
          purchasePrice: incVat,
          purchaseQty: h.cols.qty ? num(pkgSheet.cell(r, h.cols.qty)).value : null,
          purchaseUnitLabel: "pcs",
          baseUnit: "pcs",
          unitCost: unitCost !== null ? String(unitCost) : null,
          unitCostExVat: exVat !== null ? String(exVat) : null,
          costStatus: unitCost !== null ? "ok" : "missing",
          costNote:
            unitCost !== null
              ? "Unit price including 5% VAT, as used by Menu Master."
              : "No unit price in the packaging list.",
          source: src,
        });
        packagingByRow.set(r, it);
        if (unitCost === null) {
          issues.push({
            severity: "info",
            code: "packaging_no_price",
            message: `Packaging row "${name}" has no unit price; it is kept for reference only.`,
            source: src,
            itemKey: it.key,
          });
        }
      }
    }
  }

  // ---------- BOM rows ----------
  const bomRows: RawBomRow[] = [];
  const bomByRow = new Map<number, RawBomRow>();
  if (bomSheet) {
    const h = findHeader(
      bomSheet,
      {
        code: /item\s*id/i,
        menuName: /menu\s*item/i,
        recipeType: /recipe\s*type/i,
        ingredient: /^ingredient/i,
        qtyUsed: /quantity\s*used/i,
        unit: /^unit/i,
        unitCost: /cost\s*per\s*unit/i,
      },
      ["menuName", "ingredient", "qtyUsed"],
    );
    if (!h) issues.push({ severity: "error", code: "header_missing", message: `Could not find the header row in ${bomSheet.name}.` });
    else {
      for (let r = h.row + 1; r <= bomSheet.rowCount; r++) {
        const menuName = text(bomSheet.cell(r, h.cols.menuName!));
        const ingredient = text(bomSheet.cell(r, h.cols.ingredient!));
        const code = h.cols.code ? text(bomSheet.cell(r, h.cols.code)) : null;
        if (!menuName && !ingredient && !code) continue;
        const qtyCell = bomSheet.cell(r, h.cols.qtyUsed!);
        const q = num(qtyCell);
        const row: RawBomRow = {
          row: r,
          code: code ? code.toUpperCase() : null,
          menuName,
          recipeType: h.cols.recipeType ? text(bomSheet.cell(r, h.cols.recipeType)) : null,
          ingredient,
          qty: q.value,
          qtyInvalid: q.invalid || (ingredient !== null && q.value === null),
          unit: h.cols.unit ? text(bomSheet.cell(r, h.cols.unit)) : null,
          bomUnitCost: h.cols.unitCost ? num(bomSheet.cell(r, h.cols.unitCost)).value : null,
          source: `${bomSheet.name}!row ${r}`,
        };
        bomRows.push(row);
        bomByRow.set(r, row);
      }
    }
  }

  // ---------- Ingredient Master ----------
  type PendingPrepared = { item: CostItem; bomRowRefs: number[]; formula: string };
  const pendingPrepared: PendingPrepared[] = [];
  if (ingSheet) {
    const h = findHeader(
      ingSheet,
      {
        name: /ingredient\s*name/i,
        sku: /sku/i,
        price: /^price$/i,
        qty: /^qty$/i,
        unit: /^unit$/i,
        cpu: /cost\s*per\s*unit/i,
        supplier: /supplier/i,
      },
      ["name", "price", "qty", "unit"],
    );
    if (!h) issues.push({ severity: "error", code: "header_missing", message: `Could not find the header row in ${ingSheet.name}.` });
    else {
      for (let r = h.row + 1; r <= ingSheet.rowCount; r++) {
        const name = text(ingSheet.cell(r, h.cols.name!));
        if (!name) continue;
        const src = addr(ingSheet.name, r, h.cols.name!);
        const priceCell = ingSheet.cell(r, h.cols.price!);
        const price = num(priceCell).value;
        const qty = num(ingSheet.cell(r, h.cols.qty!)).value;
        const unitLabel = text(ingSheet.cell(r, h.cols.unit!));
        const cpuCell = h.cols.cpu ? ingSheet.cell(r, h.cols.cpu) : null;
        const cpu = cpuCell ? num(cpuCell).value : null;
        const unit = normalizeUnit(unitLabel);
        const bomRefs = priceCell.f
          ? formulaRefs(priceCell.f)
              .filter((ref) => ref.sheet && bomSheet && ref.sheet === bomSheet.name)
              .map((ref) => ref.row)
          : [];
        const isPrepared = bomRefs.length > 0;

        let unitCost: string | null = null;
        let status: CostItem["costStatus"] = "missing";
        let note = "";
        const factor = unit?.factor ?? 1;
        if (cpu !== null && cpu > 0) {
          unitCost = String(cpu / factor);
          status = "ok";
          note = `Cost per unit from ${cpuCell?.f ? `formula =${cpuCell.f}` : "entered value"}${factor !== 1 ? ` ÷ ${factor} (${unitLabel}→${unit?.base})` : ""}.`;
          if (price !== null && qty !== null && qty > 0 && Math.abs(price / qty - cpu) > Math.abs(cpu) * 0.005) {
            issues.push({
              severity: "warning",
              code: "cost_inconsistent",
              message: `${name}: cost per unit ${cpu} differs from price ÷ qty (${price} ÷ ${qty} = ${(price / qty).toFixed(6)}). Using the cost-per-unit column.`,
              source: src,
            });
          }
        } else if (price !== null && price > 0 && qty !== null && qty > 0) {
          unitCost = String(price / qty / factor);
          status = "computed";
          note = `Cost-per-unit cell is blank; derived from the row's own price ÷ qty (${price} ÷ ${qty}).`;
          issues.push({
            severity: "info",
            code: "cost_computed",
            message: `${name}: cost-per-unit cell is blank (the workbook counts it as 0); using price ÷ qty = ${(price / qty).toFixed(6)} per ${unitLabel ?? "unit"}.`,
            source: src,
          });
        } else {
          note =
            price === null || price === 0
              ? "No purchase price in Ingredient Master."
              : "No usable quantity in Ingredient Master.";
        }
        if (!unit && unitLabel) {
          issues.push({
            severity: "error",
            code: "unit_unknown",
            message: `${name}: unit "${unitLabel}" is not recognised.`,
            source: src,
          });
        }
        const item: CostItem = {
          key: `${isPrepared ? "prep" : "ing"}:${slug(name)}`,
          kind: isPrepared ? "prepared" : "ingredient",
          name,
          sku: h.cols.sku ? text(ingSheet.cell(r, h.cols.sku)) : null,
          supplier: h.cols.supplier ? text(ingSheet.cell(r, h.cols.supplier)) : null,
          purchasePrice: price,
          purchaseQty: qty,
          purchaseUnitLabel: unitLabel,
          baseUnit: unit?.base ?? null,
          unitCost,
          costStatus: status,
          costNote: note,
          source: src,
        };
        const existing = itemIndex.exact(name);
        if (existing && normName(existing.name) === normName(name)) {
          const keepNew = existing.unitCost === null && unitCost !== null;
          issues.push({
            severity: "warning",
            code: "duplicate_ingredient",
            message: `"${name}" appears more than once in Ingredient Master (${existing.source} and ${src}). Using ${keepNew ? src : existing.source}.`,
            source: src,
          });
          if (!keepNew) continue;
          addItem(item);
          itemIndex.add(name, item, true);
        } else {
          addItem(item);
          itemIndex.add(name, item);
        }
        if (isPrepared) pendingPrepared.push({ item, bomRowRefs: bomRefs, formula: priceCell.f ?? "" });
        if (status === "missing" && !isPrepared) {
          issues.push({ severity: "warning", code: "cost_missing", message: `${name}: ${note}`, source: src, itemKey: item.key });
        }
      }
    }
  }

  // ---------- Menu Master ----------
  const menu: MenuItem[] = [];
  const menuByRow = new Map<number, MenuItem>();
  const menuIndex = new NameIndex<MenuItem>();
  const comboRows = new Map<MenuItem, number[]>();
  if (menuSheet) {
    const h = findHeader(
      menuSheet,
      {
        code: /item\s*id/i,
        name: /item\s*name/i,
        category: /category/i,
        dineIn: /selling.*dine/i,
        agg: /selling.*(talabat|deliveroo|aggregat)/i,
        cost: /^cost(?!.*packag)/i,
        costPkg: /cost\s*with\s*packag/i,
        status: /status/i,
      },
      ["code", "name", "cost"],
    );
    if (!h) issues.push({ severity: "error", code: "header_missing", message: `Could not find the header row in ${menuSheet.name}.` });
    else {
      const costColLetter = colLetter(h.cols.cost!);
      for (let r = h.row + 1; r <= menuSheet.rowCount; r++) {
        const code = text(menuSheet.cell(r, h.cols.code!));
        const name = text(menuSheet.cell(r, h.cols.name!));
        if (!code && !name) continue;
        const src = `${menuSheet.name}!row ${r}`;
        if (!code) {
          issues.push({ severity: "warning", code: "menu_no_id", message: `Menu row "${name}" has no Item ID and was skipped.`, source: src });
          continue;
        }
        const costCell = menuSheet.cell(r, h.cols.cost!);
        const pkgCell = h.cols.costPkg ? menuSheet.cell(r, h.cols.costPkg) : null;
        const item: MenuItem = {
          code: code.toUpperCase(),
          name: name ?? code,
          category: h.cols.category ? text(menuSheet.cell(r, h.cols.category)) : null,
          status: h.cols.status ? text(menuSheet.cell(r, h.cols.status)) : null,
          priceDineIn: h.cols.dineIn ? num(menuSheet.cell(r, h.cols.dineIn)).value : null,
          priceAggregator: h.cols.agg ? num(menuSheet.cell(r, h.cols.agg)).value : null,
          costMode: "no_recipe",
          recipe: [],
          components: [],
          packaging: null,
          totalOnlyCost: null,
          workbook: {
            foodCost: num(costCell).value,
            foodFormula: costCell.f,
            costWithPackaging: pkgCell ? num(pkgCell).value : null,
            packagingFormula: pkgCell?.f ?? null,
          },
          source: src,
        };
        const f = costCell.f ?? "";
        const refs = f ? formulaRefs(f) : [];
        if (/SUMIFS/i.test(f)) item.costMode = "recipe";
        else if (refs.length > 0 && refs.every((x) => !x.sheet && x.col === costColLetter)) item.costMode = "combo";
        else if (item.workbook.foodCost !== null && item.workbook.foodCost > 0) {
          item.costMode = "total_only";
          item.totalOnlyCost = item.workbook.foodCost;
        }
        if (item.costMode === "combo") comboRows.set(item, refs.map((x) => x.row));
        // Packaging from the "Cost with Packaging" formula.
        if (pkgCell?.f && pkgSheet) {
          const lines = new Map<number, number>();
          const other: string[] = [];
          for (const ref of formulaRefs(pkgCell.f)) {
            if (ref.sheet === pkgSheet.name) lines.set(ref.row, (lines.get(ref.row) ?? 0) + 1);
            else if (!(ref.sheet === null && ref.row === r && ref.col === costColLetter)) other.push(`${ref.sheet ? ref.sheet + "!" : ""}${ref.col}${ref.row}`);
          }
          const pk: PackagingLine[] = [];
          for (const [row, qty] of lines) {
            const p = packagingByRow.get(row);
            if (p) pk.push({ key: p.key, qty, source: `${src} (Cost with Packaging → ${pkgSheet.name}!G${row})` });
            else issues.push({ severity: "error", code: "packaging_ref_invalid", message: `${code}: packaging formula references ${pkgSheet.name} row ${row}, which has no item.`, source: src, menuCode: code });
          }
          if (other.length) {
            issues.push({ severity: "warning", code: "packaging_formula_unparsed", message: `${code}: packaging formula also references ${other.join(", ")}, which were ignored.`, source: src, menuCode: code });
          }
          item.packaging = pk;
        } else if (pkgCell && item.workbook.costWithPackaging !== null && item.workbook.costWithPackaging !== item.workbook.foodCost) {
          issues.push({ severity: "warning", code: "packaging_not_itemised", message: `${code} ${item.name}: packaging cost is a typed value, not an itemised formula; packaging items unavailable.`, source: src, menuCode: code });
        }
        menu.push(item);
        menuByRow.set(r, item);
        menuIndex.add(item.name, item);
      }
      // Resolve combo component rows.
      for (const m of menu) {
        const rows = comboRows.get(m);
        if (!rows) continue;
        const counts = new Map<string, number>();
        for (const row of rows) {
          const c = menuByRow.get(row);
          if (!c) {
            issues.push({ severity: "error", code: "combo_ref_invalid", message: `${m.code}: combo cost formula references menu row ${row}, which has no item.`, source: m.source, menuCode: m.code });
            continue;
          }
          counts.set(c.code, (counts.get(c.code) ?? 0) + 1);
        }
        m.components = [...counts].map(([code, qty]) => ({ code, qty }));
      }
    }
  }
  const menuByCode = new Map(menu.map((m) => [m.code, m]));

  // ---------- Resolve BOM ingredient names ----------
  const resolveLine = (raw: RawBomRow): RecipeLine => {
    const name = raw.ingredient ?? "";
    let ref: RecipeLine["ref"] = { type: "unresolved", name };
    let matchNote: string | undefined;
    const exactItem = itemIndex.exact(name);
    if (exactItem) ref = { type: "item", key: exactItem.key };
    else {
      const exactMenu = menuIndex.exact(name);
      if (exactMenu) ref = { type: "menu", code: exactMenu.code };
      else {
        const fz = itemIndex.fuzzy(name);
        if (fz) {
          ref = { type: "item", key: fz.key };
          matchNote = `Matched "${name}" to Ingredient Master "${fz.name}" by close spelling.`;
        } else {
          const fm = menuIndex.fuzzy(name);
          if (fm) {
            ref = { type: "menu", code: fm.code };
            matchNote = `Matched "${name}" to menu item ${fm.code} "${fm.name}" by close spelling.`;
          }
        }
      }
    }
    return { ref, rawName: name, qty: raw.qtyInvalid ? null : raw.qty, unit: raw.unit, bomUnitCost: raw.bomUnitCost, source: raw.source, matchNote };
  };

  const bomOnly = new Map<string, CostItem>();
  const materialize = (line: RecipeLine): RecipeLine => {
    if (line.ref.type !== "unresolved") return line;
    const key = normName(line.rawName.split("(")[0]) || normName(line.rawName);
    let it = bomOnly.get(key);
    const unit = normalizeUnit(line.unit);
    if (!it) {
      it = addItem({
        key: `bom:${slug(line.rawName)}`,
        kind: "ingredient",
        name: line.rawName,
        sku: null,
        supplier: null,
        purchasePrice: null,
        purchaseQty: null,
        purchaseUnitLabel: null,
        baseUnit: unit?.base ?? null,
        unitCost: null,
        costStatus: "missing",
        costNote: "Not listed in Ingredient Master.",
        source: line.source,
      });
      bomOnly.set(key, it);
      issues.push({
        severity: "warning",
        code: "ingredient_not_in_master",
        message: `BOM ingredient "${line.rawName}" is not in Ingredient Master.`,
        source: line.source,
        itemKey: it.key,
      });
    }
    return { ...line, ref: { type: "item", key: it.key } };
  };

  const linesFor = (rows: RawBomRow[]) =>
    rows.filter((r) => r.ingredient).map((r) => materialize(resolveLine(r)));

  for (const r of bomRows) {
    if (r.ingredient && r.qtyInvalid) {
      issues.push({
        severity: "error",
        code: "qty_invalid",
        message: `${r.code ?? r.menuName}: quantity for "${r.ingredient}" is not a number.`,
        source: r.source,
        menuCode: r.code ?? undefined,
      });
    }
  }

  // Menu recipes.
  const bomCodes = new Set<string>();
  for (const m of menu) {
    const rows = bomRows.filter((r) => r.code === m.code);
    if (rows.length) bomCodes.add(m.code);
    m.recipe = linesFor(rows);
    if (m.costMode === "recipe" && m.recipe.length === 0) {
      m.costMode = "no_recipe";
    }
    if (m.costMode === "no_recipe") {
      issues.push({ severity: "error", code: "recipe_missing", message: `${m.code} ${m.name}: no recipe or cost in the workbook.`, source: m.source, menuCode: m.code });
    }
    if (m.costMode === "total_only") {
      issues.push({
        severity: "warning",
        code: "allocation_unavailable",
        message: `${m.code} ${m.name}: workbook gives only a total cost (=${m.workbook.foodFormula ?? m.totalOnlyCost}); ingredient allocation unavailable.`,
        source: m.source,
        menuCode: m.code,
      });
    }
    if (m.costMode === "combo" && m.recipe.length > 0) {
      issues.push({
        severity: "info",
        code: "combo_bom_ignored",
        message: `${m.code} ${m.name}: combo cost comes from its components; ${m.recipe.length} BOM row(s) under this ID are shown for reference only.`,
        source: m.source,
        menuCode: m.code,
      });
    }
    if (m.packaging === null && m.costMode !== "no_recipe") {
      issues.push({ severity: "warning", code: "packaging_undefined", message: `${m.code} ${m.name}: workbook defines no packaging for this item.`, source: m.source, menuCode: m.code });
    }
  }
  for (const code of new Set(bomRows.map((r) => r.code).filter((c): c is string => !!c))) {
    if (!menuByCode.has(code)) {
      issues.push({ severity: "warning", code: "bom_unknown_id", message: `BOM uses Item ID ${code}, which is not in Menu Master.`, source: bomRows.find((r) => r.code === code)?.source });
    }
  }

  // Prepared items (sub-recipes referenced from Ingredient Master).
  const referencedBomRows = new Set<number>();
  for (const p of pendingPrepared) {
    const rows = p.bomRowRefs.map((r) => bomByRow.get(r)).filter((r): r is RawBomRow => !!r);
    p.bomRowRefs.forEach((r) => referencedBomRows.add(r));
    const recipeNames = [...new Set(rows.map((r) => r.menuName ?? ""))];
    const consistent = recipeNames.length === 1 && nameVariants(recipeNames[0]).some((v) => nameVariants(p.item.name).includes(v) || levenshtein(v, normName(p.item.name)) <= 2);
    const yieldQty = p.item.purchaseQty;
    if (!consistent) {
      p.item.unitCost = null;
      p.item.costStatus = "invalid";
      p.item.costNote = `Price formula =${p.formula} points at BOM rows for "${recipeNames.join(", ")}", not this sub-recipe.`;
      p.item.prepared = { yieldQty, inputs: [], breakdown: "unavailable", note: p.item.costNote };
      issues.push({ severity: "error", code: "subrecipe_formula_wrong", message: `${p.item.name}: ${p.item.costNote}`, source: p.item.source, itemKey: p.item.key });
    } else if (!yieldQty || yieldQty <= 0) {
      p.item.prepared = { yieldQty: null, inputs: linesFor(rows), breakdown: "unavailable", note: "Sub-recipe has no yield quantity." };
      p.item.unitCost = null;
      p.item.costStatus = "missing";
      issues.push({ severity: "error", code: "subrecipe_no_yield", message: `${p.item.name}: sub-recipe has no yield quantity.`, source: p.item.source, itemKey: p.item.key });
    } else {
      p.item.prepared = { yieldQty, inputs: linesFor(rows), breakdown: "available", note: `Batch of ${yieldQty} ${p.item.baseUnit ?? ""} from ${rows.length} BOM rows.` };
    }
  }

  // BOM blocks without an Item ID.
  const orphanRecipes: CostingSnapshot["orphanRecipes"] = [];
  const noIdGroups = new Map<string, RawBomRow[]>();
  for (const r of bomRows) {
    if (r.code || referencedBomRows.has(r.row) || !r.menuName) continue;
    const g = noIdGroups.get(r.menuName) ?? [];
    g.push(r);
    noIdGroups.set(r.menuName, g);
  }
  for (const [name, rows] of noIdGroups) {
    const isSub = rows.some((r) => /sub/i.test(r.recipeType ?? ""));
    const src = `${rows[0].source}–${rows[rows.length - 1].row}`;
    const lines = linesFor(rows);
    if (isSub) {
      const existing = itemIndex.exact(name) ?? itemIndex.fuzzy(name);
      if (existing) {
        issues.push({
          severity: "info",
          code: "subrecipe_unlinked",
          message: `BOM sub-recipe "${name}" (${src}) has no yield and is not linked to Ingredient Master "${existing.name}"; its rows are not used for costing.`,
          source: src,
          itemKey: existing.key,
        });
      } else {
        const it = addItem({
          key: `prep:${slug(name)}`,
          kind: "prepared",
          name,
          sku: null,
          supplier: null,
          purchasePrice: null,
          purchaseQty: null,
          purchaseUnitLabel: null,
          baseUnit: null,
          unitCost: null,
          costStatus: "missing",
          costNote: "BOM sub-recipe without a yield quantity; cost per unit unavailable.",
          source: src,
          prepared: { yieldQty: null, inputs: lines, breakdown: "unavailable", note: "No yield quantity." },
        });
        itemIndex.add(name, it);
        issues.push({ severity: "warning", code: "subrecipe_no_yield", message: `BOM sub-recipe "${name}" (${src}) has no yield quantity, so its cost per unit is unavailable.`, source: src, itemKey: it.key });
      }
    } else {
      orphanRecipes.push({ name, lines, source: src });
      issues.push({
        severity: "warning",
        code: "recipe_no_id",
        message: `BOM recipe "${name}" (${src}) has no Item ID, so it is not linked to any menu item.`,
        source: src,
      });
    }
  }

  // BOM-only cost fallback for ingredients missing a master cost.
  const allLines = [
    ...menu.flatMap((m) => m.recipe),
    ...items.flatMap((i) => i.prepared?.inputs ?? []),
  ];
  for (const it of items) {
    if (it.kind !== "ingredient" || it.unitCost !== null) continue;
    const costs = [...new Set(allLines.filter((l) => l.ref.type === "item" && l.ref.key === it.key && l.bomUnitCost && l.bomUnitCost > 0).map((l) => l.bomUnitCost as number))];
    if (costs.length === 1) {
      const lineUnit = allLines.find((l) => l.ref.type === "item" && l.ref.key === it.key)?.unit;
      const u = normalizeUnit(lineUnit);
      it.unitCost = String(costs[0] / (u?.factor ?? 1));
      it.baseUnit = it.baseUnit ?? u?.base ?? null;
      it.costStatus = "bom_only";
      it.costNote = `No Ingredient Master cost; using BOM "Cost per unit" ${costs[0]} per ${lineUnit ?? "unit"}.`;
      for (const i of issues) if (i.itemKey === it.key && (i.code === "cost_missing" || i.code === "ingredient_not_in_master")) i.message += " Using the BOM unit cost instead.";
    } else if (costs.length > 1) {
      issues.push({ severity: "warning", code: "bom_cost_conflict", message: `${it.name}: BOM rows show different unit costs (${costs.join(", ")}); cost left unavailable.`, itemKey: it.key });
    }
  }

  // ---------- Fixed costs ----------
  const fixedExpenses: FixedExpense[] = [];
  if (fixedSheet) {
    for (let r = 1; r <= fixedSheet.rowCount; r++) {
      for (let c = 1; c < Math.max(fixedSheet.colCount, 4); c++) {
        const name = text(fixedSheet.cell(r, c));
        if (!name || typeof fixedSheet.cell(r, c).v !== "string") continue;
        const amountCell = fixedSheet.cell(r, c + 1);
        const amount = num(amountCell).value;
        fixedExpenses.push({ name, monthly: amount, formula: amountCell.f, source: addr(fixedSheet.name, r, c) });
        break;
      }
    }
    for (const f of fixedExpenses.filter((x) => x.monthly === null)) {
      issues.push({ severity: "warning", code: "fixed_no_amount", message: `Fixed cost "${f.name}" has no monthly amount.`, source: f.source });
    }
  }

  // ---------- Aggregator commission rates ----------
  const aggregatorRates: AggregatorRate[] = [];
  if (aggSheet) {
    for (let r = 1; r <= Math.min(10, aggSheet.rowCount); r++) {
      for (let c = 1; c <= aggSheet.colCount; c++) {
        const t = text(aggSheet.cell(r, c));
        if (!t || !/commis/i.test(t)) continue;
        const f = aggSheet.cell(r + 1, c).f;
        const m = f?.match(/^\s*(\d+(?:\.\d+)?)%\s*\*\s*\$?([A-Z]{1,3})\$?\d+\s*$/);
        if (!m) continue;
        const baseCol = colIndex(m[2]);
        let channel: string | null = null;
        for (let rr = r - 1; rr >= 1 && !channel; rr--) channel = text(aggSheet.cell(rr, baseCol));
        if (!channel) continue;
        aggregatorRates.push({ channel, ratePct: Number(m[1]), formula: f!, source: addr(aggSheet.name, r + 1, c) });
      }
    }
  }

  const sheetInfo: SheetInfo[] = sheets.map((s) => ({
    name: s.name,
    state: s.state,
    rows: s.rowCount,
    cols: s.colCount,
    role: roles.get(s.name) ?? (s.state !== "visible" ? "Hidden sheet (ignored)" : null),
  }));

  return finalizeSnapshot({
    schemaVersion: 1,
    sourceFile: fileName,
    sourceSha256: sha256,
    parsedAt: new Date().toISOString(),
    sheets: sheetInfo,
    items,
    menu,
    fixedExpenses,
    aggregatorRates,
    orphanRecipes,
    issues,
  });
}
