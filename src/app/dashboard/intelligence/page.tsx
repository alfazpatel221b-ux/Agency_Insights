
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ClientExplorerPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/business-snapshot'); }, [router]);
  return null;
}
