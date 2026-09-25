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

const channels = ['Google','Meta','LinkedIn','YouTube','Amazon','Flipkart','Blinkit','Instamart','Affiliates','Branding'];
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

  // Expand the demo channel mix and backfill any missing spend rows.
  await put(db, channels.map((name) => ({
    p: `channels/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    d: { name },
  })));

  const existingMonthlyIds = new Set(monthlySnap.docs.map((d) => d.id));
  const existingWeeklyIds = new Set(weeklySnap.docs.map((d) => d.id));
  const channelBackfill: any[] = [];

  clients.forEach((c, ci) => months.forEach((m, mi) => {
    channels.forEach((ch, chi) => {
      const id = `m_${c[0]}_${m}_${chi}`;
      if (existingMonthlyIds.has(id)) return;
      channelBackfill.push({
        p: `monthlySpends/${id}`,
        d: {
          uploadRecordId: id,
          clientId: c[0],
          brandName: c[1],
          industry: c[2],
          type: 'PERFORMANCE',
          subEntity: c[3],
          channelVendor: ch,
          creditLine: 'Demo Media',
          currency: 'INR',
          team: teams[ci % 4],
          month: m,
          actualSpendsInr: Math.round(
            (650000 + ci * 90000 + mi * 18000) *
            (0.72 + chi * 0.055) *
            monthlySpendCurve[mi]
          ),
        },
      });
    });
  }));

  weeks.forEach((ws, wi) => clients.forEach((c, ci) => channels.forEach((ch, chi) => {
    const week = format(ws, 'dd-MM-yyyy');
    const id = `w_${c[0]}_${week}_${chi}`;
    if (existingWeeklyIds.has(id)) return;
    channelBackfill.push({
      p: `weeklySpends/${id}`,
      d: {
        uploadRecordId: id,
        clientId: c[0],
        brandName: c[1],
        industry: c[2],
        type: 'PERFORMANCE',
        subEntity: c[3],
        channelVendor: ch,
        creditLine: 'Demo Media',
        currency: 'INR',
        team: teams[ci % 4],
        week,
        month: format(ws, 'yyyy-MM'),
        spendsInr: Math.round(
          (150000 + ci * 20000) *
          (0.72 + chi * 0.055) *
          weeklySpendCurve[wi]
        ),
      },
    });
  })));

  if (channelBackfill.length) await put(db, channelBackfill);

  // Populate every WBR field for every synthetic client so the Engagement
  // Review and Operational Review sections are never empty in the demo.
  const wbrSnap = await getDocs(collection(db, 'wbrEntries'));
  const wbrByClient = new Map<string, { id: string; data: any }>();
  wbrSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.clientId) wbrByClient.set(String(data.clientId), { id: d.id, data });
  });

  clients.forEach((c, ci) => {
    const existing = wbrByClient.get(c[0]);
    const wbrId = existing?.id || `wbr_${c[0]}_${format(week0, 'yyyy-MM-dd')}`;
    const tone = ['Green', 'Green', 'Amber', 'Green', 'Amber', 'Red'][ci];
    const patch = {
      clientId: c[0],
      clientName: c[1],
      cluster: c[2],
      clusterLead: c[4],
      emcsm: c[5],
      clientPartner: 'Demo Partner',
      wbrDate: format(week0, 'yyyy-MM-dd'),
      contractStatus: ci === 5 ? 'Negotiation' : 'Valid',
      engagementRag: tone,
      performanceRag: ['Green', 'Amber', 'Green', 'Green', 'Amber', 'Red'][ci],
      financeIssues: [
        'No open billing issues. Monthly reconciliation is on track.',
        'Invoice mapping is being monitored; no material client impact.',
        'No finance exceptions reported this cycle.',
        'PO and invoice alignment reviewed with the client team.',
        'Minor billing follow-up remains with the finance desk.',
        'Renewal commercials are under review alongside contract discussions.',
      ][ci],
      organicOpportunities: [
        'SEO content expansion and category-page optimization identified as a growth opportunity.',
        'Local SEO and mobility-intent landing pages can be expanded.',
        'Thought-leadership content and high-intent finance search themes identified.',
        'Destination content and SEO-led demand capture can be scaled.',
        'Condition-led content and organic health education themes offer incremental reach.',
        'Product/category SEO and shopping-content expansion identified.',
      ][ci],
      crossSellOpportunities: [
        'Explore CRM remarketing and marketplace media alongside paid search.',
        'Evaluate creative testing and affiliate acquisition to complement paid media.',
        'Explore LinkedIn lead generation and content-led demand generation.',
        'Evaluate paid social and affiliate partnerships for incremental bookings.',
        'Explore YouTube awareness and performance creative testing.',
        'Evaluate marketplace advertising and creator/affiliate partnerships.',
      ][ci],
      performanceSummary: [
        'Paid media is pacing steadily with channel mix providing room for incremental scale.',
        'Performance is mixed across channels; efficiency recovery is being monitored weekly.',
        'Lead volume is healthy while CPA remains the primary optimization focus.',
        'Demand is recovering with channel-level volatility being actively managed.',
        'Performance is stable overall with opportunity to improve upper-funnel contribution.',
        'Efficiency is under pressure in selected channels; corrective actions are in flight.',
      ][ci],
      summary: [
        'Client engagement remains healthy. The focus for the next cycle is controlled scale and channel diversification.',
        'Stakeholders remain engaged. The immediate priority is restoring efficiency while protecting qualified volume.',
        'Business conversations are constructive. Lead quality and CPA are the key topics for the next review.',
        'Client sentiment is positive with attention on recovering demand and improving channel consistency.',
        'The account is engaged and collaborative. Growth opportunities are being balanced with efficiency.',
        'The account requires closer leadership attention around performance and commercial discussions.',
      ][ci],
      updatedAt: new Date().toISOString(),
    };
    repairs.push({ p: `wbrEntries/${wbrId}`, d: patch });
  });

  // Keep the Action Board visibly populated across every workflow status.
  const actionStatuses = ['Work-In Progress', 'On-Hold', 'Observation', 'Overdue', 'Completed'] as const;
  const actionSections = ['CLIENT ENGAGEMENT', 'SALES', 'OPERATIONS', 'AGENCY INSIGHTS', 'HR', 'MANAGEMENT'];
  const actionTemplates = [
    'Review weekly client performance and confirm next actions',
    'Follow up on pending client dependency and unblock owner',
    'Capture optimization observation from channel review',
    'Escalate overdue delivery item and confirm recovery date',
    'Close completed reporting / review deliverable',
    'Validate next-cycle spend and KPI assumptions',
    'Review sales pipeline capacity against delivery plan',
    'Refresh executive snapshot commentary before WBR',
    'Confirm operational handover checklist completion',
    'Document cross-sell opportunity from account review',
  ];
  actionTemplates.forEach((taskName, i) => {
    const status = actionStatuses[i % actionStatuses.length];
    const dueOffset = status === 'Overdue' ? -3 : status === 'Completed' ? -2 : (i + 2);
    const c = clients[i % clients.length];
    const id = `demo_action_${i + 1}`;
    repairs.push({
      p: `actionItems/${id}`,
      d: {
        id,
        taskName,
        description: 'Synthetic action item for portfolio demonstration.',
        assignedTo: ['Aarav','Meera','Dev','Riya'][i % 4],
        section: actionSections[i % actionSections.length],
        clientId: c[0],
        clientName: c[1],
        comment: 'Demo action with synthetic context and ownership.',
        status,
        priority: ['Low', 'Medium', 'High', 'Critical'][i % 4],
        dueDate: format(new Date(Date.now() + dueOffset * 86400000), 'yyyy-MM-dd'),
        createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
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
  clients.forEach((c, ci) => rows.push({
    p: `wbrEntries/wbr_${c[0]}_${cycle}`,
    d: {
      clientId: c[0], clientName: c[1], cluster: c[2], clusterLead: c[4], emcsm: c[5],
      clientPartner: 'Demo Partner', wbrDate: cycle,
      contractStatus: ci === 5 ? 'Negotiation' : 'Valid',
      engagementRag: ['Green', 'Green', 'Amber', 'Green', 'Amber', 'Red'][ci],
      performanceRag: ['Green', 'Amber', 'Green', 'Green', 'Amber', 'Red'][ci],
      financeIssues: 'No open material finance issues; reconciliation is being tracked.',
      organicOpportunities: 'Synthetic organic growth opportunity identified from the account review.',
      crossSellOpportunities: 'Synthetic cross-sell opportunity identified for the next review cycle.',
      performanceSummary: 'Synthetic weekly performance summary with channel-level observations.',
      summary: 'Synthetic executive summary covering client engagement, performance and next actions.',
      updatedAt: new Date().toISOString(),
    },
  }));

  const actionStatuses = ['Work-In Progress', 'On-Hold', 'Observation', 'Overdue', 'Completed'] as const;
  const actionTasks = ['Review channel pacing','Follow up client dependency','Capture optimization observation','Escalate overdue deliverable','Close WBR deliverable','Validate forecast','Review sales capacity','Refresh executive snapshot','Confirm handover checklist','Document cross-sell opportunity'];
  for (let i = 0; i < 15; i++) {
    const c = clients[i % clients.length];
    const status = actionStatuses[i % actionStatuses.length];
    const dueOffset = status === 'Overdue' ? -3 : status === 'Completed' ? -2 : i + 2;
    const id = `demo_action_${i + 1}`;
    rows.push({
      p: `actionItems/${id}`,
      d: {
        id,
        taskName: actionTasks[i % actionTasks.length],
        description: 'Synthetic portfolio action for demonstration.',
        assignedTo: ['Aarav','Meera','Dev','Riya'][i % 4],
        section: ['CLIENT ENGAGEMENT','SALES','OPERATIONS','AGENCY INSIGHTS','HR','MANAGEMENT'][i % 6],
        clientId: c[0],
        clientName: c[1],
        comment: 'Demo action with synthetic context.',
        status,
        priority: ['Low','Medium','High','Critical'][i % 4],
        dueDate: format(new Date(Date.now() + dueOffset * 86400000), 'yyyy-MM-dd'),
        createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
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
