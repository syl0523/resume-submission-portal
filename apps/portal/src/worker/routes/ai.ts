import { aiAnswerSchema } from '@jsp/core';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { validate } from '../lib/validate';
import { answerQuestion, requireAi } from '../services/ai';
import { prepareAnswerInput } from '../services/answers';

/**
 * AI assist. Mounted at /api. POST /ai/answer shares its context with POST /api/ext/answer.
 * TODO(KAN-33): POST /ai/fit (fit report + cover letter). Profile drafts live in routes/profile.ts.
 */
export const aiRoutes = new Hono<AppEnv>().post(
  '/ai/answer',
  validate('json', aiAnswerSchema),
  async (c) => {
    requireAi(c.env);
    const input = await prepareAnswerInput(c.var.db, c.var.user, c.req.valid('json'));
    return c.json(await answerQuestion(c.env, input));
  },
);
