'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth, useFirestore } from '@/firebase';
import { registerUser } from '@/lib/firestore-actions';
import { AgencyInsightsLogo } from '@/components/agency-insights-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isDemoMode } from '@/lib/demo-mode';
import { seedDemoData } from '@/lib/demo-seed';

export default function RegisterPage() {
  const router = useRouter();
  const auth = useAuth();
  const firestore = useFirestore();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.endsWith('@example.com')) {
      setError('Access requests are limited to verified @example.com email addresses.');
      return;
    }
    setIsRegistering(true);
    setError(null);
    try {
      await registerUser(firestore, auth, {
        email: normalizedEmail,
        displayName,
        password
      });
      if (isDemoMode) await seedDemoData(firestore);
      router.push(isDemoMode ? '/dashboard' : '/awaiting-approval');
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('This account already exists. You may have already been invited. Please check your inbox for an activation link or try logging in.');
      } else {
        setError(err.message || 'Access request failed. Please verify your details.');
      }
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="flex h-screen w-full">
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-12 bg-white">
        <div className="w-full max-w-sm space-y-10">
          <AgencyInsightsLogo className="scale-110" />
          
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tighter uppercase">Request access</h1>
            <p className="text-sm text-secondary">Register with your work email. An admin will approve your account.</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="micro-label">Full name</Label>
                <Input
                  className="h-12 border-neutral-300 focus:border-primary focus:border-2 transition-all rounded-none"
                  placeholder="e.g. John Doe"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={isRegistering}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="micro-label">Work email</Label>
                <Input
                  className="h-12 border-neutral-300 focus:border-primary focus:border-2 transition-all rounded-none"
                  type="email"
                  placeholder="name@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isRegistering}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="micro-label">Password</Label>
                <Input
                  className="h-12 border-neutral-300 focus:border-primary focus:border-2 transition-all rounded-none"
                  type="password"
                  required
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isRegistering}
                />
              </div>
            </div>

            {error && (
              <div className="bg-destructive/5 border-l-2 border-destructive p-4">
                <p className="text-sm font-medium text-destructive leading-relaxed">{error}</p>
              </div>
            )}
            
            <Button 
              type="submit" 
              className="w-full h-12 font-bold uppercase tracking-[0.15em] text-xs"
              disabled={isRegistering}
            >
              {isRegistering ? 'Submitting…' : 'Request access'}
            </Button>
          </form>

          <div className="pt-6 border-t border-hairline">
             <div className="flex items-center gap-2">
               <span className="text-xs text-secondary">Already have an account?</span>
               <Link href="/" className="text-xs font-bold uppercase text-brand hover:underline">Sign in</Link>
             </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:block lg:w-1/2 relative bg-ink overflow-hidden">
        <img 
          src="https://images.pexels.com/photos/3184292/pexels-photo-3184292.jpeg" 
          alt="Team reviewing performance metrics" 
          className="absolute inset-0 w-full h-full object-cover opacity-45 mix-blend-luminosity grayscale"
        />
        <div className="absolute inset-0 bg-brand/25 mix-blend-multiply" />
        <div className="absolute bottom-12 left-12 right-12">
          <div className="p-8 border border-white/20 bg-ink/70">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70 mb-3">Join AGENCY INSIGHTS</p>
            <h2 className="text-white text-3xl font-black tracking-tight normal-case">Request access to the client operations console.</h2>
          </div>
        </div>
      </div>
    </div>
  );
}
