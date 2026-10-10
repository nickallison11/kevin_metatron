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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so light mode doesn't flash dark. Mirrors AppShell. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("metatron_theme");if(t==="light"||(t!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches))document.documentElement.classList.add("light")}catch(e){}`,
          }}
        />
      </head>
      <body className={`${dmSans.variable} ${jetbrainsMono.variable} font-sans`}>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
