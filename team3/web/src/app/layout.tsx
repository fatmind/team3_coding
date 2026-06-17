import type { Metadata } from "next";
import "../styles/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team3 - AI Coding Collaboration",
  description: "Human and AI agents collaborating on coding projects",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
