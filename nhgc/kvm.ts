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

import type { Kv, KvBucketConfig, KvBucketInfo, Kvm } from "./types.ts";
import { HttpImpl } from "./nhgc.ts";
import { KvImpl } from "./kv.ts";

export class KvmImpl extends HttpImpl implements Kvm {
  constructor(url: string, apiKey: string) {
    super(url, apiKey);
  }

  get(bucket: string): Kv {
    return new KvImpl(this.url, this.apiKey, bucket);
  }

  async add(bucket: string, config?: KvBucketConfig): Promise<Kv> {
    if (config && config.ttl) {
      config.ttl = config.ttl * 1_000_000;
    }
    const payload = config ? JSON.stringify(config) : undefined;
    const r = await this.doFetch("POST", `/v1/kvm/buckets/${bucket}`, payload);
    r.body?.cancel().catch(() => {});
    if (!r.ok) {
      return this.handleError(r);
    }
    return Promise.resolve(new KvImpl(this.url, this.apiKey, bucket));
  }

  async destroy(bucket: string): Promise<void> {
    const r = await this.doFetch(
      "DELETE",
      `/v1/kvm/buckets/${bucket}`,
    );
    if (!r.ok) {
      return this.handleError(r);
    }
    r.body?.cancel().catch(() => {});
    return Promise.resolve();
  }

  async list(): Promise<string[]> {
    const r = await this.doFetch("GET", "/v1/kvm/buckets", undefined, {
      headers: {
        "Accept": "application/json",
      },
    });
    if (!r.ok) {
      return this.handleError(r);
    }
    return r.json();
  }

  info(bucket: string): Promise<KvBucketInfo> {
    const kv = new KvImpl(this.url, this.apiKey, bucket);
    return kv.info();
  }
}
