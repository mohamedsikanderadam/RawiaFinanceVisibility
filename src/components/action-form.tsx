"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Form bound to a server action; shows the returned message inline. */
export function ActionForm({
  action,
  children,
  className = "",
  confirm,
  hideSuccess,
  id,
  resetOnSuccess,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  hideSuccess?: boolean;
  id?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      id={id}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state && !(state.ok && hideSuccess) && (
        <p role="status" className={`mt-2 text-xs font-semibold ${state.ok ? "text-olive" : "text-red"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, className = "btn btn-primary", pending: pendingLabel }: { children: React.ReactNode; className?: string; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
