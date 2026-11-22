import { PrototypeFrame } from "./prototype-frame";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ scan_id?: string; lang?: string }>;
}) {
  const { scan_id: scanId, lang } = await searchParams;
  const params = new URLSearchParams();
  if (scanId) params.set("scan_id", scanId);
  if (lang) params.set("lang", lang);
  const prototypeUrl = `/Locatelly-prototype.html${params.size ? `?${params}` : ""}`;

  return (
    <main className="app-shell">
      <PrototypeFrame src={prototypeUrl} />
    </main>
  );
}
