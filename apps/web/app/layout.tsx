import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { ErrorToaster } from "@/components/error-toaster";
import { Toaster } from "@/components/kit";
import { DeferredGlobals } from "@/components/deferred-globals";
import { ThemeScript } from "@/components/theme-script";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

// Brand face only (wordmark, Muse hero via `font-brand`); UI text uses the SF system stack (iOS pass).
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
    // <html data-theme> is set before first paint by ThemeScript (cookie `nv-theme`, else the OS preference). It is
    // deliberately not a JSX prop, so a client re-render of the shell (e.g. a not-found boundary) never resets it.
    <html lang="en" className={display.variable} suppressHydrationWarning>
      <body className="antialiased">
        {/* Next "preventing flash" pattern via useServerInsertedHTML: in the first HTML only, never in a client render. */}
        <ThemeScript />
        <SessionProvider>
          {children}
          <Toaster />
          <DeferredGlobals />
          <ErrorToaster />
        </SessionProvider>
      </body>
    </html>
  );
}
