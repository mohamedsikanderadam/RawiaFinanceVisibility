import { isIsoDate } from "../dates";
import { AuthError, requirePermission, type Permission } from "./auth";
import type { Session } from "../session-token";

/** Route-handler wrapper: authenticates, authorizes and turns thrown errors into plain-text responses. */
export async function guarded(p: Permission, fn: (s: Session) => Promise<Response>): Promise<Response> {
  let s: Session;
  try {
    s = await requirePermission(p);
  } catch (e) {
    const signedIn = e instanceof AuthError && e.message !== "Not signed in.";
    return new Response(e instanceof Error ? e.message : "Unauthorized", { status: signedIn ? 403 : 401 });
  }
  try {
    return await fn(s);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Export failed.", { status: 400 });
  }
}

export function rangeParams(url: URL): { from: string; to: string } {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to") ?? from;
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error("from and to must be YYYY-MM-DD dates.");
  if (to < from) throw new Error("to must not be before from.");
  return { from, to };
}

export function download(body: Buffer | string, fileName: string, type: string): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const PDF = "application/pdf";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
