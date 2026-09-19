import { API_BASE } from "@/lib/api";
import { StartupPublicCard, type StartupPublicSummary } from "@/components/StartupPublicCard";

export const metadata = {
  title: "Startups — metatron",
  description: "Browse founders on metatron and see their Angel Score and community ratings.",
};

async function fetchStartups(searchParams: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  if (searchParams.sector) params.set("sector", searchParams.sector);
  if (searchParams.stage) params.set("stage", searchParams.stage);
  if (searchParams.country) params.set("country", searchParams.country);
  if (searchParams.sort) params.set("sort", searchParams.sort);

  try {
    const res = await fetch(`${API_BASE}/ratings/startups?${params.toString()}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return (await res.json()) as StartupPublicSummary[];
  } catch {
    return [];
  }
}

export default async function StartupsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const startups = await fetchStartups(params);

  return (
    <main className="min-w-0">
      <section className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Startups</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Browse founders on metatron — Angel Score and community ratings, side by side.
          </p>
        </div>

        <form
          method="GET"
          className="flex flex-wrap gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4"
        >
          <input
            name="sector"
            defaultValue={params.sector ?? ""}
            placeholder="Sector"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
          <input
            name="stage"
            defaultValue={params.stage ?? ""}
            placeholder="Stage"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
          <input
            name="country"
            defaultValue={params.country ?? ""}
            placeholder="Country (2-letter)"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
          <select
            name="sort"
            defaultValue={params.sort ?? "newest"}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)]"
          >
            <option value="newest">Newest</option>
            <option value="community_score">Community Score</option>
            <option value="angel_score">Angel Score</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-metatron-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
          >
            Filter
          </button>
        </form>

        {startups.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No startups found.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {startups.map((s) => (
              <StartupPublicCard key={s.user_id} startup={s} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
