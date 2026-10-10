import { StartupDetailView } from "@/components/browse/StartupDetailView";

export default async function InvestorStartupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StartupDetailView id={id} backHref="/investor/startups" />;
}
