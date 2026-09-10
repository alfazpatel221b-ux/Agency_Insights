'use server';
/**
 * @fileOverview AI flow to generate strategic performance insights for a cluster based on KPI data and team comments.
 *
 * - generateClusterInsights - A function that handles the generation of performance insights.
 * - ClusterInsightsInput - The input type for the insights function.
 * - ClusterInsightsOutput - The return type for the insights function.
 */

import { ai, z } from '@/ai/genkit';

const ClusterInsightsInputSchema = z.object({
  clusterName: z.string(),
  leadName: z.string(),
  month: z.string(),
  kpiStats: z.object({
    total: z.number(),
    green: z.number(),
    amber: z.number(),
    red: z.number(),
  }),
  kpiDetails: z.array(z.object({
    clientName: z.string(),
    kpi: z.string(),
    status: z.string(),
    target: z.number(),
    achieved: z.number(),
    comments: z.array(z.string()),
  })),
});
export type ClusterInsightsInput = z.infer<typeof ClusterInsightsInputSchema>;

const ClusterInsightsOutputSchema = z.object({
  insights: z.string().describe('The AI generated insights for the cluster.'),
});
export type ClusterInsightsOutput = z.infer<typeof ClusterInsightsOutputSchema>;

const insightsPrompt = ai.definePrompt({
  name: 'clusterInsightsPrompt',
  model: 'googleai/gemini-2.5-flash',
  input: { schema: ClusterInsightsInputSchema },
  output: { schema: ClusterInsightsOutputSchema },
  config: {
    temperature: 0.4,
  },
  prompt: `You are a senior agency performance analyst. Generate a strategic review for Cluster "{{clusterName}}" for {{month}}.

DATA SUMMARY:
- Total Accounts: {{kpiStats.total}}
- G/A/R: {{kpiStats.green}} Green / {{kpiStats.amber}} Amber / {{kpiStats.red}} Red

DETAILED KPI ANALYSIS:
{{#each kpiDetails}}
- {{this.clientName}} ({{this.kpi}}): {{this.status}} (Target: {{this.target}}, Achieved: {{this.achieved}})
  {{#if this.comments}}Context: {{#each this.comments}} "{{{this}}}" {{/each}}{{/if}}
{{/each}}

INSTRUCTIONS:
- Be extremely concise. 
- You MUST use numbered pointers (1, 2, 3...) for EVERY observation within a section.
- You MUST use double newlines between each main section (1, 2, 3, 4).
- Each numbered point MUST start on its own new line.
- No conversational filler. Focus strictly on numbers and specific risks.

STRUCTURE:
1. HEALTH SCORE:
   1. [Concise 1-sentence numeric assessment]

2. TOP PERFORMANCE:
   1. [Numeric win pointer 1]
   2. [Numeric win pointer 2]

3. CRITICAL RISKS:
   1. [Account risk with variance %]
   2. [Account risk with variance %]

4. ACTION ITEMS:
   1. [Specific next step 1]
   2. [Specific next step 2]`,
});

const clusterInsightsFlow = ai.defineFlow(
  {
    name: 'clusterInsightsFlow',
    inputSchema: ClusterInsightsInputSchema,
    outputSchema: ClusterInsightsOutputSchema,
  },
  async (input) => {
    try {
      const { output } = await insightsPrompt(input);
      if (!output) {
        throw new Error('AI failed to generate a response.');
      }
      return output;
    } catch (error: any) {
      console.error('Genkit Generate Error:', error);
      throw new Error(`AI Insight Generation failed: ${error.message}`);
    }
  }
);

export async function generateClusterInsights(input: ClusterInsightsInput): Promise<ClusterInsightsOutput> {
  return clusterInsightsFlow(input);
}
