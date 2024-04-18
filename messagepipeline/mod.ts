import {
  headers,
  Msg,
  MsgHdrs,
  Payload,
  PublishOptions,
  ReviverFn,
  ServiceErrorCodeHeader,
  ServiceErrorHeader,
} from "nbc/mod.ts";

export type {
  Msg,
  MsgHdrs,
  Payload,
  PublishOptions,
  ReviverFn,
  ServiceMsg,
} from "nbc/mod.ts";

import type { Result } from "nbc/util.ts";

export type { ErrorResult, Result, ValueResult } from "nbc/util.ts";

import type { NatsConnection, Publisher } from "nbc/mod.ts";

import { Empty, MsgImpl } from "nbc/internal_mod.ts";

export class MutableMsg implements Msg {
  #_data?: Uint8Array;
  #_subject?: string;
  #_sid?: number;
  #_reply?: string | undefined;
  #_headers?: MsgHdrs | undefined;
  #_publisher?: Publisher;

  static fromMsg(src: Msg): MutableMsg {
    const m = new MutableMsg();
    m.#_subject = src.subject;
    m.#_reply = src.reply;
    m.#_data = src.data;
    m.#_sid = src.sid;
    m.#_headers = src.headers;
    m.#_publisher = (src as MsgImpl).publisher;

    return m;
  }

  get data(): Uint8Array {
    return this.#_data || Empty;
  }

  set data(data: Uint8Array) {
    this.#_data = data;
  }

  get subject(): string {
    return this.#_subject || "";
  }

  set subject(s) {
    this.#_subject = s;
  }

  get reply(): string {
    return this.#_reply || "";
  }

  set reply(reply: string) {
    this.#_reply = reply;
  }

  get sid(): number {
    return this.#_sid || 0;
  }

  set sid(sid: number) {
    this.#_sid = sid;
  }

  get headers(): MsgHdrs | undefined {
    return this.#_headers;
  }

  set headers(h: MsgHdrs | undefined) {
    this.#_headers = h;
  }

  get publisher(): Publisher | undefined {
    return this.#_publisher;
  }

  set publisher(p: Publisher | NatsConnection) {
    this.#_publisher = p;
  }

  respondError(
    code: number,
    description: string,
    data?: Uint8Array,
    opts?: PublishOptions,
  ): boolean {
    opts = opts || {};
    opts.headers = opts.headers || headers();
    opts.headers?.set(ServiceErrorCodeHeader, `${code}`);
    opts.headers?.set(ServiceErrorHeader, description);
    return this.respond(data, opts);
  }

  respond(payload?: Payload, opts?: PublishOptions): boolean {
    if (this.publisher) {
      this.publisher.publish(this.reply!, payload!, opts);
      return true;
    }
    throw new Error("publisher is not set");
  }

  json<T>(reviver?: ReviverFn): T {
    return JSON.parse(new TextDecoder().decode(this.data), reviver);
  }

  string(): string {
    return new TextDecoder().decode(this.data);
  }
}

export interface SyncPipelines {
  transform(m: Msg): Result<Msg>;
}

export type SyncPipelineFn = (msg: Msg) => Msg;
export type PipelineFn = (msg: Msg) => Promise<Msg>;

export class SyncPipeline implements SyncPipelines {
  private readonly pipeline: SyncPipelineFn[];

  constructor(...pipeline: SyncPipelineFn[]) {
    this.pipeline = pipeline;
  }

  transform(m: Msg): Result<Msg> {
    for (const fn of this.pipeline) {
      try {
        m = fn(m);
      } catch (err) {
        return {
          isError: true,
          error: err,
        };
      }
    }
    return {
      isError: false,
      value: m,
    };
  }
}

export interface Pipelines {
  transform(m: Msg): Promise<Msg>;
}

export class Pipeline implements Pipelines {
  private readonly pipeline: PipelineFn[];

  constructor(...pipeline: PipelineFn[]) {
    this.pipeline = pipeline;
  }

  async transform(m: Msg): Promise<Msg> {
    for (const fn of this.pipeline) {
      try {
        m = await fn(m);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return Promise.resolve(m);
  }
}
