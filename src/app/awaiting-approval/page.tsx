
'use client';

import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { useAuth, useUser } from '@/firebase';
import { AgencyInsightsLogo } from '@/components/agency-insights-logo';
import { Button } from '@/components/ui/button';
import { Clock, ShieldAlert } from 'lucide-react';

export default function AwaitingApprovalPage() {
  const router = useRouter();
  const auth = useAuth();
  const { user } = useUser();

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/');
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-cream tactical-grid">
      <div className="max-w-md w-full p-12 bg-white border border-ink space-y-10 text-center animate-in fade-in zoom-in-95 duration-500">
        <AgencyInsightsLogo className="mx-auto scale-125 mb-4" />
        
        <div className="space-y-4">
           <div className="flex justify-center">
             <div className="h-16 w-16 bg-warning/10 text-warning flex items-center justify-center border border-warning/30">
               <Clock className="h-8 w-8" />
             </div>
           </div>
           <h1 className="text-3xl font-black uppercase tracking-tighter">Awaiting approval</h1>
           <p className="text-sm text-secondary leading-relaxed">
             Your access request is under review. You&apos;ll get an email when an admin approves your account.
           </p>
        </div>

        <div className="bg-muted p-6 border-l-[3px] border-warning text-left space-y-2">
            <span className="micro-label">Status</span>
            <p className="text-sm font-semibold leading-none">{user?.email}</p>
            <p className="text-xs font-medium text-secondary uppercase tracking-wider">Pending review</p>
        </div>

        <div className="space-y-4 pt-4">
            <Button 
                variant="outline"
                className="w-full h-12 font-bold uppercase tracking-widest text-xs"
                onClick={handleSignOut}
            >
                Return to sign in
            </Button>
        </div>
      </div>
    </div>
  );
}
