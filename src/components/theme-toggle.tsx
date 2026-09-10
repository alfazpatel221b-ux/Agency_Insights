'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-10 w-10 rounded-none hover:bg-white/60 dark:hover:bg-white/10 transition-all active:scale-90 border border-transparent hover:border-white/20"
        >
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-primary" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-primary" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-none glass p-2 animate-in fade-in zoom-in-95 duration-200">
        <DropdownMenuItem 
          className="rounded-none flex items-center gap-2 px-2 py-2 text-sm focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
          onClick={() => setTheme('light')}
        >
          <Sun className="h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem 
          className="rounded-none flex items-center gap-2 px-2 py-2 text-sm focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
          onClick={() => setTheme('dark')}
        >
          <Moon className="h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem 
          className="rounded-none flex items-center gap-2 px-2 py-2 text-sm focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
          onClick={() => setTheme('system')}
        >
          <span className="h-4 w-4 flex items-center justify-center text-[10px] font-black italic">S</span>
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
