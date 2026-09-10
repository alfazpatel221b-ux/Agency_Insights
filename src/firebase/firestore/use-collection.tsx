'use client';

import { useState, useEffect, useMemo } from 'react';
import { onSnapshot, collection, query, Query, DocumentData, CollectionReference, QueryConstraint } from 'firebase/firestore';
import { useFirestore } from '../provider';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

const EMPTY_CONSTRAINTS: any[] = [];

/**
 * Hook to listen to a Firestore collection or query.
 * Query constraints must be memoized by callers.
 *
 * Demo compatibility normalizes legacy imported shapes at the Firestore
 * boundary so existing demo records remain compatible with the dashboard
 * components without requiring the database to be recreated.
 */
export function useCollection<T>(path: string, queryConstraints: any[] = EMPTY_CONSTRAINTS) {
  const firestore = useFirestore();
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const collectionQuery = useMemo(() => {
    if (queryConstraints && queryConstraints.some(c => c === null)) return null;

    try {
      let ref: Query<DocumentData> = collection(firestore, path);
      const activeConstraints = queryConstraints.filter((c): c is QueryConstraint => !!c && typeof c === 'object');
      if (activeConstraints.length > 0) ref = query(ref, ...activeConstraints);
      return ref;
    } catch (err) {
      console.error('Failed to build Firestore query:', err);
      return null;
    }
  }, [firestore, path, queryConstraints]);

  useEffect(() => {
    if (collectionQuery === null) {
      setData(prev => (prev === null ? prev : null));
      setLoading(prev => (prev === false ? prev : false));
      setError(prev => (prev === null ? prev : null));
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(collectionQuery,
      (snapshot) => {
        const result: T[] = [];
        snapshot.forEach((doc) => {
          const item: any = { id: doc.id, ...doc.data() };

          // Legacy demo leads sometimes stored services as a scalar string.
          if (path === 'leads') {
            if (Array.isArray(item.services)) {
              item.services = item.services.filter((s: unknown): s is string => typeof s === 'string');
            } else if (typeof item.services === 'string' && item.services.trim()) {
              item.services = item.services.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
            } else {
              item.services = [];
            }
          }

          // The original dashboard expects weekly labels in dd-MM-yyyy,
          // while older demo rows were written as yyyy-MM-dd. Normalize both
          // into the format consumed by the existing UI/calculations.
          if (path === 'weeklySpends' && typeof item.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.week)) {
            const [year, month, day] = item.week.split('-');
            item.week = `${day}-${month}-${year}`;
          }

          result.push(item as T);
        });

        setData(result);
        setLoading(false);
        setError(null);
      },
      async (err) => {
        if (err.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: (collectionQuery as CollectionReference).path || path,
            operation: 'list',
          });
          errorEmitter.emit('permission-error', permissionError);
          setError(permissionError);
        } else {
          setError(err);
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [collectionQuery, path]);

  return { data, loading, error };
}
