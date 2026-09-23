import Image from "next/image";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { getSession } from "@/lib/server/auth";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getSession()) redirect("/");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <main className="flex min-h-screen items-center justify-center bg-brown p-4">
      <div className="w-full max-w-sm rounded-2xl bg-cream p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-red">
          <Image src="/rawia-logo-red.svg" alt="RAWIA" width={180} height={62} priority className="h-14 w-auto" />
          <p className="text-sm font-semibold text-brown">Financial Controller</p>
        </div>
        <ActionForm action={loginAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" autoComplete="username" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          <Submit className="btn btn-primary w-full" pending="Signing in…">
            Sign in
          </Submit>
        </ActionForm>
      </div>
    </main>
  );
}
