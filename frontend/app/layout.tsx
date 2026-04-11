import "./globals.css";
import AppShell from "@/components/AppShell";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title:
    "metatron — Eliminating information asymmetry between founders and capital — globally",
  description:
    "AI-powered matchmaking for founders, connectors and investors in emerging markets.",
  icons: {
    icon: [{ url: "/favicon-icon.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${jetbrainsMono.variable} font-sans`}
      >
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
