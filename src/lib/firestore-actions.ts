'use client';
import { collection, doc, Firestore, getDocs, query, where, writeBatch, setDoc, updateDoc, deleteDoc, orderBy, limit, getDoc, serverTimestamp } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
  deleteUser as deleteAuthUser,
  Auth,
  User,
} from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { KpiData, KpiWeeklyData, MonthlySpend, WeeklySpend, BusinessSnapshot, PerformanceShift, RagStatus, WbrEntry, UserProfile, Lead, LeadStatus, ServiceType, ActionItem, ActionCommentEntry } from './types';
import { format, parse, isValid, startOfWeek, addDays, subMonths, subYears, startOfYear, subWeeks, endOfMonth, startOfMonth } from 'date-fns';
import { generateBusinessSnapshot } from '@/ai/flows/business-snapshot-flow';
import { canonicalizeChannel } from './normalize';
import { parseKpiDirection } from './kpi-rag';
import { isDemoMode } from './demo-mode';

const sanitizeNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (val === null || val === undefined) return 0;
    const cleaned = val.toString().replace(/[^0-9.-]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
};

const getRowVal = (row: any, ...possibleKeys: string[]) => {
    if (!row || typeof row !== 'object') return undefined;
    const rowKeys = Object.keys(row);
    const normalize = (s: string) => s.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
    const normalizedKeys = rowKeys.map(rk => ({ original: rk, normalized: normalize(rk) }));

    for (const search of possibleKeys) {
        const normSearch = normalize(search);
        const foundStrict = normalizedKeys.find(nk => nk.normalized === normSearch);
        if (foundStrict) return row[foundStrict.original];
    }
    
    for (const search of possibleKeys) {
        const normSearch = normalize(search);
        const foundPrefix = normalizedKeys.find(nk => nk.normalized.startsWith(normSearch));
        if (foundPrefix) return row[foundPrefix.original];
    }
    return undefined;
};

const parseDirection = (dirStr: any, kpiName?: string): 'ASC' | 'DESC' => {
    return parseKpiDirection(dirStr, kpiName);
};

const parseKpiType = (raw: any): 'PRIMARY' | 'NON-PRIMARY' => {
    if (!raw) return 'PRIMARY';
    const s = raw.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.includes('nonprimary') || s === 'secondary' || s === 'non') return 'NON-PRIMARY';
    return 'PRIMARY';
};

const parseMonthStr = (monthStr: any, isWeeklyDate: boolean = false): string => {
  if (!monthStr) return "";
  const s = monthStr.toString().trim();
  if (/^\d{4}-\d{2}$/.test(s) && !isWeeklyDate) return s;
  
  const formats = [
    'dd-MM-yyyy', 'dd/MM/yyyy', 'MMMM yyyy', 'MMM yyyy', 'MM/yyyy', 
    'yyyy-MM', 'MM-yyyy', 'yyyy/MM/dd', 'dd-MMM-yy', 'MMM-yy', 
    'MMMM yy', 'MMM yy', 'MM-yy', 'yyyy-MM-dd', 'MMM-yyyy',
    'dd-MMM-yyyy', 'yyyy/MM', 'MMM-yyyy'
  ];

  let parsedDate: Date | null = null;
  for (const f of formats) {
    try {
      const d = parse(s, f, new Date());
      if (isValid(d)) { parsedDate = d; break; }
    } catch (e) {}
  }

  if (!parsedDate) { 
    const d = new Date(s); 
    if (isValid(d)) parsedDate = d; 
  }

  if (parsedDate) {
    if (isWeeklyDate) {
      const monday = startOfWeek(parsedDate, { weekStartsOn: 1 });
      const thursday = addDays(monday, 3);
      return format(thursday, 'yyyy-MM');
    }
    return format(parsedDate, 'yyyy-MM');
  }
  return ""; 
};

const throttle = () => new Promise(resolve => setTimeout(resolve, 50));

export const saveActionItem = async (db: Firestore, data: Partial<ActionItem>, id?: string) => {
    const ref = id ? doc(db, 'actionItems', id) : doc(collection(db, 'actionItems'));
    const payload = {
        ...data,
        id: ref.id,
        updatedAt: new Date().toISOString(),
        createdAt: data.createdAt || new Date().toISOString()
    };
    try {
        await setDoc(ref, payload, { merge: true });
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: ref.path, operation: 'write', requestResourceData: payload }));
        throw e;
    }
};

/** Normalize comment history: backfill legacy single `comment` when history is empty. */
export function normalizeActionCommentHistory(
  existing: ActionItem | null | undefined
): ActionCommentEntry[] {
  if (!existing) return [];
  const history: ActionCommentEntry[] = [...(existing.commentHistory || [])];
  const prevComment = (existing.comment || '').trim();
  if (prevComment && history.length === 0) {
    history.push({
      id: `legacy-${existing.id}`,
      text: prevComment,
      createdAt: existing.updatedAt || existing.createdAt || new Date().toISOString(),
    });
  }
  return history;
}

