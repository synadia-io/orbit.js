import { HttpImpl } from "./nhgc.ts";
import type {
  Msg,
  MsgCallback,
  Nats,
  ReviverFn,
  Sub,
  SubOpts,
  Value,
} from "./types.ts";
import { addEventSource, deferred } from "./util.ts";

interface JsonMsg {
  header?: Record<string, string | string[]>;
  subject: string;
  reply?: string;
  data?: string;
}

export function toNatsMsg(m: MessageEvent): Msg {
  return new MsgImpl(JSON.parse(m.data));
}

class MsgImpl implements Msg {
  headers: Headers;
  subject: string;
  reply?: string;
  data?: Uint8Array;

  constructor(m: JsonMsg) {
    this.headers = new Headers();
    this.subject = m.subject;
    this.reply = m.reply;
    if (m.data) {
      const bin = atob(m.data!);
      this.data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        this.data[i] = bin.charCodeAt(i);
      }
    }
    if (m.header) {
      for (const p in m.header) {
        let v = m.header[p];
        if (!Array.isArray(v)) {
          v = [v];
        }
        v.forEach((vv) => {
          this.headers.append(p, vv);
        });
      }
    }
  }

  string(): string {
    return this.data ? new TextDecoder().decode(this.data) : "";
  }

  json<T>(r?: ReviverFn): T {
    return JSON.parse(this.string(), r);
  }
}

export class NatsImpl extends HttpImpl implements Nats {
  constructor(url: string, apiKey: string) {
    super(url, apiKey);
  }

  publish(subject: string, data?: Value, opts?: {
    headers?: HeadersInit;
  }): Promise<void> {
    return this.publishWithReply(subject, "", data, opts);
  }
  async publishWithReply(
    subject: string,
    reply: string,
    data?: Value,
    opts?: { headers?: HeadersInit },
  ): Promise<void> {
    const args = [];
    if (reply?.length > 0) {
      args.push(`reply=${encodeURIComponent(reply)}`);
    }
    const qs = args.length ? args.join("&") : "";
    const p = qs
      ? `/v1/nats/subjects/${subject}?${qs}`
      : `/v1/nats/subjects/${subject}`;

    opts = opts || {};
    const hi = opts.headers || {};
    const headers = new Headers(hi);

    const r = await this.doFetch("PUT", p, data, { headers });
    if (!r.ok) {
      return this.handleError(r);
    }
    r.body?.cancel().catch(() => {});
    return Promise.resolve();
  }
  async request(
    subject: string,
    data?: Value,
    opts?: { timeout?: number; headers?: HeadersInit },
  ): Promise<Msg> {
    const args = [];
    opts = opts || {};

    if (typeof opts.timeout === "number") {
      args.push(`timeout=${opts.timeout}`);
    }

    const qs = args.length > 0 ? args.join("&") : "";
    const p = qs !== ""
      ? `/v1/nats/subjects/${subject}?${qs}`
      : `/v1/nats/subjects/${subject}`;

    const headers = opts.headers ? new Headers(opts.headers) : new Headers();
    headers.append("Accept", "application/json");

    const r = await this.doFetch(
      "POST",
      p,
      data,
      {
        headers,
      },
    );

    if (!r.ok) {
      return this.handleError(r);
    }
    return new MsgImpl(await r.json());
  }

  sub(subject: string, opts: Partial<SubOpts> = {}): Promise<EventSource> {
    const args = [];
    args.push(`authorization=${this.apiKey}`);

    if (opts.idleHeartbeat && opts.idleHeartbeat > 0) {
      args.push(`idleHeartbeat=${opts.idleHeartbeat}`);
    }
    if (opts.queue) {
      args.push(`queue=${encodeURIComponent(opts.queue)}`);
    }

    const qs = args.length ? args.join("&") : "";
    const path = `/v1/nats/subjects/${subject}?${qs}`;

    return addEventSource(new URL(path, this.url));
  }

  async subscribe(
    subject: string,
    cb: MsgCallback,
    opts: Partial<SubOpts> = {},
  ): Promise<Sub> {
    const es = await this.sub(subject, opts);
    return Promise.resolve(new SubImpl(es, cb));
  }

  async flush(): Promise<void> {
    // this here until gateway supports flush directly
    function inbox(length = 6): string {
      return Math.random().toString(20).substring(2, length - 1);
    }

    const subj = `_INBOX.${inbox()}`;

    const d = deferred<void>();
    const sub = await this.subscribe(subj, (err) => {
      if (err) {
        d.reject(err.message);
        sub.unsubscribe();
      } else {
        d.resolve();
        sub.unsubscribe();
      }
    });

    await this.publish(subj).then();
    return d;
  }
}

class SubImpl implements Sub {
  es: EventSource;
  cb: MsgCallback;
  constructor(es: EventSource, cb: MsgCallback) {
    this.es = es;
    this.cb = cb;

    es.addEventListener("msg", (e) => {
      cb(undefined, toNatsMsg(e));
    });

    es.addEventListener("closed", () => {
      cb(new Error("subscription closed"), undefined);
    });
  }
  unsubscribe(): void {
    this.es.close();
  }
}
