'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { onSnapshot, collection, query, Query, DocumentData, CollectionReference, QueryConstraint } from 'firebase/firestore';
import { useFirestore } from '../provider';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

// Use a static empty array to prevent infinite loops when queryConstraints is not provided.
const EMPTY_CONSTRAINTS: any[] = [];

/**
 * Hook to listen to a Firestore collection or query.
 * 
 * CRITICAL: queryConstraints must be memoized in the component calling this hook.
 * If passed as an inline array (e.g. [where(...)]) it will trigger an infinite render loop.
 * 
 * @param path The collection path.
 * @param queryConstraints Firestore QueryConstraints array (where, orderBy, limit, etc.)
 */
export function useCollection<T>(path: string, queryConstraints: any[] = EMPTY_CONSTRAINTS) {
  const firestore = useFirestore();
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const collectionQuery = useMemo(() => {
    // If any constraint is null, we treat the query as not ready.
    // An empty array [] is valid and returns the base collection reference.
    if (queryConstraints && queryConstraints.some(c => c === null)) {
      return null;
    }

    try {
      let ref: Query<DocumentData> = collection(firestore, path);
      const activeConstraints = queryConstraints.filter((c): c is QueryConstraint => !!c && typeof c === 'object');
      
      if (activeConstraints.length > 0) {
        ref = query(ref, ...activeConstraints);
      }
      return ref;
    } catch (err) {
      console.error("Failed to build Firestore query:", err);
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
          result.push({ id: doc.id, ...doc.data() } as unknown as T);
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