/** Build comment history when saving: preserve past entries and append new text. */
export function buildActionCommentHistory(
  existing: ActionItem | null | undefined,
  nextCommentRaw: string | undefined
): { comment: string; commentHistory: ActionCommentEntry[] } {
  const nextComment = (nextCommentRaw || '').trim();
  const prevComment = (existing?.comment || '').trim();
  let history = normalizeActionCommentHistory(existing);

  if (nextComment) {
    const last = history[history.length - 1];
    const isDuplicate = last && last.text.trim() === nextComment;
    if (!isDuplicate) {
      history.push({
        id: `c-${Date.now()}`,
        text: nextComment,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const latest =
    nextComment ||
    history[history.length - 1]?.text ||
    prevComment ||
    '';

  return { comment: latest, commentHistory: history };
}

/** Remove one comment from history and refresh the latest `comment` field. */
export function removeActionComment(
  existing: ActionItem,
  commentId: string
): { comment: string; commentHistory: ActionCommentEntry[] } {
  const history = normalizeActionCommentHistory(existing).filter(
    (entry) => entry.id !== commentId
  );
  const latest = history[history.length - 1]?.text || '';
  return { comment: latest, commentHistory: history };
}

export const deleteActionComment = async (
  db: Firestore,
  actionItem: ActionItem,
  commentId: string
) => {
  const { comment, commentHistory } = removeActionComment(actionItem, commentId);
  await saveActionItem(db, { comment, commentHistory }, actionItem.id);
  return { comment, commentHistory };
};

export const deleteActionItem = async (db: Firestore, id: string) => {
    try {
        await deleteDoc(doc(db, 'actionItems', id));
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/actionItems/${id}`, operation: 'delete' }));
        throw e;
    }
};

export const bulkSaveKpiData = async (db: Firestore, kpiEntries: any[], defaultMonthStr: string, onProgress?: (progress: number) => void) => {
    const uploadedMonths = new Set<string>();
    let processedCount = 0;
    const CHUNK_SIZE = 50; 
    const totalEntries = kpiEntries.length;
    
    for (let i = 0; i < totalEntries; i += CHUNK_SIZE) {
        const chunk = kpiEntries.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        let batchProcessed = 0;
        
        chunk.forEach(entry => {
            if (!entry || Object.keys(entry).length < 2) return;

            const providedRid = getRowVal(entry, 'Record ID', 'Upload Record ID', 'id')?.toString().trim();
            const kpiDocRef = providedRid ? doc(db, 'kpis', providedRid) : doc(collection(db, 'kpis'));
            const kpiId = kpiDocRef.id;

            const clientName = getRowVal(entry, 'clientName', 'Client')?.toString().trim();
            const channel = canonicalizeChannel(getRowVal(entry, 'channel', 'Channel')?.toString());
            const kpi = getRowVal(entry, 'kpi', 'KPI')?.toString().trim();
            const clientId = getRowVal(entry, 'Client ID', 'ClientID', 'clientId')?.toString().trim() || 'N/A';
            
            if (!clientName || !channel || channel === 'N/A' || !kpi) return;
            
            const monthStr = parseMonthStr(getRowVal(entry, 'Month', 'month')) || defaultMonthStr;
            if (monthStr) uploadedMonths.add(monthStr);

            const kpiPayload: any = { 
                month: monthStr, 
                clientId, 
                clientName, 
                channel, 
                kpi,
                type: getRowVal(entry, 'Type') || 'Performance',
                uploadRecordId: kpiId
            };

            kpiPayload.cluster = getRowVal(entry, 'cluster', 'Cluster')?.toString().trim() || 'Unassigned';
            kpiPayload.lob = getRowVal(entry, 'lob', 'LOB', 'Sub Entity')?.toString().trim() || 'N/A';
            kpiPayload.cduLead = getRowVal(entry, 'CDU Lead', 'Lead')?.toString().trim() || 'N/A';
            kpiPayload.emCsm = getRowVal(entry, 'EM/CSM', 'CSM', 'Manager')?.toString().trim() || 'N/A';
            kpiPayload.direction = parseDirection(getRowVal(entry, 'direction', 'Direction'), kpi);
            kpiPayload.kpiType = parseKpiType(getRowVal(entry, 'KPI Type', 'kpiType', 'Kpi Type'));
            kpiPayload.currency = getRowVal(entry, 'currency', 'Currency') || 'INR';
            kpiPayload.targetMonth = sanitizeNumber(getRowVal(entry, 'Monthly Target', 'Target'));
            kpiPayload.achievedMonthTillYesterday = sanitizeNumber(getRowVal(entry, 'Monthly Achieved', 'Monthly Achived', 'Achieved'));

            batch.set(kpiDocRef, kpiPayload, { merge: true });

            [1, 2, 3, 4, 5].forEach(w => {
                const weeklyAchieved = getRowVal(entry, `W${w} Achieved`, `W${w} Achived`, `W${w}Achieved`, `W${w}`);
                const weeklyComment = getRowVal(entry, `W${w} Comment`, `W${w}Comment`);
                const weeklyId = `${kpiId}_w${w}`;
                const weeklyDocRef = doc(db, 'kpiWeeklyData', weeklyId);
                
                batch.set(weeklyDocRef, { 
                    kpiDataId: kpiId, 
                    weekOfMonth: w, 
                    month: monthStr,
                    achieved: sanitizeNumber(weeklyAchieved),
                    comment: weeklyComment?.toString() || ""
                }, { merge: true });
            });
            batchProcessed++;
        });

        if (batchProcessed > 0) {
            await batch.commit().catch(async (err) => {
                errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/kpis', operation: 'write' }));
                throw err;
            });
            processedCount += batchProcessed;
            await throttle();
        }
        if (onProgress) onProgress(Math.min(100, Math.round(((i + chunk.length) / totalEntries) * 100)));
    }
    return { uploadedMonths: Array.from(uploadedMonths).sort(), processedCount };
};

export const saveKpiData = async (db: Firestore, kpiData: Omit<KpiData, 'id'>, weeklyData: Omit<KpiWeeklyData, 'id' | 'kpiDataId'>[], existingKpiId?: string) => {
    const batch = writeBatch(db);
    const kpiDocRef = existingKpiId ? doc(db, 'kpis', existingKpiId) : doc(collection(db, 'kpis'));
    const kpiId = kpiDocRef.id;
    
    const payload = {
      ...kpiData,
      channel: canonicalizeChannel(kpiData.channel),
      uploadRecordId: kpiId,
    };
    batch.set(kpiDocRef, payload, { merge: true });

    weeklyData.forEach(week => { 
        const weeklyId = `${kpiId}_w${week.weekOfMonth}`;
        batch.set(doc(db, 'kpiWeeklyData', weeklyId), { ...week, kpiDataId: kpiId, month: kpiData.month }, { merge: true }); 
    });
    
    await batch.commit().catch(async (e) => { 
      errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/kpis', operation: 'write', requestResourceData: payload })); 
      throw e;
    });
};

export const updateWeeklyComment = async (db: Firestore, id: string, comment: string) => {
    const ref = doc(db, 'kpiWeeklyData', id);
    updateDoc(ref, { comment }).catch(e => { 
      errorEmitter.emit('permission-error', new FirestorePermissionError({ path: ref.path, operation: 'update', requestResourceData: { comment } })); 
    });
};

export const clearAllKpiData = async (db: Firestore) => {
    const [kpisSnap, weeklySnap] = await Promise.all([getDocs(collection(db, 'kpis')), getDocs(collection(db, 'kpiWeeklyData'))]);
    const batchSize = 400;
    const allDocs = [...kpisSnap.docs, ...weeklySnap.docs];
    for (let i = 0; i < allDocs.length; i += batchSize) {
        const batch = writeBatch(db);
        allDocs.slice(i, i + batchSize).forEach(d => batch.delete(d.ref));
        await batch.commit().catch(async (err) => {
          errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/kpis', operation: 'delete' }));
          throw err;
        });
        await throttle();
    }
};

export const saveUserRoleAndPermissions = (db: Firestore, userId: string, role: string, permissions: string[], status?: string) => {
    const updateData: any = { role, permissions };
    if (status) updateData.status = status;
    
    updateDoc(doc(db, 'users', userId), updateData).catch(e => { 
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/users/${userId}`, operation: 'update', requestResourceData: updateData })); 
    });
};

