'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * DEPRECATED TERMINAL: USERS has been consolidated into the ADMINISTRATION terminal.
 */
export default function UsersRedirectPage() {
  const router = useRouter();
  useEffect(() => { 
    router.replace('/dashboard/admin'); 
  }, [router]);
  return null;
}
