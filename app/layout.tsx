import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Theme } from "frosted-ui";
import { WhopThemeProvider } from "@whop-apps/sdk";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Whop App",
  description: "My Whop App",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`  ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WhopThemeProvider>
          <div className="flex flex-col h-screen">
            <div className="flex-1">{children}</div>
          </div>
        </WhopThemeProvider>
      </body>
    </html>
  );
}
