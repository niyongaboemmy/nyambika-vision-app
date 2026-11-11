import type { Metadata, Viewport } from "next";
import { Nunito, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "@/components/kit";
import { NativeBridge } from "@/components/native-bridge";
import { PilotSurvey } from "@/components/pilot-survey";
import { SessionProvider } from "@/lib/session";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Nunito({ subsets: ["latin"], weight: ["800", "900"], variable: "--font-display-face", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Nyambika Vision", template: "%s · Nyambika" },
  description: "Ask. See it on you. Hold to buy. Looks from Rwandan tailors, cooperatives and sellers, rendered on your private twin.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.png", apple: "/icon.png" },
  metadataBase: new URL(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B0A0F" },
    { media: "(prefers-color-scheme: light)", color: "#FBF6F0" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is corrected before first paint by THEME_SCRIPT (cookie `nv-theme`, else the OS preference).
    <html lang="en" data-theme="dark" className={`${body.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        <SessionProvider>
          {children}
          <Toaster />
          <PilotSurvey />
          <NativeBridge />
        </SessionProvider>
      </body>
    </html>
  );
}
