// A fake Buffer account: channels per key, and every post it receives.
import { BufferError, type BufferApi, type BufferChannel, type BufferPostInput } from '../../src/integrations/buffer/client.js';

export const GOOD_KEY = 'buffer-test-key-0001';

export function fakeBuffer(channels: BufferChannel[] = DEFAULT_CHANNELS) {
  const posts: Array<BufferPostInput & { key: string }> = [];
  let fail: BufferError | undefined;
  const factory = (key: string): BufferApi => ({
    async listChannels() {
      if (key !== GOOD_KEY) throw new BufferError('Unauthorized', 'auth');
      return channels;
    },
    async createPost(input) {
      if (fail) {
        const error = fail;
        fail = undefined;
        throw error;
      }
      posts.push({ ...input, key });
      return { id: `buf_${posts.length}`, status: 'scheduled', dueAt: input.dueAt?.toISOString() ?? '2026-10-20T08:00:00.000Z', error: null };
    },
    async getPost(id) {
      return { id, status: 'scheduled', dueAt: null, error: null };
    },
  });
  return {
    factory,
    posts,
    failNext(message: string) {
      fail = new BufferError(message, 'invalid');
    },
  };
}

export const DEFAULT_CHANNELS: BufferChannel[] = [
  { id: 'ch_ig', name: 'studiorust', service: 'instagram', organization: 'Studio Rust' },
  { id: 'ch_li', name: 'Rust', service: 'linkedin', organization: 'Studio Rust' },
  { id: 'ch_fb', name: 'Rust', service: 'facebook', organization: 'Studio Rust' },
  { id: 'ch_th', name: 'rust', service: 'threads', organization: 'Studio Rust' },
];
