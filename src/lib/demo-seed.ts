'use client';
import { collection, doc, getDocs, limit, query, writeBatch, type Firestore } from 'firebase/firestore';
import { format, subMonths, subWeeks, startOfMonth, startOfWeek } from 'date-fns';

const clients = [
  ['CLID0081','Orion Retail','RETAIL','NORTH','Asha Mehta','Rohan Shah'],
  ['CLID0084','Nova Mobility','MOBILITY','WEST','Kabir Rao','Maya Iyer'],
  ['CLID0102','Atlas Finance','FINANCE','SOUTH','Neha Kapoor','Arjun Sen'],
  ['CLID0114','Northstar Travel','TRAVEL','WEST','Vikram Jain','Ishita Rao'],
  ['CLID0128','Ember Health','HEALTHCARE','NORTH','Priya Nair','Aditya Bose'],
  ['CLID0141','Vertex Electronics','CONSUMER TECH','SOUTH','Sameer Kulkarni','Tara Menon'],
] as const;

const channels = ['Google','Meta','LinkedIn','YouTube'];
const teams = ['ORION','NOVA','ATLAS','NORTHSTAR'];

// Deliberately non-linear synthetic business patterns so demo charts resemble
// real operating data with peaks, dips, recoveries and occasional slowdowns.
const monthlySpendCurve = [0.94, 1.06, 0.91, 1.12, 1.03, 0.86, 1.08, 0.97, 1.15, 0.93, 1.05, 1.10];
const weeklySpendCurve = [0.98, 1.09, 0.93, 1.15, 0.88, 1.06, 0.96, 1.12];
const kpiPerformanceCurve = [0.96, 1.04, 0.91, 1.08, 0.99, 0.87, 1.05, 0.94, 1.09, 0.97, 1.03, 1.06];
const intraMonthKpiCurve = [0.94, 1.06, 0.97, 1.11, 0.92];

async function put(db: Firestore, rows: any[]) {
  for (let i = 0; i < rows.length; i += 450) {
    const batch = writeBatch(db);
    rows.slice(i, i + 450).forEach((r) => batch.set(doc(db, r.p), r.d, { merge: true }));
    await batch.commit();
  }
}

async function repairExistingDemoData(db: Firestore) {
  const repairs: any[] = [];

  const leadsSnap = await getDocs(collection(db, 'leads'));
  leadsSnap.docs.forEach((leadDoc) => {
    const data = leadDoc.data();
    if (typeof data.services === 'string') {
      repairs.push({ p: `leads/${leadDoc.id}`, d: { services: data.services.split(/[;,]/).map((s) => s.trim()).filter(Boolean) } });
    } else if (!Array.isArray(data.services)) {
      repairs.push({ p: `leads/${leadDoc.id}`, d: { services: [] } });
    }
  });

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => format(subMonths(startOfMonth(now), 11 - i), 'yyyy-MM'));
  const week0 = startOfWeek(now, { weekStartsOn: 1 });
  const weeks = Array.from({ length: 8 }, (_, i) => startOfWeek(subWeeks(week0, 7 - i), { weekStartsOn: 1 }));

  const monthlySnap = await getDocs(collection(db, 'monthlySpends'));
  monthlySnap.docs.forEach((spendDoc) => {
    const data = spendDoc.data();
    const patch: Record<string, unknown> = {};
    if (data.creditLine == null) patch.creditLine = 'Demo Media';
    if (data.currency == null) patch.currency = 'INR';
    if (data.team == null) patch.team = 'DEMO';
    if (data.channelVendor == null) patch.channelVendor = 'Other';

    const ci = clients.findIndex((c) => c[0] === data.clientId);
    const chi = channels.indexOf(String(data.channelVendor));
    const mi = months.indexOf(String(data.month));
    if (ci >= 0 && chi >= 0 && mi >= 0) {
      patch.actualSpendsInr = Math.round(
        (650000 + ci * 90000 + mi * 18000) *
        (0.8 + chi * 0.12) *
        monthlySpendCurve[mi]
      );
    }
    if (Object.keys(patch).length) repairs.push({ p: `monthlySpends/${spendDoc.id}`, d: patch });
  });

  const weeklySnap = await getDocs(collection(db, 'weeklySpends'));
  weeklySnap.docs.forEach((spendDoc) => {
    const data = spendDoc.data();
    const patch: Record<string, unknown> = {};
    if (data.creditLine == null) patch.creditLine = 'Demo Media';
    if (data.currency == null) patch.currency = 'INR';
    if (data.team == null) patch.team = 'DEMO';
    if (data.channelVendor == null) patch.channelVendor = 'Other';

    let normalizedWeek = typeof data.week === 'string' ? data.week : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedWeek)) {
      const [year, month, day] = normalizedWeek.split('-');
      normalizedWeek = `${day}-${month}-${year}`;
      patch.week = normalizedWeek;
    }
    const wi = weeks.findIndex((w) => format(w, 'dd-MM-yyyy') === normalizedWeek);
    const ci = clients.findIndex((c) => c[0] === data.clientId);
    const chi = channels.indexOf(String(data.channelVendor));
    if (wi >= 0 && ci >= 0 && chi >= 0) {
      patch.spendsInr = Math.round(
        (150000 + ci * 20000) *
        (0.85 + chi * 0.08) *
        weeklySpendCurve[wi]
      );
      patch.month = format(weeks[wi], 'yyyy-MM');
    }
    if (Object.keys(patch).length) repairs.push({ p: `weeklySpends/${spendDoc.id}`, d: patch });
  });

  const kpiSnap = await getDocs(collection(db, 'kpis'));
  kpiSnap.docs.forEach((kpiDoc) => {
    const data = kpiDoc.data();
    const ci = clients.findIndex((c) => c[0] === data.clientId);
    const mi = months.indexOf(String(data.month));
    if (ci < 0 || mi < 0 || typeof data.targetMonth !== 'number') return;

    const kpiBase = Number(data.targetMonth);
    repairs.push({
      p: `kpis/${kpiDoc.id}`,
      d: {
        achievedMonthTillYesterday: Number((kpiBase * kpiPerformanceCurve[mi] * (1 + ci * 0.012)).toFixed(2)),
        targetMonthTillYesterday: Number((kpiBase * 0.92).toFixed(2)),
      },
    });

    for (let w = 1; w <= 5; w++) {
      repairs.push({
        p: `kpiWeeklyData/${kpiDoc.id}_w${w}`,
        d: {
          target: kpiBase,
          achieved: Number((kpiBase * kpiPerformanceCurve[mi] * intraMonthKpiCurve[w - 1] * (1 + ci * 0.01)).toFixed(2)),
        },
      });
    }
  });

  if (repairs.length) await put(db, repairs);
}

