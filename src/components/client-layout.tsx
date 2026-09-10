'use client';

import * as React from "react";
import { usePathname } from 'next/navigation';
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

export const ChromeContext = React.createContext<{
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}>({
  mobileNavOpen: false,
  setMobileNavOpen: () => {},
});

export function useChrome() {
  return React.useContext(ChromeContext);
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const isDashboard = pathname?.startsWith('/dashboard');
  const isPreview = pathname?.startsWith('/preview');
  const isAuthPage = !isDashboard && !isPreview;
  const showChrome = mounted && (isDashboard || isPreview);

  return (
    <ChromeContext.Provider value={{ mobileNavOpen, setMobileNavOpen }}>
      <div 
        className={isAuthPage ? "flex min-h-screen font-body antialiased bg-white" : "flex min-h-screen font-body antialiased bg-app"}
        suppressHydrationWarning
      >
        {showChrome && !isMobile && <AppSidebar />}

        {showChrome && isMobile && (
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="left" className="p-0 w-[280px] border-r border-ink sm:max-w-[280px] [&>button]:hidden rounded-none gap-0 z-[120]">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <AppSidebar mobile onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        )}
        
        <div 
          className="flex-1 flex flex-col min-w-0 relative"
          suppressHydrationWarning
        >
          {showChrome && <AppHeader />}
          
          <main 
            className={cn(
              "flex-1 min-w-0 relative",
              !isAuthPage && "tactical-grid",
              "opacity-0",
              mounted && "opacity-100 transition-opacity duration-500"
            )} 
            data-testid="app-main"
            suppressHydrationWarning
          >
            <div 
              className={cn(
                "w-full mx-auto",
                isAuthPage ? "h-full" : "max-w-[1920px] p-4 md:p-8 pt-6 pb-20"
              )}
              suppressHydrationWarning
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </ChromeContext.Provider>
  );
}
