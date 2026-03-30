import type { ReactNode } from "react";
import KevinChat from "@/components/KevinChat";

export default function ConnectorLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <KevinChat />
    </>
  );
}
