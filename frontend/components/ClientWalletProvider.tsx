"use client";

import dynamic from "next/dynamic";

const WalletProvider = dynamic(() => import("./WalletProvider"), { ssr: false });

export default function ClientWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WalletProvider>{children}</WalletProvider>;
}
