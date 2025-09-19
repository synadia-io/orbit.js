/*
 * Copyright 2025 Synadia Communications, Inc
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

import type {
  DirectMsgRequest,
  JetStreamClient,
  JetStreamOptions,
  PubAck,
} from "@nats-io/jetstream/internal";

import { jetstream, JetStreamStatus } from "@nats-io/jetstream/internal";

import type { CounterDirectLastFor } from "./counterapi.ts";

import {
  headers,
  type Msg,
  type NatsConnection,
  type QueuedIterator,
  QueuedIteratorImpl,
} from "@nats-io/nats-core/internal";

import { CounterApi } from "./counterapi.ts";

export type Counters = {
  /**
   * Increment a counter by the specified delta
   * @param name - The counter name/subject
   * @param delta - The amount to increment (can be negative for decrement)
   * @returns The new value of the counter after incrementing
   */
  increment(name: string, delta: bigint | number): Promise<bigint>;
  /**
   * Get the current value for a counter
   * @param name - The counter name/subject
   * @param seq - Optional sequence number to get historical value
   * @returns The current value of the counter, or null if not found
   */
  value(name: string, seq?: number): Promise<bigint | null>;
  /**
   * Get a counter with metadata at an optional revision
   * @param name - The counter name/subject
   * @param seq - Optional sequence number to get historical counter
   * @returns The Counter object with metadata, or null if not found
   */
  getCounter(name: string, seq?: number): Promise<Counter | null>;
  /**
   * Get values for one or more counters
   * @param names - Counter name(s) or array of names. Supports NATS wildcards (*, >)
   * @returns An iterator with the latest values for matched counters
   * @example
   * ```typescript
   * const values = await counters.values(["metrics.cpu", "metrics.memory"]);
   * const wildcardValues = await counters.values("metrics.*");
   * ```
   */
  values(
    names: string[] | string,
  ): Promise<QueuedIterator<bigint>>;

  /**
   * Get counters with metadata for one or more counters
   * @param names - Counter name(s) or array of names. Supports NATS wildcards (*, >)
   * @returns An iterator with Counter objects containing metadata
   * @example
   * ```typescript
   * const counters = await counters.getCounters(["metrics.cpu", "metrics.memory"]);
   * for await (const counter of counters) {
   *   console.log(`${counter.subject}: ${counter.value}`);
   * }
   * ```
   */
  getCounters(
    names: string | string[],
  ): Promise<QueuedIterator<Counter>>;
};

export type CounterValue = PubAck & {
  val: string;
};

export class Counter {
  m: Msg;
  constructor(m: Msg) {
    this.m = m;
  }

  /**
   * Return the current value for the counter
   */
  get value(): bigint {
    const v = this.m.json<{ val: string }>();
    return BigInt(v.val);
  }

  /**
   * Return the delta applied by the counter revision
   */
  get delta(): bigint {
    const v = this.m.headers?.get("Nats-Incr");
    return typeof v === "string" ? BigInt(v) : BigInt(0);
  }

  /**
   * Return the stream storing the counter
   */
  get stream(): string {
    return this.m.headers?.get("Nats-Stream") || "";
  }

  /**
   * Return the name of the counter
   */
  get subject(): string {
    return this.m.headers?.get("Nats-Subject") || "";
  }

  /**
   * Return the sequence of the counter
   */
  get seq(): number {
    const v = this.m.headers?.get("Nats-Sequence");
    return typeof v === "string" ? parseInt(v) : 0;
  }

  /**
   * Return the timestamp of the counter
   */
  get timestamp(): string {
    return this.m.headers?.get("Nats-Timestamp") || "";
  }

  /**
   * Return the timestamp of the counter as a Date object
   */
  get time(): Date {
    return new Date(Date.parse(this.timestamp));
  }
}

export function NewCounter(
  nc: NatsConnection,
  stream: string,
  opts: JetStreamOptions = {},
): Counters {
  return new CountersImpl(nc, stream, opts);
}

class CountersImpl implements Counters {
  js: JetStreamClient;
  stream: string;
  counterAPI: CounterApi;

  constructor(nc: NatsConnection, stream: string, opts: JetStreamOptions) {
    this.stream = stream;
    this.counterAPI = new CounterApi(nc, opts);
    this.js = jetstream(nc, opts);
  }

  async increment(counter: string, n: number | bigint): Promise<bigint> {
    const h = headers();
    h.set("Nats-Incr", n.toString());
    const pa = await this.js.publish(counter, undefined, {
      headers: h,
    }) as CounterValue;
    return Promise.resolve(BigInt(pa.val));
  }

  value(counter: string, seq = 0): Promise<bigint | null> {
    return this.getCounter(counter, seq).then((c) => {
      if (c === null) {
        return null;
      }
      return c.value;
    });
  }

  async values(
    counters: string | string[],
  ): Promise<QueuedIterator<bigint>> {
    if (!Array.isArray(counters)) {
      counters = [counters];
    }

    const iter = new QueuedIteratorImpl<bigint>();

    const opts: CounterDirectLastFor = {
      multi_last: counters,
      callback: (done, m) => {
        if (done) {
          iter.push(() => {
            iter.stop(done.err);
          });
          return;
        }
        const v = m.json<{ val: string }>();
        iter.push(BigInt(v.val));
      },
    };

    await this.counterAPI.getBatch(
      this.stream,
      opts,
    );

    return Promise.resolve(iter);
  }

  async getCounter(counter: string, seq = 0): Promise<Counter | null> {
    let opts: DirectMsgRequest;
    if (seq > 0) {
      opts = { seq };
    } else {
      opts = { last_by_subj: counter };
    }

    const m = await this.counterAPI.get(
      this.stream,
      opts,
    );

    if (m.headers && m.headers.code !== 0) {
      const status = new JetStreamStatus(m);
      if (status.isMessageNotFound()) {
        return Promise.resolve(null);
      } else {
        return Promise.reject(status.toError());
      }
    }

    return Promise.resolve(new Counter(m));
  }

  async getCounters(
    counters: string | string[],
  ): Promise<QueuedIterator<Counter>> {
    if (!Array.isArray(counters)) {
      counters = [counters];
    }

    const iter = new QueuedIteratorImpl<Counter>();

    const opts: CounterDirectLastFor = {
      multi_last: counters,
      callback: (done, m) => {
        if (done) {
          iter.push(() => {
            iter.stop(done.err);
          });
          return;
        }
        const c = new Counter(m);
        iter.push(c);
      },
    };

    await this.counterAPI.getBatch(
      this.stream,
      opts,
    );

    return Promise.resolve(iter);
  }
}
