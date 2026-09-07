import fs from 'node:fs';
import path from 'node:path';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  ts: number;
  authorId?: string;
}

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_MESSAGES = 20;
const MAX_CHARS = 12000;

interface Store {
  append(channelId: string, msg: ChatMessage): Promise<void>;
  recent(channelId: string): Promise<ChatMessage[]>;
  close(): Promise<void>;
}

class MemoryStore implements Store {
  private data = new Map<string, ChatMessage[]>();
  async append(channelId: string, msg: ChatMessage): Promise<void> {
    const list = this.data.get(channelId) ?? [];
    list.push(msg);
    this.data.set(channelId, list.slice(-MAX_MESSAGES));
  }
  async recent(channelId: string): Promise<ChatMessage[]> {
    const now = Date.now();
    const list = (this.data.get(channelId) ?? []).filter((m) => now - m.ts < TTL_MS);
    let chars = 0;
    const out: ChatMessage[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      chars += m.content.length;
      if (chars > MAX_CHARS || out.length >= MAX_MESSAGES) break;
      out.unshift(m);
    }
    return out;
  }
  async close(): Promise<void> {}
}

class SqliteStore implements Store {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;
  private memoryFallback = new MemoryStore();
  private ready = false;

  constructor(private dbPath: string) {}

  private async init(): Promise<void> {
    if (this.ready) return;
    try {
      const dir = path.dirname(this.dbPath);
      fs.mkdirSync(dir, { recursive: true });
      const mod = await import('node:sqlite').catch(() => null);
      if (!mod) {
        this.ready = true;
        return;
      }
      const { DatabaseSync } = mod as unknown as { DatabaseSync: new (p: string) => unknown };
      this.db = new DatabaseSync(this.dbPath);
      (this.db as { exec: (sql: string) => void }).exec(
        'CREATE TABLE IF NOT EXISTS messages (channel_id TEXT, role TEXT, content TEXT, ts INTEGER, author_id TEXT)',
      );
      this.ready = true;
    } catch {
      this.ready = true;
    }
  }

  async append(channelId: string, msg: ChatMessage): Promise<void> {
    await this.init();
    if (!this.db) return this.memoryFallback.append(channelId, msg);
    try {
      (this.db as { prepare: (sql: string) => { run: (...a: unknown[]) => void } })
        .prepare('INSERT INTO messages (channel_id, role, content, ts, author_id) VALUES (?, ?, ?, ?, ?)')
        .run(channelId, msg.role, msg.content.slice(0, 4000), msg.ts, msg.authorId ?? null);
      (this.db as { prepare: (sql: string) => { run: (...a: unknown[]) => void } })
        .prepare(
          'DELETE FROM messages WHERE channel_id = ? AND rowid NOT IN (SELECT rowid FROM messages WHERE channel_id = ? ORDER BY ts DESC LIMIT ?)',
        )
        .run(channelId, channelId, MAX_MESSAGES);
    } catch {
      await this.memoryFallback.append(channelId, msg);
    }
  }

  async recent(channelId: string): Promise<ChatMessage[]> {
    await this.init();
    if (!this.db) return this.memoryFallback.recent(channelId);
    try {
      const rows = (
        this.db as { prepare: (sql: string) => { all: (...a: unknown[]) => Record<string, unknown>[] } }
      )
        .prepare('SELECT role, content, ts, author_id FROM messages WHERE channel_id = ? AND ts > ? ORDER BY ts ASC LIMIT ?')
        .all(channelId, Date.now() - TTL_MS, MAX_MESSAGES);
      let chars = 0;
      const out: ChatMessage[] = [];
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const content = String(r['content'] ?? '');
        chars += content.length;
        if (chars > MAX_CHARS || out.length >= MAX_MESSAGES) break;
        out.unshift({
          role: r['role'] as ChatMessage['role'],
          content,
          ts: Number(r['ts']),
          authorId: (r['author_id'] as string) ?? undefined,
        });
      }
      return out;
    } catch {
      return this.memoryFallback.recent(channelId);
    }
  }

  async close(): Promise<void> {
    try {
      (this.db as { close?: () => void })?.close?.();
    } catch {
      // ignore
    }
  }
}

export function createConversationStore(dbPath?: string): Store {
  if (!dbPath) return new MemoryStore();
  return new SqliteStore(dbPath);
}

export type { Store as ConversationStore };
