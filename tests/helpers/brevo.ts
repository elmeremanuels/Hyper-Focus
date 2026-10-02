/** Fake Brevo transactional API: records every send and returns a message id. */
export function fakeBrevoFetch() {
  const run = Math.random().toString(36).slice(2, 8);
  const sent: Array<{
    headers: Record<string, string>;
    body: {
      sender: { name: string; email: string };
      to: Array<{ email: string }>;
      replyTo?: { email: string };
      subject: string;
      textContent: string;
      htmlContent: string;
      headers?: Record<string, string>;
    };
  }> = [];
  let failWith: { status: number; message: string } | undefined;

  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    if (failWith) {
      return new Response(JSON.stringify({ code: 'error', message: failWith.message }), {
        status: failWith.status,
      });
    }
    sent.push({
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as (typeof sent)[number]['body'],
    });
    return new Response(JSON.stringify({ messageId: `<brevo-${run}-${sent.length}@smtp-relay.invalid>` }), {
      status: 201,
    });
  };

  return {
    fetchImpl: fetchImpl as typeof fetch,
    sent,
    failWith(status: number, message: string) {
      failWith = { status, message };
    },
  };
}
