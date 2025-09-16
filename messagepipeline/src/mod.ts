/*
 * Copyright 2024 Synadia Communications, Inc
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { headers } from "@nats-io/nats-core";

import type {
  Msg,
  MsgHdrs,
  MsgImpl,
  NatsConnection,
  Payload,
  Publisher,
  PublishOptions,
  ReviverFn,
} from "@nats-io/nats-core/internal";

import { ServiceErrorCodeHeader, ServiceErrorHeader } from "@nats-io/services";

export type {
  Msg,
  MsgHdrs,
  Payload,
  PublishOptions,
  ReviverFn,
} from "@nats-io/nats-core";

import { Empty } from "@nats-io/nats-core/internal";

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

  set subject(s: string) {
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

export interface Pipelines {
  transform(m: Msg): Promise<Msg> | Msg;
}

export type PipelineFn = (msg: Msg) => Promise<Msg> | Msg;

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
