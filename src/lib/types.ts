
export interface UserProfile {
    id: string;
    uid: string;
    displayName: string;
    email: string;
    role: string;
    photoURL: string;
    status?: 'Invite sent' | 'User Registered' | 'Pending';
    permissions?: string[];
}

export type ActionSection = "CLIENT ENGAGEMENT" | "SALES" | "OPERATIONS" | "AGENCY INSIGHTS" | "HR" | "MANAGEMENT";
export type ActionStatus = "Work-In Progress" | "Completed" | "Overdue" | "On-Hold" | "Observation";
export type ActionPriority = "Low" | "Medium" | "High" | "Critical";

export interface ActionCommentEntry {
    id: string;
    text: string;
    /** ISO timestamp when the comment was added */
    createdAt: string;
    author?: string;
}

export interface ActionItem {
    id: string;
    taskName: string;
    description: string;
    assignedTo: string;
    section: ActionSection;
    clientId?: string;
    clientName?: string;
    /** Latest comment text (kept for backward compatibility / quick display). */
    comment: string;
    /** History of comments with dates (newest last in storage). Entries can be deleted. */
    commentHistory?: ActionCommentEntry[];
    status: ActionStatus;
    priority: ActionPriority;
    dueDate?: string;
    createdAt: string;
    updatedAt: string;
}

export interface KpiData {
  id: string;
  clientId: string;
  clientName: string;
  cluster: string;
  channel: string;
  kpi: string;
  kpiType: 'PRIMARY' | 'NON-PRIMARY';
  month: string;
  targetMonth: number;
  achievedMonthTillYesterday: number;
  targetMonthTillYesterday: number;
  lob: string;
  type: string;
  cduLead: string;
  emCsm: string;
  direction?: 'ASC' | 'DESC';
  pacingStatus?: 'Green' | 'Amber' | 'Red' | 'N/A';
  currency?: string;
  uploadRecordId?: string;
}

export interface KpiWeeklyData {
  id: string;
  kpiDataId: string;
  weekOfMonth: number;
  target: number;
  achieved: number;
  comment?: string;
  month?: string; 
}

export type RagStatus = 'Green' | 'Amber' | 'Red' | 'N/A';

export interface MonthlySpend {
  id: string;
  uploadRecordId?: string;
  clientId: string;
  brandName: string;
  industry: string;
  type: string;
  subEntity: string;
  channelVendor: string;
  creditLine: string;
  currency: string;
  team: string;
  month: string;
  actualSpendsInr: number;
}

export interface WeeklySpend {
  id: string;
  uploadRecordId?: string;
  clientId: string;
  brandName: string;
  industry: string;
  type: string;
  subEntity: string;
  channelVendor: string;
  creditLine: string;
  currency: string;
  team: string;
  week: string;
  month?: string; 
  spendsInr: number;
}

export type LeadStatus = 'Unqualified' | 'Qualified' | 'Pitch' | 'Negotiation' | 'Contract' | 'Won' | 'Lost';
export type ServiceType = 'Performance' | 'SEO' | 'Affiliates' | 'Branding' | 'Marketplace' | 'Creatives' | 'Social';

export interface Lead {
  id: string;
  companyName: string;
  phone?: string;
  status: LeadStatus;
  services: ServiceType[];
  estimatedValue: number;
  notes?: string;
  opportunityOwner?: string;
  expectedSpends?: number;
  retainerDetails?: string;
  expectedGoLiveDate?: string;
  pitchDate?: string;
  teamAssigned?: string;
  uploadRecordId?: string;
  /** @deprecated Removed from Sales Tracker form; retained for legacy records */
  contactPerson?: string;
  /** @deprecated Removed from Sales Tracker form; retained for legacy records */
  email?: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  uniqueId: string;
  name: string;
  cluster?: string;
  clusterLead?: string;
  emcsm?: string;
  subEntity?: string;
  clientPartner?: string;
}

/** Master list entry for KPI definitions (kpiDefinitions collection). */
export interface Kpi {
  id: string;
  name: string;
}

/** Master list entry for media channels (channels collection). */
export interface Channel {
  id: string;
  name: string;
}

export interface WbrEntry {
  id: string;
  clientId: string;
  clientName?: string;
  cluster?: string;
  clusterLead?: string;
  emcsm?: string;
  clientPartner?: string;
  wbrDate: string; 
  contractStatus: 'Valid' | 'Expired' | 'Negotiation';
  financeIssues: string;
  engagementRag: RagStatus;
  performanceRag: RagStatus;
  organicOpportunities: string;
  crossSellOpportunities: string;
  performanceSummary?: string;
  summary: string;
  updatedAt: string;
}

export interface PerformanceShift {
  brand: string;
  direction: 'increase' | 'decrease' | 'achievement' | 'slacking' | 'recovery' | 'decline';
  type: string;
  team: string;
  variance: number;
  amount?: number;
  kpi?: string;
  from?: string;
  to?: string;
  reason?: string;
}

export interface BusinessSnapshot {
  id?: string;
  month: string;
  content: string;
  updatedAt: string;
  stats: {
    totalKpis: number;
    greenKpis: number;
    amberKpis: number;
    redKpis: number;
    totalSpend: number;
    prevMonthSpend: number;
    spendGrowth: number;
    
    totalUniqueClients: number;
    greenClients: number;
    amberClients: number;
    redClients: number;

    // Dual RAG Health
    wbrCycleDate?: string;
    performanceRag: { Green: number; Amber: number; Red: number };
    engagementRag: { Green: number; Amber: number; Red: number };

    weightedHealthScore: number;
    netMomentum: number;
    totalStatusShifts: number;

    yearlySpend: number;
    yearlySpendGrowth: number;
    yearlySpendGainers: PerformanceShift[];
    yearlySpendLosers: PerformanceShift[];

    monthlySpend: number;
    monthlySpendGrowth: number;
    monthlySpendGainers: PerformanceShift[];
    monthlySpendLosers: PerformanceShift[];

    weeklySpend: number;
    weeklySpendGrowth: number;
    weeklySpendGainers: PerformanceShift[];
    weeklySpendLosers: PerformanceShift[];
    weeklyDate: string;

    monthlyKpiAchieved: number;
    weeklyKpiAchieved: number;
    monthlyKpiGainers: PerformanceShift[];
    monthlyKpiLosers: PerformanceShift[];
    weeklyKpiGainers: PerformanceShift[];
    weeklyKpiLosers: PerformanceShift[];

    orgKpiWins: PerformanceShift[];
    orgKpiRisks: PerformanceShift[];
    orgCapabilityScore: number;

    spendsLastMonth: number;
    spendsLast4Weeks: number;
    kpisLastMonth: { target: number; achieved: number; rate: number };
    kpisLast4Weeks: { achieved: number };
    spendShifts: PerformanceShift[];
    kpiShifts: PerformanceShift[];
    
    ragAdvancements: PerformanceShift[];
    ragRisks: PerformanceShift[];
  };
}
