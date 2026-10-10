import { StartupDirectory } from "@/components/browse/StartupDirectory";

export default async function InvestorBrowseStartupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <StartupDirectory params={await searchParams} detailBase="/investor/startups" />;
}
