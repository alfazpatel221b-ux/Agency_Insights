'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useAuth, useUser } from '@/firebase';
import { SpendsAnalytics } from '@/components/spends-analytics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SpendsDashboardPreviewPage() {
  const auth = useAuth();
  const { user, loading } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError('Invalid credentials or unauthorized account.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-20 text-sm font-medium text-secondary">
        Checking session…
      </div>
    );
  }

  if (!user) {
    return (
      <div data-testid="spends-dashboard-preview-login" className="mx-auto max-w-sm space-y-8 py-16">
        <div className="space-y-2">
          <div className="inline-block bg-brand px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
            Preview
          </div>
          <h1 className="font-headline text-3xl font-black uppercase tracking-tight">Sign in</h1>
          <p className="text-sm text-secondary">
            Spends Dashboard preview uses live Firestore. Sign in with an approved account that has dashboard access.
          </p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="preview-email" className="text-[10px] font-black uppercase tracking-widest">
              Email
            </Label>
            <Input
              id="preview-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-none"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preview-password" className="text-[10px] font-black uppercase tracking-widest">
              Password
            </Label>
            <Input
              id="preview-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="rounded-none"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isLoggingIn} className="w-full rounded-none font-black uppercase tracking-widest">
            {isLoggingIn ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div data-testid="spends-dashboard-preview">
      <div className="mb-4 flex items-center gap-2 border border-ink/15 bg-cream px-3 py-2 text-[10px] font-black uppercase tracking-widest text-secondary">
        <span className="bg-brand px-1.5 py-0.5 text-white">Preview</span>
        Design mode · live Firestore spends
      </div>
      <SpendsAnalytics />
    </div>
  );
}
