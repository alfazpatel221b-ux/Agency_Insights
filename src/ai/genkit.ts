import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

/**
 * Genkit instance initialized with Google AI plugin.
 * The plugin automatically looks for GOOGLE_GENAI_API_KEY or GEMINI_API_KEY in environment variables.
 * Ensure you have set one of these in your .env file with a valid Google AI API key.
 */
export const ai = genkit({
  plugins: [
    googleAI(),
  ],
});

export { z };
