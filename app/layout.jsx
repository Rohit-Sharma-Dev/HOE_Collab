import { Literata, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import PWARegistration from "@/components/PWARegistration";

const literata = Literata({
  subsets: ["latin"],
  variable: "--font-literata",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

export const metadata = {
  title: "Colab — Local-First Collaborative Editor",
  description:
    "A real-time, offline-capable collaborative document editor with CRDT conflict resolution, version history, and AI-powered diff summaries.",
  keywords: ["collaborative editor", "offline-first", "real-time", "CRDT", "documents"],
  manifest: "/manifest.json",
  openGraph: {
    title: "Colab — Local-First Collaborative Editor",
    description: "Edit documents offline, sync seamlessly, collaborate in real time.",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${literata.variable} ${ibmPlexSans.variable}`}>
      <body className="min-h-screen bg-chalk text-ink antialiased font-sans">
        <PWARegistration />
        {children}
      </body>
    </html>
  );
}
