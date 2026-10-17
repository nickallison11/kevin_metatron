import { redirect } from "next/navigation";

/** Watchlist is now the Following tab on Matches. */
export default function InvestorWatchlistPage() {
  redirect("/investor/matches?tab=following");
}
