import { StartupDetailView } from "@/components/browse/StartupDetailView";

export default async function ConnectorStartupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StartupDetailView id={id} backHref="/connector/startups" />;
}
