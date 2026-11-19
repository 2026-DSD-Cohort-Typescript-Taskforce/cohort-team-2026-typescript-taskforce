import { HttpError } from '../middleware/errorHandler';

type Reply = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
};

/** Intercept document requests before they reach the network, including redirects/popups. */
export async function guardNavigation(cdpUrl: string, allowed: string[], observe: boolean) {
  let endpoint = cdpUrl;
  if (!endpoint.startsWith('ws')) {
    const response = await fetch(new URL('/json/version', endpoint));
    const version = (await response.json()) as { webSocketDebuggerUrl: string };
    endpoint = version.webSocketDebuggerUrl;
  }
  const socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Browser connection failed')), {
      once: true,
    });
  });
  let sequence = 0;
  let violated = false;
  const pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const canonical = new Set(allowed.map((url) => new URL(url).href));
  function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Browser guard timed out'));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const setups = new Set<Promise<void>>();
  const setup = async (sessionId: string) => {
    await send(
      'Fetch.enable',
      { patterns: [{ urlPattern: '*', requestStage: 'Request' }] },
      sessionId,
    );
    await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
  };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as Reply;
    if (message.id !== undefined) {
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      clearTimeout(handler.timer);
      if (message.error) handler.reject(new Error('Browser guard command failed'));
      else handler.resolve(message.result ?? {});
    } else if (message.method === 'Target.attachedToTarget') {
      const task = setup(String(message.params?.sessionId));
      setups.add(task);
      void task
        .catch(() => {
          violated = true;
          socket.close();
        })
        .finally(() => setups.delete(task));
    } else if (message.method === 'Fetch.requestPaused') {
      const params = message.params as {
        requestId: string;
        resourceType: string;
        request: { url: string; method: string };
      };
      const samePortal =
        observe &&
        !['GET', 'HEAD', 'OPTIONS'].includes(params.request.method) &&
        [...canonical].some((allowed) => {
          try {
            return new URL(allowed).origin === new URL(params.request.url).origin;
          } catch {
            return false;
          }
        });
      const blocked =
        (params.resourceType === 'Document' && !canonical.has(params.request.url)) ||
        (observe && !['GET', 'HEAD', 'OPTIONS'].includes(params.request.method) && !samePortal);
      if (blocked) violated = true;
      void send(
        blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        {
          requestId: params.requestId,
          ...(blocked ? { errorReason: 'BlockedByClient' } : {}),
        },
        message.sessionId,
      ).catch(() => {
        violated = true;
        socket.close();
      });
    }
  });
  socket.addEventListener('close', () => {
    for (const handler of pending.values()) {
      clearTimeout(handler.timer);
      handler.reject(new Error('Browser guard disconnected'));
    }
    pending.clear();
  });
  try {
    await send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [
        { type: 'page', exclude: false },
        { type: 'iframe', exclude: false },
        { exclude: true },
      ],
    });
    await Promise.all(setups);
  } catch (error) {
    socket.close();
    throw error;
  }
  return {
    check() {
      if (violated || socket.readyState !== WebSocket.OPEN) {
        throw new HttpError(502, 'Portal navigation was blocked.', 'portal_error');
      }
    },
    close() {
      socket.close();
    },
  };
}
