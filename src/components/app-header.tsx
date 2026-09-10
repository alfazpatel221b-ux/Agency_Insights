'use client';

import { MagnifyingGlass, Bell, Command as CommandIcon, ChartBar, List, SignOut, UserCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette } from "@/components/command-palette";
import { ProfileManagementDialog } from "@/components/profile-management-dialog";
import { useUser, useDoc, useAuth, useCollection, useFirestore } from "@/firebase";
import { UserProfile } from "@/lib/types";
import { TeamNotification } from "@/lib/email-automations";
import { format, getWeek } from "date-fns";
import { useChrome } from "@/components/client-layout";
import { useIsMobile } from "@/hooks/use-mobile";
import { signOut } from "firebase/auth";
import { toast } from "sonner";
import { doc, updateDoc, where } from "firebase/firestore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function AppHeader() {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [now, setNow] = useState<string | null>(null);
  const [snapshotLabel, setSnapshotLabel] = useState<string | null>(null);
  const { user } = useUser();
  const firestore = useFirestore();
  const { data: userProfile } = useDoc<UserProfile>(user ? `users/${user.uid}` : null);
  const notificationConstraints = useMemo(
    () => (user ? [where("userId", "==", user.uid)] : [null]),
    [user]
  );
  const { data: rawNotifications } = useCollection<TeamNotification>(
    "notifications",
    notificationConstraints
  );
  const [mounted, setMounted] = useState(false);
  const { setMobileNavOpen } = useChrome();
  const isMobile = useIsMobile();
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    const update = () => {
      const d = new Date();
      setNow(
        d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: 'Asia/Kolkata'
        })
      );

      const weekNum = getWeek(d, { weekStartsOn: 1 });
      const dateStr = format(d, 'dd MMM yyyy').toUpperCase();
      setSnapshotLabel(`W${weekNum < 10 ? '0' + weekNum : weekNum} · ${dateStr}`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const notifications = useMemo(() => {
    const list = [...(rawNotifications || [])];
    list.sort((a, b) => {
      const aTs = typeof a.createdAt === "string" ? Date.parse(a.createdAt) : (a.createdAt?.seconds || 0) * 1000;
      const bTs = typeof b.createdAt === "string" ? Date.parse(b.createdAt) : (b.createdAt?.seconds || 0) * 1000;
      return bTs - aTs;
    });
    return list.slice(0, 20);
  }, [rawNotifications]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = async (item: TeamNotification) => {
    if (item.read) {
      if (item.href) router.push(item.href);
      return;
    }
    try {
      await updateDoc(doc(firestore, "notifications", item.id), { read: true });
    } catch {
      // ignore
    }
    if (item.href) router.push(item.href);
  };

  const initials = userProfile 
    ? (userProfile.displayName || userProfile.email).substring(0, 2).toUpperCase() 
    : "AP";

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      toast.success("Signed out");
      router.push("/");
    } catch {
      toast.error("Sign out failed");
    }
  };

  return (
    <>
      <header
        className="h-16 bg-surface border-b border-ink flex items-center px-3 md:px-6 gap-2 md:gap-4 sticky top-0 z-[50] w-full"
        data-testid="app-topbar"
        suppressHydrationWarning
      >
        {mounted && isMobile && (
          <button
            onClick={() => setMobileNavOpen(true)}
            data-testid="topbar-menu-btn"
            aria-label="Open navigation"
            className="w-10 h-10 flex items-center justify-center bg-surface border border-hairline hover:border-ink transition-colors outline-none shrink-0"
          >
            <List size={18} />
          </button>
        )}

        <button
          onClick={() => setOpen(true)}
          data-testid="topbar-command-btn"
          className="group flex items-center gap-3 h-10 px-3 bg-surface border border-hairline hover:border-ink transition-colors min-w-0 flex-1 md:flex-none md:min-w-[280px] lg:min-w-[320px] text-left outline-none"
        >
          <MagnifyingGlass size={16} className="text-secondary shrink-0" />
          <span className="text-sm text-secondary flex-1 truncate">
            Search clients, KPIs, weeks…
          </span>
          <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] font-mono text-secondary border border-hairline px-1.5 py-0.5">
            <CommandIcon size={10} weight="bold" /> K
          </kbd>
        </button>

        <div className="hidden md:block flex-1" />

        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-surface border border-hairline">
          <span className="w-2 h-2 bg-[#00A675] pulse-dot" />
          <span className="text-[11px] font-mono tabular-nums text-secondary uppercase tracking-wider">
            Live · {mounted && now ? `${now} IST` : "--:--:--"}
          </span>
        </div>

        <div className="hidden xl:flex items-center gap-2 text-xs text-secondary">
          <ChartBar size={14} />
          <span className="uppercase tracking-widest">Week · {mounted ? snapshotLabel : "--"}</span>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              data-testid="topbar-notifications-btn"
              aria-label="Notifications"
              className="relative w-10 h-10 flex items-center justify-center bg-surface border border-hairline hover:border-ink transition-colors outline-none shrink-0"
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[8px] h-2 w-2 bg-brand" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 rounded-none border-ink p-0">
            <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-widest text-ink">Notifications</p>
              {unreadCount > 0 && (
                <span className="text-[10px] font-mono text-brand">{unreadCount} new</span>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-secondary">No new notifications</p>
                <p className="text-[11px] text-muted-foreground mt-1">You&apos;re all caught up</p>
              </div>
            ) : (
              <ul className="max-h-80 overflow-y-auto divide-y divide-hairline">
                {notifications.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 hover:bg-cream transition-colors"
                      onClick={() => markRead(item)}
                    >
                      <p className={`text-xs font-semibold ${item.read ? "text-secondary" : "text-ink"}`}>
                        {item.title}
                      </p>
                      {item.body && (
                        <p className="text-[11px] text-secondary mt-1 line-clamp-2">{item.body}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="topbar-user-btn"
              aria-label="User menu"
              className="flex items-center gap-2.5 h-10 px-2.5 bg-surface border border-hairline hover:border-ink transition-colors outline-none shrink-0"
            >
              <div className="w-6 h-6 bg-brand text-white flex items-center justify-center text-[11px] font-bold font-mono">
                {mounted ? initials : "--"}
              </div>
              <div className="hidden md:flex flex-col leading-tight text-left">
                <span className="text-xs font-semibold text-ink">{mounted ? (userProfile?.displayName || "Guest") : "Loading..."}</span>
                <span className="text-[10px] text-secondary uppercase tracking-wider">
                  {mounted ? (userProfile?.role || "—") : "—"}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-none border-ink">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold text-ink">{userProfile?.displayName || "User"}</p>
                <p className="text-xs text-secondary truncate">{userProfile?.email || user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              data-testid="topbar-profile-btn"
              onClick={() => setProfileOpen(true)}
            >
              <UserCircle size={14} />
              Profile management
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-destructive focus:text-destructive"
              onClick={handleSignOut}
            >
              <SignOut size={14} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <CommandPalette open={open} onOpenChange={setOpen} />
      <ProfileManagementDialog isOpen={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}