export async function seedDemoData(db: Firestore) {
  const clientsSnap = await getDocs(query(collection(db, 'clients'), limit(1)));
  if (!clientsSnap.empty) {
    await repairExistingDemoData(db);
    return false;
  }

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => format(subMonths(startOfMonth(now), 11 - i), 'yyyy-MM'));
  const week0 = startOfWeek(now, { weekStartsOn: 1 });
  const weeks = Array.from({ length: 8 }, (_, i) => startOfWeek(subWeeks(week0, 7 - i), { weekStartsOn: 1 }));
  const rows: any[] = [];

  clients.forEach((c, ci) => months.forEach((m, mi) => {
    channels.forEach((ch, chi) => {
      const id = `m_${c[0]}_${m}_${chi}`;
      rows.push({ p: `monthlySpends/${id}`, d: { uploadRecordId: id, clientId: c[0], brandName: c[1], industry: c[2], type: 'PERFORMANCE', subEntity: c[3], channelVendor: ch, creditLine: 'Demo Media', currency: 'INR', team: teams[ci % 4], month: m, actualSpendsInr: Math.round((650000 + ci * 90000 + mi * 18000) * (0.8 + chi * 0.12) * monthlySpendCurve[mi]) } });
    });

    [['ROAS','PRIMARY','ASC',4.2 + ci * .1,3.7 + (mi % 5) * .18], ['Leads','PRIMARY','ASC',240 + ci * 30,210 + (mi * 17 + ci * 11) % 120], ['CPA','NON-PRIMARY','DESC',850 - ci * 15,740 + (mi * 23 + ci * 9) % 170]].forEach((k, ki) => {
      const id = `k_${c[0]}_${m}_${ki}`;
      rows.push({ p: `kpis/${id}`, d: { month: m, clientId: c[0], clientName: c[1], cluster: c[2], channel: channels[(ci + ki) % 4], kpi: k[0], kpiType: k[1], type: 'Performance', direction: k[2], currency: 'INR', lob: c[3], cduLead: c[4], emCsm: c[5], targetMonth: k[3], achievedMonthTillYesterday: Number((k[3] * kpiPerformanceCurve[mi] * (1 + ci * 0.012)).toFixed(2)), targetMonthTillYesterday: Number((k[3] * .92).toFixed(2)), uploadRecordId: id } });
      for (let w = 1; w <= 5; w++) rows.push({ p: `kpiWeeklyData/${id}_w${w}`, d: { kpiDataId: id, weekOfMonth: w, month: m, target: k[3], achieved: Number((k[3] * kpiPerformanceCurve[mi] * intraMonthKpiCurve[w - 1] * (1 + ci * 0.01)).toFixed(2)), comment: w === 4 ? `${k[0]} pacing reviewed with the team.` : '' } });
    });
  }));

  weeks.forEach((ws, wi) => clients.forEach((c, ci) => channels.forEach((ch, chi) => {
    const week = format(ws, 'dd-MM-yyyy');
    const id = `w_${c[0]}_${week}_${chi}`;
    rows.push({ p: `weeklySpends/${id}`, d: { uploadRecordId: id, clientId: c[0], brandName: c[1], industry: c[2], type: 'PERFORMANCE', subEntity: c[3], channelVendor: ch, creditLine: 'Demo Media', currency: 'INR', team: teams[ci % 4], week, month: format(ws, 'yyyy-MM'), spendsInr: Math.round((150000 + ci * 20000) * (0.85 + chi * .08) * weeklySpendCurve[wi]) } });
  })));

  const cycle = format(week0, 'yyyy-MM-dd');
  clients.forEach((c, ci) => rows.push({ p: `wbrEntries/wbr_${c[0]}_${cycle}`, d: { clientId: c[0], clientName: c[1], cluster: c[2], clusterLead: c[4], emcsm: c[5], clientPartner: 'Demo Partner', wbrDate: cycle, contractStatus: 'Valid', engagementRag: ci % 4 === 3 ? 'Amber' : 'Green', performanceRag: ci % 4 === 2 ? 'Red' : ci % 4 === 1 ? 'Amber' : 'Green', financeIssues: 'No material finance issues.', summary: ci % 4 === 2 ? 'Recovery actions are being tracked weekly.' : 'Performance remains broadly on plan.', updatedAt: new Date().toISOString() } }));

  for (let i = 0; i < 12; i++) {
    const c = clients[i % clients.length]; const id = `demo_action_${i + 1}`;
    rows.push({ p: `actionItems/${id}`, d: { id, taskName: ['Review channel pacing','Refresh client WBR','Close tracking gap','Validate forecast'][i % 4], description: 'Synthetic portfolio action for demonstration.', assignedTo: 'Demo Team', section: ['CLIENT ENGAGEMENT','SALES','OPERATIONS','AGENCY INSIGHTS','HR','MANAGEMENT'][i % 6], clientId: c[0], clientName: c[1], comment: '', status: ['Work-In Progress','Completed','Overdue','On-Hold'][i % 4], priority: ['Low','Medium','High','Critical'][i % 4], dueDate: format(new Date(Date.now() + (i - 5) * 86400000), 'yyyy-MM-dd'), createdAt: new Date(Date.now() - i * 86400000).toISOString(), updatedAt: new Date().toISOString() } });
  }

  for (let i = 0; i < 10; i++) {
    rows.push({ p: `leads/demo_lead_${i + 1}`, d: { companyName: ['Pioneer Foods','Lumen Living','Cedar Finance','Orbit Learning','Harbor Hotels'][i % 5], phone: '', status: ['Qualified','Pitch','Negotiation','Contract','Won','Lost'][i % 6], services: [['Performance'],['SEO'],['Creatives']][i % 3], estimatedValue: 1200000 + i * 150000, notes: 'Synthetic opportunity for portfolio demonstration.', opportunityOwner: ['Aarav','Meera','Dev','Riya'][i % 4], expectedSpends: 450000 + i * 50000, teamAssigned: teams[i % 4], expectedGoLiveDate: format(new Date(Date.now() + (15 + i) * 86400000), 'yyyy-MM-dd'), pitchDate: format(new Date(Date.now() - (i + 2) * 86400000), 'yyyy-MM-dd'), updatedAt: new Date().toISOString() } });
  }

  await put(db, clients.map(c => ({ p: `clients/${c[0]}`, d: { uniqueId: c[0], name: c[1], cluster: c[2], subEntity: c[3], clusterLead: c[4], emcsm: c[5], clientPartner: 'Demo Partner' } })));
  await put(db, channels.map(n => ({ p: `channels/${n.toLowerCase()}`, d: { name: n } })));
  await put(db, ['ROAS','Leads','Revenue','CPA','Conversion Rate','GMV','Orders','New Customers'].map(n => ({ p: `kpiDefinitions/${n.toLowerCase().replaceAll(' ','-')}`, d: { name: n } })));
  await put(db, rows);
  return true;
}
