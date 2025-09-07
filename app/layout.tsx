import "./styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "EDGAR Filing Cards",
  description: "Snackable SEC filings in a clean UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
