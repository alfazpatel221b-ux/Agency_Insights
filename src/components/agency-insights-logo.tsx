import { cn } from "@/lib/utils";

/**
 * AGENCY INSIGHTS "A" Block Logo — Swiss high-contrast mark.
 */
export function AgencyInsightsLogo({
  className,
  isCollapsed,
}: {
  className?: string;
  isCollapsed?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)} data-testid="app-logo">
      <div className="h-8 w-8 bg-ink flex items-center justify-center text-cream font-mono font-black text-lg select-none">
        A
      </div>
      {!isCollapsed && (
        <div className="flex flex-col">
          <span className="font-bold text-base tracking-tighter text-ink leading-none uppercase font-headline">
            AGENCY INSIGHTS
          </span>
          <span className="text-[9px] font-bold text-secondary uppercase tracking-[0.2em] leading-none mt-1 font-sans">
            Control Center
          </span>
        </div>
      )}
    </div>
  );
}
