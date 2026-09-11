import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "OpsAi — Keyword Chat Forge",
  description: "Workspace-based AI chat for teams",
  verification: {
    google: "xkMBshZGX1381z0RXxuZk4Xf6TxIVG0mKu9bxqMbBQs",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full dark">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