export const ensureDemoUserProfile = async (db: Firestore, user: User, email: string, displayName?: string) => {
  if (!isDemoMode) return;
  await setDoc(doc(db, 'users', user.uid), { uid: user.uid, email: email.trim().toLowerCase(), displayName: displayName || email.split('@')[0] || 'Demo User', photoURL: user.photoURL || '', role: 'Admin', status: 'User Registered', permissions: ['snapshot','tracker','wbr','actions','spends','dashboard','forecast','sales','admin'] }, { merge: true });
};

export const createUser = async (db: Firestore, userData: any) => {
    const email = String(userData.email || '').trim().toLowerCase();
    if (!isDemoMode && !email.includes('@')) {
        throw new Error('Only @example.com email addresses can be invited.');
    }
    const tempAppName = `temp-user-${Date.now()}`;
    const tempApp = initializeApp(firebaseConfig, tempAppName);
    const tempAuth = getAuth(tempApp);
    try {
        const userCredential = await createUserWithEmailAndPassword(tempAuth, email, Math.random().toString(36).slice(-12));
        const userProfile = { 
            uid: userCredential.user.uid, 
            email,
            displayName: userData.displayName, 
            photoURL: '', 
            role: userData.role, 
            status: 'Invite sent', 
            permissions: userData.permissions || ['snapshot', 'tracker', 'wbr', 'actions'] 
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), userProfile);
        // Invite email is sent from alerts@example.com by Cloud Function onUserEmailAutomations.
        return userProfile;
    } catch (authError: any) { throw authError; } finally { await deleteApp(tempApp); }
};

export const registerUser = async (db: Firestore, auth: Auth, userData: any) => {
    const email = String(userData.email || '').trim().toLowerCase();
    if (!isDemoMode && !email.includes('@')) {
        throw new Error('Only @example.com email addresses can request access.');
    }
    const userCredential = await createUserWithEmailAndPassword(auth, email, userData.password);
    const userProfile = { 
        uid: userCredential.user.uid, 
        email,
        displayName: userData.displayName, 
        photoURL: '', 
        role: isDemoMode ? 'Admin' : 'Client Partner', 
        status: isDemoMode ? 'User Registered' : 'Pending', 
        permissions: [] 
    };
    try {
      if (!isDemoMode) await sendEmailVerification(userCredential.user);
      await setDoc(doc(db, 'users', userCredential.user.uid), userProfile);
    } catch (error) {
      await deleteAuthUser(userCredential.user);
      throw error;
    }
    return userProfile;
};

export const resendInvitationEmail = async (auth: Auth, email: string, sendBranded?: (email: string) => Promise<void>) => {
    try {
        if (sendBranded) {
            await sendBranded(email);
            return true;
        }
        await sendPasswordResetEmail(auth, email);
        return true;
    } catch (error: any) {
        throw error;
    }
};

export const updateUserDisplayName = async (db: Firestore, user: User, displayName: string) => {
    const trimmed = displayName.trim();
    if (!trimmed) throw new Error('Display name is required.');
    await updateProfile(user, { displayName: trimmed });
    await updateDoc(doc(db, 'users', user.uid), { displayName: trimmed }).catch((e) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `/users/${user.uid}`,
            operation: 'update',
            requestResourceData: { displayName: trimmed },
        }));
        throw e;
    });
};

export const changeUserPassword = async (user: User, currentPassword: string, newPassword: string) => {
    if (!user.email) throw new Error('Your account does not have an email address.');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
};

