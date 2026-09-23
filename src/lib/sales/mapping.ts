import type { CostingSnapshot } from "../costing/types";
import { levenshtein } from "../costing/grid";

export type MappingMatch = {
  menuCode: string | null;
  how: "saved" | "exact" | "suggested" | "none" | "ignored";
  candidates: { code: string; name: string; score: number }[];
};

const STOP = /\b(rawia|the|with|and|&)\b/g;

export function mappingKey(posName: string): string {
  return posName.trim().toLowerCase().replace(/\s+/g, " ");
}

function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/matcha/g, "macha")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(STOP, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(canon(s).split(" ").filter((t) => t.length > 1));
}

/**
 * Saved mappings win; otherwise an exact name match (ignoring case, punctuation and the "Rawia" prefix) is applied.
 * Anything else only produces suggestions that must be confirmed by a user.
 */
export function matchPosName(
  posName: string,
  snap: CostingSnapshot,
  saved: Map<string, { menuCode: string | null; ignored: boolean }>,
): MappingMatch {
  const s = saved.get(mappingKey(posName));
  const menu = snap.menu;
  if (s) {
    if (s.ignored) return { menuCode: null, how: "ignored", candidates: [] };
    if (s.menuCode && menu.some((m) => m.code === s.menuCode)) return { menuCode: s.menuCode, how: "saved", candidates: [] };
  }
  const c = canon(posName);
  const exact = menu.filter((m) => canon(m.name) === c || m.code.toLowerCase() === c);
  if (exact.length === 1) return { menuCode: exact[0].code, how: "exact", candidates: [] };
  const pt = tokens(posName);
  const scored = menu
    .map((m) => {
      const mt = tokens(m.name);
      const inter = [...pt].filter((t) => mt.has(t)).length;
      const jac = inter / Math.max(1, new Set([...pt, ...mt]).size);
      const lev = 1 - levenshtein(c, canon(m.name)) / Math.max(c.length, canon(m.name).length, 1);
      return { code: m.code, name: m.name, score: Math.max(jac, lev) };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return { menuCode: null, how: scored.length ? "suggested" : "none", candidates: scored };
}
