const SECRET_KEYS = [
  'DISCORD_TOKEN',
  'OPENAI_API_KEY',
  'PANEL_PASSWORD',
  'Authorization',
  'Bearer',
  'Set-Cookie',
  'refresh token',
  'RCONPassword',
  'rconPassword',
];

let knownSecrets: string[] = [];

export function registerSecrets(values: Array<string | undefined>): void {
  knownSecrets = values.filter((v): v is string => !!v && v.length >= 4);
}

function redactKnownSecrets(text: string): string {
  let out = text;
  for (const s of knownSecrets) {
    if (s && out.includes(s)) {
      out = out.split(s).join('[REDACTED]');
    }
  }
  return out;
}

export function sanitizeForLog(input: unknown): string {
  let text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  text = redactKnownSecrets(text);
  text = text.replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[REDACTED]"');
  text = text.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"[REDACTED]"');
  text = text.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
  text = text.replace(/Set-Cookie:[^\n]*/gi, 'Set-Cookie: [REDACTED]');
  return text.slice(0, 2000);
}

export function sanitizeDiscord(text: string): string {
  let out = redactKnownSecrets(text);
  out = out.replace(/@everyone/g, '@\u200beveryone').replace(/@here/g, '@\u200bhere');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return out.slice(0, 1900);
}

export function sanitizeServerMessage(text: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (clean.length < 1) throw new Error('Message must not be empty');
  return clean.slice(0, 300);
}

export function secretKeysForDocs(): string[] {
  return [...SECRET_KEYS];
}
