import { API_BASE } from "@/lib/api";
import { StartupPublicCard, type StartupPublicSummary } from "@/components/StartupPublicCard";

export type DirectoryParams = Record<string, string | undefined>;

async function fetchStartups(searchParams: DirectoryParams) {
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

const field =
  "min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]";

/**
 * Browse Startups — shared by the public /startups page and the in-app
 * investor/connector pages. `detailBase` is where each card links
 * (e.g. "/investor/startups"), so in-app browsing keeps the left nav.
 */
export async function StartupDirectory({
  params,
  detailBase,
}: {
  params: DirectoryParams;
  detailBase: string;
}) {
  const startups = await fetchStartups(params);

  return (
    <main className="min-w-0">
      <section className="mx-auto flex max-w-6xl flex-col gap-6 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Browse Startups</span>
          <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text)]">Every startup on metatron</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Two scores side by side: Kevin&apos;s Angel Score and the community&apos;s rating.
          </p>
        </header>

        <form method="GET" className="flex flex-wrap gap-2.5">
          <label className="sr-only" htmlFor="dir-sector">Sector</label>
          <input id="dir-sector" name="sector" defaultValue={params.sector ?? ""} placeholder="Sector" className={`${field} flex-1 basis-40`} />
          <label className="sr-only" htmlFor="dir-stage">Stage</label>
          <input id="dir-stage" name="stage" defaultValue={params.stage ?? ""} placeholder="Stage" className={`${field} flex-1 basis-32`} />
          <label className="sr-only" htmlFor="dir-country">Country</label>
          <input id="dir-country" name="country" defaultValue={params.country ?? ""} placeholder="Country (2-letter)" className={`${field} flex-1 basis-32`} />
          <label className="sr-only" htmlFor="dir-sort">Sort by</label>
          <select id="dir-sort" name="sort" defaultValue={params.sort ?? "newest"} className={field}>
            <option value="newest">Newest</option>
            <option value="community_score">Community Score</option>
            <option value="angel_score">Angel Score</option>
          </select>
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover"
          >
            Filter
          </button>
        </form>

        {startups.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No startups match those filters.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {startups.map((s) => (
              <StartupPublicCard key={s.user_id} startup={s} href={`${detailBase}/${s.user_id}`} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
