import { redirect } from "next/navigation";

// Deal Flow listed the same founders as Browse Startups; merged into it.
export default function InvestorDealFlowRedirect() {
  redirect("/investor/startups");
}
