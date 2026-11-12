import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Teamspace — Fast, Open-Source Collaborative Workspace",
  description: "An MIT-licensed, open-source workspace for notes, tasks, and databases.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
