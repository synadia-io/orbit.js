/*
 * Copyright 2024 The Synadia Authors
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
import { Kvm, Nats } from "./types.ts";
import { KvmImpl } from "./kvm.ts";
import { NatsImpl } from "./nats.ts";

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
