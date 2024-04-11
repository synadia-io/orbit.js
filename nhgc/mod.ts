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
import { Kvm } from "./types.ts";
import { KvmImpl } from "./kvm.ts";

export interface NHG {
  kvm: Kvm;
}

export function newNHG(
  opts: { url: string; apiKey: string },
): NHG {
  return new NHGImpl(opts.url, opts.apiKey);
}

class NHGImpl implements NHG {
  url: string;
  apiKey: string;
  #_kvm!: Kvm | undefined;

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
}
