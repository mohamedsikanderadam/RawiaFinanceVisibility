import { saveMappingAction } from "@/app/actions";
import { ActionForm, Submit } from "./action-form";

export function MappingForm({
  posName,
  current,
  candidates,
  menu,
}: {
  posName: string;
  current: string | null;
  candidates: { code: string; name: string; score: number }[];
  menu: { code: string; name: string }[];
}) {
  const cand = new Set(candidates.map((c) => c.code));
  return (
    <ActionForm action={saveMappingAction} className="flex flex-wrap items-center gap-1" hideSuccess>
      <input type="hidden" name="posName" value={posName} />
      <select name="menuCode" defaultValue={current ?? candidates[0]?.code ?? ""} className="input w-auto max-w-[16rem] py-1 text-xs" aria-label={`Workbook item for ${posName}`}>
        <option value="">Choose workbook item…</option>
        {candidates.length > 0 && (
          <optgroup label="Suggested">
            {candidates.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code}) · {Math.round(c.score * 100)}%
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="All menu items">
          {menu
            .filter((m) => !cand.has(m.code))
            .map((m) => (
              <option key={m.code} value={m.code}>
                {m.name} ({m.code})
              </option>
            ))}
        </optgroup>
        <option value="__ignore">Ignore – not a stock item</option>
      </select>
      <input name="note" placeholder="Note" className="input w-28 py-1 text-xs" />
      <Submit className="btn btn-olive btn-sm">Save</Submit>
    </ActionForm>
  );
}
