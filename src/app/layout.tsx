import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Teamspace — A little space for big ideas",
  description:
    "Your team's tasks, notes, and project files, together in one focused workspace.",
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
