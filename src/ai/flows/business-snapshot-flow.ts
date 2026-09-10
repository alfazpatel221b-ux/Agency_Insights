'use server';
/**
 * @fileOverview AI flow to generate a high-level "Business Snapshot" cross-referencing KPIs and Spends.
 */

import { ai, z } from '@/ai/genkit';

const BusinessSnapshotInputSchema = z.object({
  month: z.string(),
  performance: z.object({
    totalClients: z.number(),
    green: z.number(),
    amber: z.number(),
    red: z.number(),
    last4WeeksAchieved: z.number(),
  }),
  spends: z.object({
    currentMonthTotal: z.number(),
    prevMonthTotal: z.number(),
    variance: z.number(),
    last4WeeksTotal: z.number(),
  }),
  highlights: z.array(z.object({
    client: z.string(),
    kpi: z.string(),
    status: z.string(),
    spend: z.number(),
    comment: z.string().optional(),
    team: z.string().optional(),
    csm: z.string().optional(),
  })),
  teamComments: z.array(z.object({
    team: z.string(),
    csm: z.string(),
    comment: z.string(),
    kpi: z.string().optional(),
    client: z.string().optional(),
  })),
});

export type BusinessSnapshotInput = z.infer<typeof BusinessSnapshotInputSchema>;

const BusinessSnapshotOutputSchema = z.object({
  snapshot: z.string().describe('The AI generated business summary in pointers and sections with emojis.'),
});

export type BusinessSnapshotOutput = z.infer<typeof BusinessSnapshotOutputSchema>;

const snapshotPrompt = ai.definePrompt({
  name: 'businessSnapshotPrompt',
  model: 'googleai/gemini-2.5-flash',
  input: { schema: BusinessSnapshotInputSchema },
  output: { schema: BusinessSnapshotOutputSchema },
  config: { temperature: 0.3 },
  prompt: `You are the Lead Strategist at Agency Insights. Generate a structured strategic review for {{month}}.

DATA CONTEXT:
- PORTFOLIO HEALTH: {{performance.totalClients}} unique clients ({{performance.green}} Green, {{performance.amber}} Amber, {{performance.red}} Red).
- WEEKLY KPI PULSE: {{performance.last4WeeksAchieved}} units achieved in last 4 weeks.
- SPENDS PULSE: Total spends are ₹{{spends.currentMonthTotal}} (Variance of {{spends.variance}}% MoM).

TEAM & CSM FEEDBACK (QUALITATIVE INTELLIGENCE):
{{#each teamComments}}
- [{{this.team}} / {{this.csm}}] on {{this.client}} ({{this.kpi}}): "{{this.comment}}"
{{/each}}

INSTRUCTIONS:
1. Be extremely concise and data-driven.
2. Provide the summary in exactly 3 sections.
3. YOU MUST USE numbered pointers (1, 2, 3...) for every observation within a section.
4. Each numbered point MUST start on its own new line.
5. YOU MUST USE EMOJIS for every section header.
6. Do not use markdown headers like #. Use bold text for section names.

STRUCTURE:
1. 📈 KPI PERFORMANCE:
   1. [Concise assessment of portfolio health and success rate]
   2. [Identification of top-performing metric categories like ROAS or Leads]

2. 💸 SPENDS STRATEGY:
   1. [Analysis of spends velocity and variance trend]
   2. [Observation on spending efficiency]

3. 💬 TEAM INTELLIGENCE:
   1. [Synthesis of common reasons for shortfalls from CSM comments]
   2. [Summary of tactical actions being taken by the ground teams]

FORMAT:
Bold section names with emojis. Numbered sub-pointers. Double newlines between sections.`,
});

function fallbackSnapshot(input: BusinessSnapshotInput): BusinessSnapshotOutput {
  return { snapshot: `**📈 KPI PERFORMANCE**
1. Portfolio health is ${input.performance.green} Green / ${input.performance.amber} Amber / ${input.performance.red} Red across ${input.performance.totalClients} clients.

**💸 SPENDS STRATEGY**
1. Current-month spends are ₹${Math.round(input.spends.currentMonthTotal).toLocaleString('en-IN')}, with a ${input.spends.variance.toFixed(1)}% month-on-month variance.

**💬 TEAM INTELLIGENCE**
1. Weekly comments and action signals indicate active pacing and optimisation work across the portfolio.
2. Continue closing the highest-impact actions in the next review cycle.` };
}

export async function generateBusinessSnapshot(input: BusinessSnapshotInput): Promise<BusinessSnapshotOutput> {
  if (!process.env.GOOGLE_GENAI_API_KEY && !process.env.GEMINI_API_KEY) return fallbackSnapshot(input);
  const { output } = await snapshotPrompt(input);
  if (!output) throw new Error('AI failed to generate business snapshot.');
  return output;
}
