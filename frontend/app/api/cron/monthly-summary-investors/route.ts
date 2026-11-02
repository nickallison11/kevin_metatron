import { NextRequest } from "next/server";
import { runMonthlyReports } from "@/lib/monthly-report-cron";

export async function GET(req: NextRequest) {
  return runMonthlyReports(req, "investor");
}
