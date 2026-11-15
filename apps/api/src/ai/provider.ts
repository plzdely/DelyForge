import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

/** What every AI provider adapter offers: one structured (schema-shaped) answer per request. */
export interface AiCompletion<T> {
  /** null when the model declined or its answer didn't match the schema. */
  output: T | null;
  inputTokens: number;
  outputTokens: number;
  refused: boolean;
}

export interface AiTextProvider {
  readonly id: string;
  complete<S extends z.ZodType>(req: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    schema: S;
  }): Promise<AiCompletion<z.infer<S>>>;
}

export const AI_PROVIDERS = Symbol('AI_PROVIDERS');

/** Claude, through Anthropic's official SDK. The key stays on this server. */
export class AnthropicProvider implements AiTextProvider {
  readonly id = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async complete<S extends z.ZodType>(req: { model: string; system: string; user: string; maxTokens: number; schema: S }): Promise<AiCompletion<z.infer<S>>> {
    const res = await this.client.beta.messages.parse({
      model: req.model,
      max_tokens: req.maxTokens,
      // If Claude declines on safety grounds, the API retries on a suitable fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(req.schema) },
      // The system prompt never changes between requests, so it is cached (cheaper and faster on repeat calls).
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
    });
    const refused = res.stop_reason === 'refusal';
    return {
      output: refused || res.stop_reason === 'max_tokens' ? null : ((res.parsed_output as z.infer<S> | null) ?? null),
      inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
      outputTokens: res.usage.output_tokens,
      refused,
    };
  }
}
