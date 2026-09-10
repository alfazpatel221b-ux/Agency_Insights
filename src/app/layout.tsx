import { IBM_Plex_Sans, IBM_Plex_Mono, Archivo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Toaster as ShadcnToaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { FirebaseClientProvider } from "@/firebase";
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClientLayout } from "@/components/client-layout";

const fontBody = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: 'swap',
});

const fontHeadline = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-headline",
  display: 'swap',
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: 'swap',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="antialiased">
      <body 
        className={cn(
          "min-h-screen font-body antialiased selection:bg-primary/20 selection:text-primary",
          fontBody.variable,
          fontHeadline.variable,
          fontMono.variable
        )}
        suppressHydrationWarning
      >
        <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light">
            <FirebaseClientProvider>
              <TooltipProvider>
                <ClientLayout>{children}</ClientLayout>
              </TooltipProvider>
            </FirebaseClientProvider>
          <Toaster position="bottom-right" richColors theme="light" />
          <ShadcnToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
