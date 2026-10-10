import { StartupDirectory } from "@/components/browse/StartupDirectory";

export default async function ConnectorBrowseStartupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <StartupDirectory params={await searchParams} detailBase="/connector/startups" />;
}
