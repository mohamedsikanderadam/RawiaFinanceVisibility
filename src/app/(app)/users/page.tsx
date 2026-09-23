import { ActionForm, Submit } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createUserAction, updateUserAction } from "@/app/actions";
import { fmtStamp } from "@/lib/dates";
import { ROLES } from "@/lib/session-token";
import { pageSession } from "@/lib/server/auth";
import { listUsers } from "@/lib/server/users";

export const metadata = { title: "Users" };

const ROLE_HELP: Record<(typeof ROLES)[number], string> = {
  owner: "Everything, including costing, settings, users and backups.",
  manager: "Imports, adjustments, mappings, finalization, ledger and all financial views.",
  staff: "Upload sales and record staff meals, complimentary items and wastage. No financial figures.",
  viewer: "Read-only access to dashboards and reports.",
};

export default async function UsersPage() {
  const s = await pageSession("users");
  const users = await listUsers();
  return (
    <>
      <PageHeader title="Users and roles" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {users.map((u) => (
            <Card key={u.id}>
              <ActionForm action={updateUserAction} className="grid items-end gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
                <input type="hidden" name="id" value={u.id} />
                <div>
                  <div className="font-semibold">
                    {u.name} {u.id === s.id && <span className="text-xs text-ink-soft">(you)</span>}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {u.email} · added {fmtStamp(u.createdAt)}
                  </div>
                </div>
                <label>
                  <span className="label">Role</span>
                  <select name="role" defaultValue={u.role} className="input">
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 pb-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={u.active} /> Active
                </label>
                <label>
                  <span className="label">New password</span>
                  <input type="password" name="password" minLength={10} autoComplete="new-password" placeholder="unchanged" className="input" />
                </label>
                <Submit>Save</Submit>
              </ActionForm>
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card title="Add user">
            <ActionForm action={createUserAction} className="space-y-2" resetOnSuccess>
              <label className="block">
                <span className="label">Name</span>
                <input name="name" required className="input" />
              </label>
              <label className="block">
                <span className="label">Email</span>
                <input type="email" name="email" required className="input" />
              </label>
              <label className="block">
                <span className="label">Role</span>
                <select name="role" defaultValue="staff" className="input">
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Password (min 10 characters)</span>
                <input type="password" name="password" required minLength={10} autoComplete="new-password" className="input" />
              </label>
              <Submit>Add user</Submit>
            </ActionForm>
          </Card>
          <Card title="Roles">
            <dl className="space-y-2 text-sm">
              {ROLES.map((r) => (
                <div key={r}>
                  <dt className="font-semibold capitalize">{r}</dt>
                  <dd className="text-xs text-ink-soft">{ROLE_HELP[r]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
