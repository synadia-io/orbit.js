import { HttpImpl } from "./nhgc.ts";
import {
  HeartbeatOpts,
  Msg,
  MsgCallback,
  Nats,
  ReviverFn,
  Sub,
  Value,
} from "./types.ts";
import { deferred } from "./util.ts";

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
  header?: Record<string, string | string[]>;
  subject: string;
  reply?: string;
  data?: Uint8Array;

  constructor(m: JsonMsg) {
    this.header = m.header;
    this.subject = m.subject;
    this.reply = m.reply;
    if (m.data) {
      const bin = atob(m.data!);
      this.data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        this.data[i] = bin.charCodeAt(i);
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

  publish(subject: string, data?: Value): Promise<void> {
    return this.publishWithReply(subject, "", data);
  }
  async publishWithReply(
    subject: string,
    reply: string,
    data?: Value,
  ): Promise<void> {
    const opts = [];
    if (reply?.length > 0) {
      opts.push(`reply=${encodeURIComponent(reply)}`);
    }
    const qs = opts.length ? opts.join("&") : "";
    const p = qs
      ? `/v1/nats/subjects/${subject}?${qs}`
      : `/v1/nats/subjects/${subject}`;

    const r = await this.doFetch("PUT", p, data);
    if (!r.ok) {
      return this.handleError(r);
    }
    r.body?.cancel().catch(() => {});
    return Promise.resolve();
  }
  async request(
    subject: string,
    data: Value,
    opts?: { timeout?: number },
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

    const r = await this.doFetch(
      "POST",
      p,
      data,
      {
        headers: { "Accept": "application/json" },
      },
    );

    if (!r.ok) {
      return this.handleError(r);
    }
    return new MsgImpl(await r.json());
  }

  sub(subject: string, opts?: HeartbeatOpts): Promise<EventSource> {
    const args = [];
    args.push(`authorization=${this.apiKey}`);

    if (opts && opts.idleHeartbeat && opts.idleHeartbeat > 0) {
      args.push(`idleHeartbeat=${opts.idleHeartbeat}`);
    }
    const qs = args.length ? args.join("&") : "";
    const path = `/v1/nats/subjects/${subject}?${qs}`;
    return Promise.resolve(new EventSource(new URL(path, this.url)));
  }

  async subscribe(subject: string, cb: MsgCallback): Promise<Sub> {
    const d = deferred<Sub>();
    const es = await this.sub(subject);
    es.addEventListener("open", () => {
      d.resolve(new SubImpl(es, cb));
    });

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
