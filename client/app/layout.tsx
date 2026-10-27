import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// "AppName123" and the tagline are the wireframe's placeholders, kept until the team picks a name.
export const metadata: Metadata = {
  title: {
    default: "AppName123",
    template: "%s | AppName123",
  },
  description: "Cool tagline goes here.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
