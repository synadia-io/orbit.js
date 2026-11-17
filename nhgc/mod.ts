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

/**
 * A client for the NATS HTTP Gateway, part of Synadia Cloud: KV and messaging
 * over HTTP, with no NATS connection.
 *
 * {@link newNHG} takes the gateway URL and an API key. Requests are made with
 * `fetch`, and subscriptions and KV watches are server-sent events
 * (`EventSource`), so the client runs anywhere both are available: browsers
 * and Deno. Node.js 22 and later has an experimental `EventSource` behind the
 * `--experimental-eventsource` flag; without the flag, on older versions, or
 * on Bun, install an `EventSource` polyfill.
 *
 * @example
 * ```ts
 * import { newNHG } from "@synadiaorbit/nhgc";
 *
 * const nhg = newNHG({ url: "https://<gateway>", apiKey: "<api key>" });
 *
 * // key-value
 * const kv = await nhg.kvm.add("profiles");
 * await kv.put("alice", "Paris");
 * const e = await kv.get("alice");
 * console.log(e?.string()); // Paris
 *
 * // messaging
 * await nhg.nats.publish("greetings", "hello");
 * ```
 *
 * @module
 */

import type { Kvm, Nats } from "./types.ts";
import { KvmImpl } from "./kvm.ts";
import { NatsImpl } from "./nats.ts";

export type {
  HeartbeatOpts,
  Kv,
  KvBucketConfig,
  KvBucketInfo,
  KvChangeEvent,
  KvEntry,
  KvEntryInfo,
  KvInclude,
  Kvm,
  KvOperation,
  KvWatchFn,
  KvWatchOpts,
  Msg,
  MsgCallback,
  Nats,
  ReviverFn,
  Sub,
  SubOpts,
  Value,
  Watcher,
  WatchOpts,
} from "./types.ts";

/**
 * Interface to the API of the NHG
 */
export interface NHG {
  /**
   * An object that you can use to manage or access KeyValue stores.
   */
  kvm: Kvm;

  /**
   * An object that you can use to create subscriptions, publish messages and
   * create requests using NATS
   */
  nats: Nats;
}

/**
 * Creates a client for the Nats-Http-Gateway.
 * @param opts
 */
export function newNHG(
  opts: { url: string; apiKey: string },
): NHG {
  return new NHGImpl(opts.url, opts.apiKey);
}

class NHGImpl implements NHG {
  url: string;
  apiKey: string;
  #_kvm!: Kvm | undefined;
  #_nats!: Nats | undefined;

  constructor(url: string, apiKey: string) {
    this.url = url;
    this.apiKey = apiKey;
  }

  get kvm(): Kvm {
    if (this.#_kvm === undefined) {
      this.#_kvm = new KvmImpl(this.url, this.apiKey);
    }
    return this.#_kvm;
  }

  get nats(): Nats {
    if (this.#_nats === undefined) {
      this.#_nats = new NatsImpl(this.url, this.apiKey);
    }
    return this.#_nats;
  }
}
