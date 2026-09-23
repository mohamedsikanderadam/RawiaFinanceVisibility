import { Alert, Card, PageHeader } from "@/components/ui";
import { SettingsEditor } from "@/components/settings-editor";
import { dubaiToday, fmtStamp } from "@/lib/dates";
import { pageSession } from "@/lib/server/auth";
import { costingFor } from "@/lib/server/costing";
import { listSettingsVersions, settingsFor } from "@/lib/server/settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await pageSession("settings");
  const today = dubaiToday();
  const costing = await costingFor(today);
  const [current, versions] = await Promise.all([settingsFor(today, costing?.snapshot ?? null), listSettingsVersions()]);
  const menu = costing?.snapshot.menu.map((m) => ({ code: m.code, name: m.name })) ?? [];
  return (
    <>
      <PageHeader title="Settings" sub="Effective-dated. Saving creates a new version from the chosen date; earlier days and finalized reports keep the settings they used." />
      {current.isDefault && (
        <div className="mb-4">
          <Alert tone="warning">Using defaults derived from the costing workbook. Review and save to confirm them; unconfirmed rates are labelled as estimates in reports.</Alert>
        </div>
      )}
      <SettingsEditor key={current.id} initial={current.value} today={today} karakOptions={menu} />
      <Card title="Settings history" className="mt-4">
        {versions.length === 0 ? (
          <p className="text-sm text-ink-soft">No saved versions yet.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Effective from</th>
                <th>Reason</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.id}</td>
                  <td>{v.effectiveFrom}</td>
                  <td>{v.note}</td>
                  <td className="text-xs">{fmtStamp(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
