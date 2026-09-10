
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function TeamReviewPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/business-snapshot'); }, [router]);
  return null;
}
