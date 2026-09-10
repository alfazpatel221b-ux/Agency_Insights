'use client';

import { FirebaseProvider } from './provider';
import { initializeFirebase } from '.';

export function FirebaseClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const instances = initializeFirebase();
  return <FirebaseProvider value={instances}>{children}</FirebaseProvider>;
}
