import OpenAI from 'openai';
import { AppConfig } from '../config.js';

export function createLlmClient(config: AppConfig): OpenAI {
  return new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    timeout: config.llmTimeoutMs,
    maxRetries: 1,
  });
}
