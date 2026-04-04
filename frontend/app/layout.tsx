import "./globals.css";
import AppShell from "@/components/AppShell";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
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

export const metadata = {
  title: "metatron",
  description:
    "The intelligence layer connecting founders, investors, and ecosystem partners globally."
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
