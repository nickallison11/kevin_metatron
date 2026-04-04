import type { ReactNode } from "react";
import InvestorShell from "@/components/InvestorShell";

export default function InvestorLayout({ children }: { children: ReactNode }) {
  return <InvestorShell>{children}</InvestorShell>;
}
