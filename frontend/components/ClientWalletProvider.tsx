"use client";

import WalletProvider from "./WalletProvider";

export default function ClientWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // In case Next renders this component during SSR for any reason, avoid
  // executing wallet-adapter code on the server.
  if (typeof window === "undefined") return <>{children}</>;

  return <WalletProvider>{children}</WalletProvider>;
}
