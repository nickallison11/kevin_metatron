import { StartupDirectory } from "@/components/browse/StartupDirectory";

export const metadata = {
  title: "Startups — metatron",
  description: "Browse founders on metatron and see their Angel Score and community ratings.",
};

export default async function StartupsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <StartupDirectory params={await searchParams} detailBase="/startups" />;
}
