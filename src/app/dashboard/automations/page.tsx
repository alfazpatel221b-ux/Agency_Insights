'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Notifications live under Administration. Keep this route as a shortcut. */
export default function AutomationsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/admin');
  }, [router]);
  return null;
}
