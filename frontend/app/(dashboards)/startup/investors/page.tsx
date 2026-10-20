import { InvestorDirectory } from "@/components/browse/InvestorDirectory";

export default function FounderBrowseInvestorsPage() {
  return <InvestorDirectory detailBase="/startup/investors" upgradeHref="/startup/settings/subscription" />;
}
