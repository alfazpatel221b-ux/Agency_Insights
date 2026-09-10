import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

/**
 * Stacked header layout: title always on its own row, actions wrap below.
 * Prevents toolbars (date pickers, filters, buttons) from overlapping the title.
 */
export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl font-headline uppercase break-words">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-secondary max-w-2xl">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