export const deleteUser = async (db: Firestore, userId: string) => {
    deleteDoc(doc(db, 'users', userId)).catch(e => { 
      errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/users/${userId}`, operation: 'delete' })); 
    });
};

export const purgeOtherUsers = async (db: Firestore, keepEmail: string) => {
    const usersCol = collection(db, 'users');
    const snapshot = await getDocs(usersCol);
    const batch = writeBatch(db);
    let count = 0;
    snapshot.forEach(docSnap => { if (docSnap.data().email !== keepEmail) { batch.delete(docSnap.ref); count++; } });
    if (count > 0) { await batch.commit().catch(async (err) => { errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/users', operation: 'delete' })); throw err; }); }
    return count;
};

export const purgeCollection = async (db: Firestore, collectionName: string) => {
    const colRef = collection(db, collectionName);
    const snapshot = await getDocs(colRef);
    const docs = snapshot.docs;
    const batchSize = 400;
    for (let i = 0; i < docs.length; i += batchSize) {
        const batch = writeBatch(db);
        docs.slice(i, i + batchSize).forEach(d => batch.delete(d.ref));
        await batch.commit().catch(async (err) => { errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/${collectionName}`, operation: 'delete' })); throw err; });
        await throttle();
    }
    return docs.length;
};

export const saveMonthlySpend = async (db: Firestore, data: Omit<MonthlySpend, 'id'>, id?: string) => {
    const ref = id ? doc(db, 'monthlySpends', id) : doc(collection(db, 'monthlySpends'));
    const payload = {
      ...data,
      channelVendor: canonicalizeChannel(data.channelVendor),
      uploadRecordId: ref.id,
    };
    try {
        await setDoc(ref, payload, { merge: true });
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: ref.path, operation: 'write', requestResourceData: payload }));
        throw e;
    }
};

export const saveWeeklySpend = async (db: Firestore, data: Omit<WeeklySpend, 'id'>, id?: string) => {
    const ref = id ? doc(db, 'weeklySpends', id) : doc(collection(db, 'weeklySpends'));
    const month = parseMonthStr(data.week, true);
    const payload = {
      ...data,
      channelVendor: canonicalizeChannel(data.channelVendor),
      month,
      uploadRecordId: ref.id,
    };
    try {
        await setDoc(ref, payload, { merge: true });
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: ref.path, operation: 'write', requestResourceData: payload }));
        throw e;
    }
};

export const deleteMonthlySpend = async (db: Firestore, id: string) => {
    try {
        await deleteDoc(doc(db, 'monthlySpends', id));
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/monthlySpends/${id}`, operation: 'delete' }));
        throw e;
    }
};

export const deleteWeeklySpend = async (db: Firestore, id: string) => {
    try {
        await deleteDoc(doc(db, 'weeklySpends', id));
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/weeklySpends/${id}`, operation: 'delete' }));
        throw e;
    }
};

export const saveLead = async (db: Firestore, data: Omit<Lead, 'id'>, id?: string) => {
  const ref = id ? doc(db, 'leads', id) : doc(collection(db, 'leads'));
  const payload = { ...data, updatedAt: new Date().toISOString() };
  try {
    await setDoc(ref, payload, { merge: true });
  } catch (e) {
    errorEmitter.emit('permission-error', new FirestorePermissionError({ path: ref.path, operation: 'write', requestResourceData: payload }));
    throw e;
  }
};

