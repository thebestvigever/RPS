// Just enough Cloudflare to run the room out of one.
//
// These are fakes, and they are worth having anyway: everything they stand in
// for is the part of the shell that only misbehaves in production. Storage
// round-trips through JSON, so a value that cannot survive the trip fails here
// rather than at three in the morning; sockets keep their attachment and
// nothing else, which is exactly what hibernation does to them; and a new
// `MatchRoom` over the same state IS an object waking up with its variables
// gone.
//
// The one liberty taken is status 101, which Node's `Response` refuses to
// construct. It is mapped to 200 and the socket stashed, so the upgrade is
// observed through the sockets the state accepted rather than through a status
// line workerd would have produced.

export class FakeSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  tags: string[] = [];
  private attachment: unknown = null;

  send(payload: string): void {
    if (this.closed) throw new Error('that socket is closed');
    this.sent.push(payload);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  serializeAttachment(value: unknown): void {
    this.attachment = JSON.parse(JSON.stringify(value)) as unknown;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  /** Everything this socket has been told, parsed. */
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);
  }

  drain(): Array<Record<string, unknown>> {
    const messages = this.messages();
    this.sent.length = 0;
    return messages;
  }
}

class FakeStorage {
  private readonly data = new Map<string, string>();
  alarm: number | null = null;

  get<T>(key: string): Promise<T | undefined> {
    const stored = this.data.get(key);
    return Promise.resolve(stored === undefined ? undefined : (JSON.parse(stored) as T));
  }

  put(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
    return Promise.resolve();
  }

  deleteAll(): Promise<void> {
    this.data.clear();
    this.alarm = null;
    return Promise.resolve();
  }

  setAlarm(at: number): Promise<void> {
    this.alarm = at;
    return Promise.resolve();
  }

  deleteAlarm(): Promise<void> {
    this.alarm = null;
    return Promise.resolve();
  }

  get size(): number {
    return this.data.size;
  }
}

export class FakeState {
  readonly storage = new FakeStorage();
  readonly accepted: FakeSocket[] = [];
  ready: Promise<unknown> = Promise.resolve();

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const running = callback();
    this.ready = running;
    return running;
  }

  acceptWebSocket(socket: FakeSocket, tags: string[] = []): void {
    socket.tags = tags;
    this.accepted.push(socket);
  }

  /** Like the real one, a closed socket is no longer in the list. */
  getWebSockets(tag?: string): FakeSocket[] {
    const live = this.accepted.filter((socket) => socket.closed === null);
    return tag === undefined ? live : live.filter((socket) => socket.tags.includes(tag));
  }
}

const RealResponse = globalThis.Response;

/** Installs the globals workerd provides and Node does not. Call once. */
export function installRuntimeGlobals(): void {
  const globals = globalThis as unknown as Record<string, unknown>;

  globals['WebSocketPair'] = function WebSocketPair(this: unknown) {
    return { 0: new FakeSocket(), 1: new FakeSocket() };
  };

  globals['Response'] = class extends RealResponse {
    override readonly webSocket: WebSocket | null;

    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: WebSocket | null }) {
      if (init && init.status === 101) {
        super(null, { status: 200 });
        this.webSocket = init.webSocket ?? null;
      } else {
        super(body ?? null, init);
        this.webSocket = null;
      }
    }
  };
}
