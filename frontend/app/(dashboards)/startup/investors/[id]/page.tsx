import { InvestorDetailView } from "@/components/browse/InvestorDetailView";

export default async function FounderInvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvestorDetailView investorId={id} backHref="/startup/investors" />;
}
