'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard-error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <div className="max-w-3xl space-y-4">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-destructive">Dashboard error</p>
        <h2 className="text-2xl font-bold">This dashboard section could not be loaded.</h2>
        <p className="break-words rounded-none border border-destructive/20 bg-destructive/5 p-4 text-left font-mono text-xs text-destructive">
          {error?.message || 'Unknown client-side error'}
        </p>
        {error?.digest && (
          <p className="text-[10px] font-mono text-muted-foreground">Digest: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={() => reset()}
          className="h-10 rounded-none bg-primary px-6 text-xs font-black uppercase tracking-widest text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
