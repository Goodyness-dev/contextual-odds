import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // ── App ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),

  // ── Frontend ─────────────────────────────────────────────────────────────
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // ── AI (LLM for Scout Agent + Chat) ──────────────────────────────────────
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required').optional(),
  SAMBANOVA_API_KEY: z.string().min(1, 'SAMBANOVA_API_KEY is required').optional(),
  CEREBRAS_API_KEY: z.string().min(1, 'CEREBRAS_API_KEY is required').optional(),
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required').optional(),

  // ── Elastico Signal (Hackathon) ──────────────────────────────────────────
  SOLANA_WALLET_PATH: z.string().default('./devnet-wallet.json'),
  TXLINE_NETWORK: z.enum(['devnet', 'mainnet']).default('devnet'),
  SIGNAL_THRESHOLD: z.coerce.number().default(0.05),
  SIGNAL_ENABLED: z.coerce.boolean().default(false),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment variables:\n');
  const errors = result.error.format();
  Object.entries(errors).forEach(([key, value]) => {
    if (key === '_errors') return;
    const messages = (value as { _errors: string[] })._errors;
    if (messages.length > 0) {
      console.error(`  ${key}: ${messages.join(', ')}`);
    }
  });
  console.error('\nFix the above and restart the server.\n');
  process.exit(1);
}

export const config = result.data;
export type Config = typeof config;