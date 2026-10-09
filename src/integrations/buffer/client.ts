// Buffer's GraphQL API (step C1): one API key per client, channels and scheduled posts.
// https://developers.buffer.com — a single endpoint, Bearer key, errors as a union in the payload.

export const BUFFER_ENDPOINT = 'https://api.buffer.com';

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
  organization: string;
}

export interface BufferPostInput {
  channelId: string;
  service: string;
  text: string;
  /** UTC; without it the post goes into the channel's own Buffer queue. */
  dueAt?: Date | null | undefined;
  imageUrl?: string | null | undefined;
}

export interface BufferPost {
  id: string;
  status: string;
  dueAt: string | null;
  error: string | null;
}

export interface BufferApi {
  listChannels(): Promise<BufferChannel[]>;
  createPost(input: BufferPostInput): Promise<BufferPost>;
  getPost(id: string): Promise<BufferPost>;
}

/** Something Buffer said no to: a bad key, a limit, an invalid post. The message is Buffer's. */
export class BufferError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'limit' | 'invalid' | 'other' = 'other',
  ) {
    super(message);
    this.name = 'BufferError';
  }
}

const POST_FIELDS = 'id status dueAt error { message }';

const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { ${POST_FIELDS} } }
    ... on MutationError { message }
  }
}`;

// Some networks need their post type spelled out; the rest take the defaults.
function metadataFor(service: string): Record<string, unknown> | undefined {
  if (service === 'instagram') return { instagram: { type: 'post', shouldShareToFeed: true } };
  if (service === 'facebook') return { facebook: { type: 'post' } };
  return undefined;
}

interface RawPost {
  id: string;
  status: string;
  dueAt: string | null;
  error: { message: string } | null;
}
const toPost = (raw: RawPost): BufferPost => ({ id: raw.id, status: raw.status, dueAt: raw.dueAt, error: raw.error?.message ?? null });

export class BufferClient implements BufferApi {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listChannels(): Promise<BufferChannel[]> {
    const data = await this.query<{ account: { organizations: Array<{ id: string; name: string }> } }>('query { account { organizations { id name } } }');
    const channels: BufferChannel[] = [];
    for (const org of data.account.organizations) {
      const result = await this.query<{ channels: Array<{ id: string; name: string; displayName: string | null; service: string; isDisconnected: boolean }> }>(
        'query Channels($org: OrganizationId!) { channels(input: { organizationId: $org }) { id name displayName service isDisconnected } }',
        { org: org.id },
      );
      for (const channel of result.channels) {
        if (channel.isDisconnected) continue;
        channels.push({ id: channel.id, name: channel.displayName || channel.name, service: channel.service, organization: org.name });
      }
    }
    return channels;
  }

  async createPost(input: BufferPostInput): Promise<BufferPost> {
    const metadata = metadataFor(input.service);
    const variables = {
      input: {
        channelId: input.channelId,
        text: input.text,
        schedulingType: 'automatic',
        mode: input.dueAt ? 'customScheduled' : 'addToQueue',
        ...(input.dueAt && { dueAt: input.dueAt.toISOString() }),
        ...(input.imageUrl && { assets: [{ image: { url: input.imageUrl } }] }),
        ...(metadata && { metadata }),
        source: 'hyperfocus',
      },
    };
    const data = await this.query<{ createPost: { __typename: string; post?: RawPost; message?: string } }>(CREATE_POST, variables);
    const payload = data.createPost;
    if (!payload.post) {
      const kind = payload.__typename === 'UnauthorizedError' ? 'auth' : payload.__typename === 'LimitReachedError' ? 'limit' : payload.__typename === 'InvalidInputError' ? 'invalid' : 'other';
      throw new BufferError(payload.message ?? 'Buffer weigerde de post', kind);
    }
    return toPost(payload.post);
  }

  async getPost(id: string): Promise<BufferPost> {
    const data = await this.query<{ post: RawPost }>(`query Post($id: PostId!) { post(input: { id: $id }) { ${POST_FIELDS} } }`, { id });
    return toPost(data.post);
  }

  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetchImpl(BUFFER_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 401 || response.status === 403) throw new BufferError('De Buffer-sleutel werkt niet', 'auth');
    if (response.status === 429) throw new BufferError('Buffer vraagt even te wachten', 'limit');
    const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };
    if (body.errors?.length) {
      const first = body.errors[0];
      const auth = first?.extensions?.code === 'UNAUTHENTICATED' || /unauthori[sz]ed|api key/i.test(first?.message ?? '');
      throw new BufferError(first?.message ?? 'Buffer gaf een fout', auth ? 'auth' : 'other');
    }
    if (!response.ok || !body.data) throw new BufferError(`Buffer gaf HTTP ${response.status}`);
    return body.data;
  }
}
