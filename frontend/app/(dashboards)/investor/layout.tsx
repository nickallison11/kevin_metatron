import type { ReactNode } from "react";
import KevinChat from "@/components/KevinChat";

export default function InvestorLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <KevinChat />
    </>
  );
}
