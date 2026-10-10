import { StartupDetailView, fetchStartupDetail } from "@/components/browse/StartupDetailView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchStartupDetail(id);
  const name = data?.profile.company_name ?? "Startup";
  return {
    title: `${name} — metatron`,
    description: data?.profile.one_liner ?? `${name} on metatron.`,
  };
}

export default async function StartupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StartupDetailView id={id} backHref="/startups" />;
}
