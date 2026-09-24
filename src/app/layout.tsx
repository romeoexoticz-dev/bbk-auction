import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "BBK AUCTION",
    template: "%s | BBK AUCTION",
  },
  description: "ตลาดประมูลของสะสมที่ตรวจสอบได้ โปร่งใส และติดตามราคาแบบเรียลไทม์",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/brand/bbk-auction-logo.png",
    apple: "/brand/bbk-auction-logo.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BBK AUCTION",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