export const deleteLead = async (db: Firestore, id: string) => {
  try {
    await deleteDoc(doc(db, 'leads', id));
  } catch (e) {
    errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/leads/${id}`, operation: 'delete' }));
    throw e;
  }
};

const LEAD_STATUSES: LeadStatus[] = ['Unqualified', 'Qualified', 'Pitch', 'Negotiation', 'Contract', 'Won', 'Lost'];
const LEAD_SERVICES: ServiceType[] = ['Performance', 'SEO', 'Affiliates', 'Branding', 'Marketplace', 'Creatives', 'Social'];

const parseLeadStatus = (raw: any): LeadStatus => {
  const value = (raw ?? '').toString().trim();
  const match = LEAD_STATUSES.find((s) => s.toLowerCase() === value.toLowerCase());
  return match || 'Unqualified';
};

const parseLeadServices = (raw: any): ServiceType[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((s) => LEAD_SERVICES.find((opt) => opt.toLowerCase() === String(s).trim().toLowerCase()))
      .filter(Boolean) as ServiceType[];
  }
  const parts = String(raw ?? '')
    .split(/[|,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts
    .map((s) => LEAD_SERVICES.find((opt) => opt.toLowerCase() === s.toLowerCase()))
    .filter(Boolean) as ServiceType[];
};

const parseLeadDate = (raw: any): string => {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && isValid(raw)) return format(raw, 'yyyy-MM-dd');
  const str = String(raw).trim();
  if (!str) return '';
  // Excel serial date
  if (/^\d+(\.\d+)?$/.test(str) && Number(str) > 20000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + Number(str) * 86400000);
    return isValid(d) ? format(d, 'yyyy-MM-dd') : '';
  }
  for (const pattern of ['yyyy-MM-dd', 'dd-MM-yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd']) {
    const d = parse(str, pattern, new Date());
    if (isValid(d)) return format(d, 'yyyy-MM-dd');
  }
  const fallback = new Date(str);
  return isValid(fallback) ? format(fallback, 'yyyy-MM-dd') : str;
};

export const bulkSaveLeads = async (
  db: Firestore,
  entries: any[],
  onProgress?: (progress: number) => void
) => {
  let processedCount = 0;
  const CHUNK_SIZE = 100;
  const totalEntries = entries.length;
  const col = collection(db, 'leads');

  for (let i = 0; i < totalEntries; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    let batchCount = 0;

    chunk.forEach((entry) => {
      if (!entry || Object.keys(entry).length < 2) return;

      const companyName = getRowVal(entry, 'Entity Name', 'Company Name', 'Company', 'companyName')?.toString().trim();
      if (!companyName) return;

      const providedRid = getRowVal(entry, 'Record ID', 'Upload Record ID', 'id')?.toString().trim();
      const docRef = providedRid ? doc(col, providedRid) : doc(col);

      const services = parseLeadServices(getRowVal(entry, 'Services', 'Service Portfolio', 'services'));
      const payload = {
        companyName,
        phone: getRowVal(entry, 'Phone', 'Phone Number', 'phone')?.toString().trim() || '',
        status: parseLeadStatus(getRowVal(entry, 'Status', 'Sales Status', 'Lead Stage', 'status')),
        services: services.length > 0 ? services : (['Performance'] as ServiceType[]),
        estimatedValue: sanitizeNumber(getRowVal(entry, 'Estimated Value', 'Estimated Value (INR)', 'estimatedValue')),
        notes: getRowVal(entry, 'Notes', 'Strategic Intelligence Notes', 'notes')?.toString().trim() || '',
        opportunityOwner: getRowVal(entry, 'Opportunity Owner', 'opportunityOwner', 'Owner')?.toString().trim() || '',
        expectedSpends: sanitizeNumber(getRowVal(entry, 'Expected Spends', 'Expected spends', 'expectedSpends')),
        retainerDetails: getRowVal(entry, 'Retainer Details', 'Retainer details', 'retainerDetails')?.toString().trim() || '',
        expectedGoLiveDate: parseLeadDate(getRowVal(entry, 'Expected Go Live Date', 'Go Live Date', 'expectedGoLiveDate')),
        pitchDate: parseLeadDate(getRowVal(entry, 'Pitch Date', 'pitchDate')),
        teamAssigned: getRowVal(entry, 'Team Assigned', 'Team', 'teamAssigned')?.toString().trim() || '',
        updatedAt: new Date().toISOString(),
        uploadRecordId: docRef.id,
      };

      batch.set(docRef, payload, { merge: true });
      batchCount++;
    });

    if (batchCount > 0) {
      await batch.commit().catch(async (err) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/leads', operation: 'write' }));
        throw err;
      });
      processedCount += batchCount;
      onProgress?.(Math.min(100, Math.round((processedCount / Math.max(totalEntries, 1)) * 100)));
      await throttle();
    }
  }

  return { processedCount };
};

export const clearAllSpendsData = async (db: Firestore) => {
    const monthlySnap = await getDocs(collection(db, 'monthlySpends'));
    const weeklySnap = await getDocs(collection(db, 'weeklySpends'));
    const batchSize = 400;
    const allDocs = [...monthlySnap.docs, ...weeklySnap.docs];
    for (let i = 0; i < allDocs.length; i += batchSize) {
        const batch = writeBatch(db);
        allDocs.slice(i, i + batchSize).forEach(d => batch.delete(d.ref));
        await batch.commit().catch(async (err) => { errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/spends', operation: 'delete' })); throw err; });
        await throttle();
    }
};

export const bulkSaveMonthlySpends = async (db: Firestore, entries: any[], onProgress?: (progress: number) => void) => {
    const col = collection(db, 'monthlySpends');
    let processedCount = 0;
    const CHUNK_SIZE = 100;
    const totalEntries = entries.length;
    const fallbackMonth = format(new Date(), 'yyyy-MM');

    for (let i = 0; i < totalEntries; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        let batchCount = 0;
        
        chunk.forEach(entry => {
            if (!entry || Object.keys(entry).length < 2) return;

            const providedRid = getRowVal(entry, 'Record ID', 'Upload Record ID', 'id')?.toString().trim();
            const docRef = providedRid ? doc(col, providedRid) : doc(col);
            
            let month = parseMonthStr(getRowVal(entry, 'Month', 'period', 'date'));
            if (!month) month = fallbackMonth;

            batch.set(docRef, {
                clientId: getRowVal(entry, 'Client ID', 'ClientID', 'clientId')?.toString().trim() || 'N/A',
                brandName: getRowVal(entry, 'Brand Name', 'Brand', 'client')?.toString().trim() || 'Unknown',
                industry: getRowVal(entry, 'Industry') || 'N/A',
                type: getRowVal(entry, 'Type') || 'N/A',
                subEntity: getRowVal(entry, 'Sub Entity', 'LOB', 'Entity') || 'N/A',
                channelVendor: canonicalizeChannel(getRowVal(entry, 'Channel', 'Vendor', 'Source')),
                creditLine: getRowVal(entry, 'Credit Line') || 'N/A',
                currency: getRowVal(entry, 'Currency') || 'INR',
                team: getRowVal(entry, 'Team') || 'N/A', 
                month,
                actualSpendsInr: sanitizeNumber(getRowVal(entry, 'Actual SPENDS', 'Spend', 'Amount', 'Total')),
                uploadRecordId: docRef.id
            }, { merge: true });
            batchCount++;
        });

        if (batchCount > 0) {
            await batch.commit().catch(async (err) => { 
                errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/monthlySpends', operation: 'create' })); 
                throw err; 
            });
            processedCount += batchCount;
            await throttle();
        }
        if (onProgress) onProgress(Math.min(100, Math.round(((i + chunk.length) / totalEntries) * 100)));
    }
    return processedCount;
};

export const bulkSaveWeeklySpends = async (db: Firestore, entries: any[], onProgress?: (progress: number) => void) => {
    const col = collection(db, 'weeklySpends');
    let processedCount = 0;
    const totalEntries = entries.length;
    const CHUNK_SIZE = 100;
    const fallbackMonth = format(new Date(), 'yyyy-MM');

    for (let i = 0; i < totalEntries; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        let batchOpCount = 0;
        
        chunk.forEach(entry => {
            if (!entry || Object.keys(entry).length < 2) return;

            const providedRid = getRowVal(entry, 'Record ID', 'Upload Record ID', 'id')?.toString().trim();
            const docRef = providedRid ? doc(col, providedRid) : doc(col);

            const weekStr = getRowVal(entry, 'Week', 'date', 'week')?.toString().trim();
            let month = parseMonthStr(weekStr, true);
            if (!month) month = fallbackMonth;

            batch.set(docRef, {
                clientId: getRowVal(entry, 'Client ID', 'ClientID', 'clientId')?.toString().trim() || 'N/A',
                brandName: getRowVal(entry, 'Brand Name', 'Brand', 'client')?.toString().trim() || 'Unknown',
                industry: getRowVal(entry, 'Industry') || 'N/A',
                type: getRowVal(entry, 'Type') || 'N/A',
                subEntity: getRowVal(entry, 'Sub Entity', 'LOB', 'Entity') || 'N/A',
                channelVendor: canonicalizeChannel(getRowVal(entry, 'Channel', 'Vendor', 'Source')),
                creditLine: getRowVal(entry, 'Credit Line') || 'N/A',
                currency: getRowVal(entry, 'Currency') || 'INR',
                team: getRowVal(entry, 'Team') || 'N/A',
                week: weekStr || format(new Date(), 'dd-MM-yyyy'),
                month,
                spendsInr: sanitizeNumber(getRowVal(entry, 'SPENDS', 'Spend', 'Amount', 'Total')),
                uploadRecordId: docRef.id
            }, { merge: true });
            batchOpCount++;
        });

        if (batchOpCount > 0) {
            await batch.commit().catch(async (err) => {
                errorEmitter.emit('permission-error', new FirestorePermissionError({ path: '/weeklySpends', operation: 'create' }));
                throw err;
            });
            processedCount += batchOpCount;
            await throttle();
        }
        if (onProgress) onProgress(Math.min(100, Math.round(((i + chunk.length) / totalEntries) * 100)));
    }
    return processedCount;
};

/**
 * Saves or updates a WBR entry.
 * Uses a deterministic ID based on clientId and wbrDate.
 */
export const saveWbrEntry = async (db: Firestore, entry: Partial<WbrEntry> & { clientId: string; wbrDate: string }) => {
  const wbrId = `wbr_${entry.clientId}_${entry.wbrDate}`.replace(/[^a-zA-Z0-9]/g, '_');
  const docRef = doc(db, 'wbrEntries', wbrId);
  const payload = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };

  await setDoc(docRef, payload, { merge: true }).catch(async (err) => {
    const permissionError = new FirestorePermissionError({
      path: docRef.path,
      operation: 'write',
      requestResourceData: payload,
    });
    errorEmitter.emit('permission-error', permissionError);
    throw err;
  });
};

const getShifts = (
  curr: Record<string, number>, 
  prev: Record<string, number>, 
  meta: Record<string, any>, 
  type: 'spend' | 'kpi' = 'spend',
  limitCount: number = 3
): { gainers: PerformanceShift[], losers: PerformanceShift[] } => {
  const allKeys = Array.from(new Set([...Object.keys(curr), ...Object.keys(prev)]));
  const diffs = allKeys.map(key => {
    const c = curr[key] || 0;
    const p = prev[key] || 0;
    const m = meta[key] || { type: 'N/A', team: 'N/A', kpi: '' };
    
    const amount = c - p; // Volume-based sorting key
    const variance = p > 0 ? (amount / p) * 100 : (c > 0 ? 100 : 0);
    
    let direction: PerformanceShift['direction'] = c >= p ? 'increase' : 'decrease';
    if (type === 'kpi') {
      direction = c >= p ? 'achievement' : 'slacking';
    }

    return {
      brand: key.split(' - ')[0],
      variance,
      amount,
      type: m.type || 'N/A',
      team: m.team || 'N/A',
      direction,
      kpi: m.kpi || ''
    } satisfies PerformanceShift;
  });
  
  return {
    // Sort by absolute volume (amount) rather than %
    gainers: [...diffs].sort((a, b) => (b.amount || 0) - (a.amount || 0)).filter(x => (x.amount || 0) > 0).slice(0, limitCount),
    losers: [...diffs].sort((a, b) => (a.amount || 0) - (b.amount || 0)).filter(x => (x.amount || 0) < 0).slice(0, limitCount)
  };
};

export const refreshBusinessSnapshot = async (db: Firestore, targetMonth: string) => {
  let month = targetMonth;
  const checkKpis = await getDocs(query(collection(db, 'kpis'), where('month', '==', targetMonth), limit(1)));
  const checkSpends = await getDocs(query(collection(db, 'monthlySpends'), where('month', '==', targetMonth), limit(1)));

  if (checkKpis.empty && checkSpends.empty) {
      const latestKpi = await getDocs(query(collection(db, 'kpis'), orderBy('month', 'desc'), limit(1)));
      if (!latestKpi.empty) month = latestKpi.docs[0].data().month;
      else {
          const latestSpend = await getDocs(query(collection(db, 'monthlySpends'), orderBy('month', 'desc'), limit(1)));
          if (!latestSpend.empty) month = latestSpend.docs[0].data().month;
      }
  }

  const monthDate = parse(month, 'yyyy-MM', new Date());
  const prevMonthStr = format(subMonths(monthDate, 1), 'yyyy-MM');
  const prePrevMonthStr = format(subMonths(monthDate, 2), 'yyyy-MM');
  const yearStart = format(startOfYear(monthDate), 'yyyy-MM');

  // DISCOVERY RITUAL: Find the two most recent available WBR cycles globally
  const allCyclesSnap = await getDocs(query(collection(db, 'wbrEntries'), orderBy('wbrDate', 'desc'), limit(50)));
  const uniqueDates = Array.from(new Set(allCyclesSnap.docs.map(d => d.data().wbrDate))).sort().reverse();
  
  let currentWbrDateStr = uniqueDates[0] || "";
  let prevWbrDateStr = uniqueDates[1] || "";

  // OPTIMIZATION RITUAL: Apply strict limits and window constraints to all gathered data
  const [
    kpisSnap, prevKpisSnap,
    spendsSnap, prevSpendsSnap, prePrevSpendsSnap, yearlySpendsSnap,
    weeklySpendsSnap, kpiWeeklySnap,
    wbrSnap, prevWbrSnap
  ] = await Promise.all([
    getDocs(query(collection(db, 'kpis'), where('month', '==', month), limit(200))),
    getDocs(query(collection(db, 'kpis'), where('month', '==', prevMonthStr), limit(200))),
    getDocs(query(collection(db, 'monthlySpends'), where('month', '==', month), limit(200))),
    getDocs(query(collection(db, 'monthlySpends'), where('month', '==', prevMonthStr), limit(200))),
    getDocs(query(collection(db, 'monthlySpends'), where('month', '==', prePrevMonthStr), limit(200))),
    getDocs(query(collection(db, 'monthlySpends'), where('month', '>=', yearStart), where('month', '<=', month), limit(500))),
    getDocs(query(collection(db, 'weeklySpends'), where('month', '==', month), limit(300))),
    getDocs(query(collection(db, 'kpiWeeklyData'), where('month', '==', month), limit(500))),
    currentWbrDateStr ? getDocs(query(collection(db, 'wbrEntries'), where('wbrDate', '==', currentWbrDateStr), limit(200))) : Promise.resolve({ docs: [] } as any),
    prevWbrDateStr ? getDocs(query(collection(db, 'wbrEntries'), where('wbrDate', '==', prevWbrDateStr), limit(200))) : Promise.resolve({ docs: [] } as any)
  ]);

  const kpis = kpisSnap.docs.map(d => ({ id: d.id, ...d.data() } as KpiData));
  const currentSpends = spendsSnap.docs.map(d => d.data() as MonthlySpend);
  const prevSpends = prevSpendsSnap.docs.map(d => d.data() as MonthlySpend);
  const yearlySpends = yearlySpendsSnap.docs.map(d => d.data() as MonthlySpend);
  const weeklySpends = weeklySpendsSnap.docs.map(d => d.data() as WeeklySpend);
  const kpiWeekly = kpiWeeklySnap.docs.map(d => d.data() as KpiWeeklyData);
  const wbrEntries = wbrSnap.docs.map(d => ({ id: d.id, ...d.data() } as WbrEntry));
  const prevWbrEntries = prevWbrSnap.docs.map(d => ({ id: d.id, ...d.data() } as WbrEntry));

  // FINANCIAL CALCULATIONS
  const yearlyTotal = yearlySpends.reduce((a, b) => a + (b.actualSpendsInr || 0), 0);
  const monthlyTotal = currentSpends.reduce((a, b) => a + (b.actualSpendsInr || 0), 0);
  const prevMonthlyTotal = prevSpends.reduce((a, b) => a + (b.actualSpendsInr || 0), 0);
  
  const getMap = (data: any[], keyField: string, valField: string) => data.reduce((acc, d) => {
    acc[d[keyField]] = (acc[d[keyField]] || 0) + (d[valField] || 0);
    return acc;
  }, {} as Record<string, number>);

  const getMetaMap = (data: any[]) => data.reduce((acc, d) => {
    if (!acc[d.brandName]) acc[d.brandName] = { type: d.type || 'N/A', team: d.team || 'N/A', kpi: '' };
    return acc;
  }, {} as Record<string, any>);

  const yearlyAvgMap: Record<string, number> = {};
  const yearlyMetaMap = getMetaMap(yearlySpends);
  const clientMonths: Record<string, Set<string>> = {};
  
  yearlySpends.forEach(s => {
    yearlyAvgMap[s.brandName] = (yearlyAvgMap[s.brandName] || 0) + (s.actualSpendsInr || 0);
    if (!clientMonths[s.brandName]) clientMonths[s.brandName] = new Set();
    clientMonths[s.brandName].add(s.month);
  });
  
  Object.keys(yearlyAvgMap).forEach(brand => {
    yearlyAvgMap[brand] = yearlyAvgMap[brand] / clientMonths[brand].size;
  });

  const { gainers: yGainers, losers: yLosers } = getShifts(getMap(currentSpends, 'brandName', 'actualSpendsInr'), yearlyAvgMap, yearlyMetaMap, 'spend');
  const { gainers: mGainers, losers: mLosers } = getShifts(getMap(currentSpends, 'brandName', 'actualSpendsInr'), getMap(prevSpends, 'brandName', 'actualSpendsInr'), getMetaMap([...currentSpends, ...prevSpends]), 'spend');

  const weeksArr = Array.from(new Set(weeklySpends.map(s => s.week))).sort();
  const lastWeek = weeksArr[weeksArr.length - 1] || '';
  const prevWeek = weeksArr[weeksArr.length - 2] || '';
  const lastWSpends = weeklySpends.filter(s => s.week === lastWeek);
  const prevWSpends = weeklySpends.filter(s => s.week === prevWeek);
  const lastWTotal = lastWSpends.reduce((a, b) => a + (b.spendsInr || 0), 0);
  const prevWTotal = prevWSpends.reduce((a, b) => a + (b.spendsInr || 0), 0);
  const { gainers: wGainers, losers: wLosers } = getShifts(getMap(lastWSpends, 'brandName', 'spendsInr'), getMap(prevWSpends, 'brandName', 'spendsInr'), getMetaMap([...lastWSpends, ...prevWSpends]), 'spend');

  // DUAL RAG HEALTH ASSESSMENT (WBR BASED)
  const pCounts = { Green: 0, Amber: 0, Red: 0 };
  const eCounts = { Green: 0, Amber: 0, Red: 0 };
  const ragAdvancements: PerformanceShift[] = [];
  const ragRisks: PerformanceShift[] = [];

  wbrEntries.forEach(curr => {
    if (curr.performanceRag in pCounts) pCounts[curr.performanceRag as keyof typeof pCounts]++;
    if (curr.engagementRag in eCounts) eCounts[curr.engagementRag as keyof typeof eCounts]++;

    const prev = prevWbrEntries.find(p => p.clientId === curr.clientId);
    const brand = curr.clientName || curr.clientId;
    const team = curr.clusterLead || 'N/A';
    
    if (!prev) return;

    // Detect Performance Movement
    if (curr.performanceRag !== prev.performanceRag) {
       const shift: PerformanceShift = { 
         brand, direction: 'achievement', type: 'PERFORMANCE', team, variance: 0, 
         from: prev.performanceRag, to: curr.performanceRag, 
         reason: curr.summary || 'Operational review updated.' 
       };
       if (['Red', 'Amber'].includes(prev.performanceRag) && curr.performanceRag === 'Green') {
         shift.direction = 'recovery';
         ragAdvancements.push(shift);
       } else if (prev.performanceRag === 'Green' && ['Red', 'Amber'].includes(curr.performanceRag)) {
         shift.direction = 'decline';
         ragRisks.push(shift);
       }
    }

    // Detect Engagement Movement
    if (curr.engagementRag !== prev.engagementRag) {
        const shift: PerformanceShift = { 
          brand, direction: 'achievement', type: 'ENGAGEMENT', team, variance: 0, 
          from: prev.engagementRag, to: curr.engagementRag, 
          reason: curr.financeIssues || curr.summary || 'Engagement context updated.' 
        };
        if (['Red', 'Amber'].includes(prev.engagementRag) && curr.engagementRag === 'Green') {
          shift.direction = 'recovery';
          ragAdvancements.push(shift);
        } else if (prev.engagementRag === 'Green' && ['Red', 'Amber'].includes(curr.engagementRag)) {
          shift.direction = 'decline';
          ragRisks.push(shift);
        }
    }
  });

  const totalUniqueClients = wbrEntries.length;
  const weightedHealthScore = totalUniqueClients > 0 
    ? ((pCounts.Green * 1.0 + pCounts.Amber * 0.5) / totalUniqueClients) * 100 
    : 0;

  const teamComments = kpiWeekly.filter(w => w.comment).map(w => {
    const kpi = kpis.find(k => k.id === w.kpiDataId);
    return { team: kpi?.cduLead || 'Unknown', csm: kpi?.emCsm || 'Unknown', comment: w.comment || "", client: kpi?.clientName || 'Unknown', kpi: kpi?.kpi || 'Metric' };
  });

  const aiResult = await generateBusinessSnapshot({
    month,
    performance: { totalClients: totalUniqueClients, green: pCounts.Green, amber: pCounts.Amber, red: pCounts.Red, last4WeeksAchieved: 0 },
    spends: { currentMonthTotal: monthlyTotal, prevMonthTotal: prevMonthlyTotal, variance: prevMonthlyTotal > 0 ? ((monthlyTotal - prevMonthlyTotal) / prevMonthlyTotal) * 100 : 0, last4WeeksTotal: lastWTotal },
    highlights: [],
    teamComments
  });

  const snapshot: BusinessSnapshot = {
    month,
    content: aiResult.snapshot,
    updatedAt: new Date().toISOString(),
    stats: {
      totalKpis: kpis.length,
      greenKpis: pCounts.Green, amberKpis: pCounts.Amber, redKpis: pCounts.Red,
      totalSpend: monthlyTotal, prevMonthSpend: prevMonthlyTotal, spendGrowth: prevMonthlyTotal > 0 ? ((monthlyTotal - prevMonthlyTotal) / prevMonthlyTotal) * 100 : 0,
      totalUniqueClients, greenClients: pCounts.Green, amberClients: pCounts.Amber, redClients: pCounts.Red,
      
      wbrCycleDate: currentWbrDateStr,
      performanceRag: pCounts,
      engagementRag: eCounts,

      weightedHealthScore,
      netMomentum: ragAdvancements.length - ragRisks.length,
      totalStatusShifts: ragAdvancements.length + ragRisks.length,

      yearlySpend: yearlyTotal, yearlySpendGrowth: 0, yearlySpendGainers: yGainers, yearlySpendLosers: yLosers,
      monthlySpend: monthlyTotal, monthlySpendGrowth: prevMonthlyTotal > 0 ? ((monthlyTotal - prevMonthlyTotal) / prevMonthlyTotal) * 100 : 0,
      monthlySpendGainers: mGainers, monthlySpendLosers: mLosers,
      weeklySpend: lastWTotal, weeklySpendGrowth: prevWTotal > 0 ? ((lastWTotal - prevWTotal) / prevWTotal) * 100 : 0,
      weeklySpendGainers: wGainers, weeklySpendLosers: wLosers, weeklyDate: lastWeek,
      monthlyKpiAchieved: totalUniqueClients > 0 ? (pCounts.Green / totalUniqueClients) * 100 : 0,
      weeklyKpiAchieved: 0,
      monthlyKpiGainers: [], 
      monthlyKpiLosers: [],
      weeklyKpiGainers: [], 
      weeklyKpiLosers: [],
      orgKpiWins: [],
      orgKpiRisks: [],
      orgCapabilityScore: 0,
      spendsLastMonth: monthlyTotal, spendsLast4Weeks: lastWTotal,
      kpisLastMonth: { target: 0, achieved: 0, rate: totalUniqueClients > 0 ? (pCounts.Green / totalUniqueClients) * 100 : 0 },
      kpisLast4Weeks: { achieved: 0 },
      spendShifts: wGainers.concat(wLosers),
      kpiShifts: [],
      ragAdvancements,
      ragRisks
    }
  };

  await setDoc(doc(db, 'businessSnapshots', month), snapshot).catch(e => {
    errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `/businessSnapshots/${month}`, operation: 'write' }));
    throw e;
  });
  return snapshot;
};
