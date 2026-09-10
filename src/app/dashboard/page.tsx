
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useUser } from '@/firebase';

export default function DashboardRootPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();

  useEffect(() => {
    if (userLoading) return;

    if (user) {
      router.replace('/dashboard/business-snapshot');
    } else {
      router.replace('/');
    }
  }, [router, user, userLoading]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-xs font-black uppercase tracking-widest text-secondary/70">Accessing Command Center...</p>
    </div>
  );
}
