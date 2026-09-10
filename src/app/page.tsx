'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { signInAnonymously } from 'firebase/auth';
import { useAuth, useUser, useFirestore } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { seedDemoData } from '@/lib/demo-seed';
import { AgencyInsightsLogo } from '@/components/agency-insights-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const { user, loading } = useUser();
  const firestore = useFirestore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.push('/dashboard');
  }, [user, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    try {
      const credential = await signInAnonymously(auth);
      await setDoc(doc(firestore, 'users', credential.user.uid), { uid: credential.user.uid, email: email || 'demo@example.com', displayName: email ? email.split('@')[0] : 'Demo User', photoURL: '', role: 'Admin', status: 'User Registered', permissions: ['snapshot', 'tracker', 'wbr', 'actions'] }, { merge: true });
      await seedDemoData(firestore);
      router.push('/dashboard');
    } catch (error: any) {
      setError('Unable to start the demo. Please check the Firebase configuration.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading || user) return null;

  return (
    <div className="flex h-screen w-full">
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-12 bg-white">
        <div className="w-full max-w-sm space-y-10">
          <AgencyInsightsLogo className="scale-110" />
          
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tighter uppercase">Sign in</h1>
            <p className="text-sm text-secondary">Use any email and password to enter the portfolio demo.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="micro-label">Email</Label>
                <Input className="h-12 border-neutral-300 focus:border-primary focus:border-2 transition-all rounded-none" type="email" placeholder="name@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={isLoggingIn} />
              </div>
              <div className="space-y-1.5">
                <Label className="micro-label">Password</Label>
                <Input className="h-12 border-neutral-300 focus:border-primary focus:border-2 transition-all rounded-none" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={isLoggingIn} />
              </div>
            </div>

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            
            <Button type="submit" className="w-full h-12 font-bold uppercase tracking-[0.15em] text-xs" disabled={isLoggingIn}>
              {isLoggingIn ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="flex flex-col gap-4 pt-6 border-t border-hairline">
             <div className="flex items-center gap-2">
               <span className="text-xs text-secondary">Need an account?</span>
               <Link href="/register" className="text-xs font-bold uppercase text-brand hover:underline">Request access</Link>
             </div>
             <p className="text-[11px] text-secondary font-mono">Agency Insights</p>
          </div>
        </div>
      </div>

      <div className="hidden lg:block lg:w-1/2 relative bg-ink overflow-hidden">
        <img src="https://images.pexels.com/photos/669610/pexels-photo-669610.jpeg" alt="Performance analytics workspace" className="absolute inset-0 w-full h-full object-cover opacity-50 mix-blend-luminosity grayscale" />
        <div className="absolute inset-0 bg-brand/30 mix-blend-multiply" />
        <div className="absolute bottom-12 left-12 right-12">
            <div className="p-8 border border-white/20 bg-ink/70">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70 mb-3">Agency Insights</p>
              <h2 className="text-white text-3xl font-black tracking-tight mb-3 normal-case">Client performance, spends, and weekly reviews in one place.</h2>
              <p className="text-white/60 text-xs font-mono tracking-widest uppercase">Ops console for media &amp; performance teams</p>
            </div>
        </div>
      </div>
    </div>
  );
}
