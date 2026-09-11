/**
 * FIFO queue per Discord channel (doc 01 section 8).
 *
 * Prevents interleaved histories, out-of-order replies and concurrent
 * tool calls from the same channel racing each other.
 */
type Task<T> = () => Promise<T>;

export class ChannelQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(channelId: string, task: Task<T>): Promise<T> {
    const prev = this.tails.get(channelId) ?? Promise.resolve();
    // Swallow previous rejection so the chain never breaks.
    const next = prev.catch(() => undefined).then(task);
    this.tails.set(channelId, next);
    // Clean up once this task is no longer the tail.
    void next.finally(() => {
      if (this.tails.get(channelId) === next) this.tails.delete(channelId);
    }).catch(() => undefined);
    return next;
  }

  /** Test helper: how many channels currently have queued work. */
  pendingChannelsForTests(): number {
    return this.tails.size;
  }
}

let shared: ChannelQueue | null = null;

export function sharedChannelQueue(): ChannelQueue {
  if (!shared) shared = new ChannelQueue();
  return shared;
}
