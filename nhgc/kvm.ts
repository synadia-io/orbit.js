/*
 * Copyright 2020-2024 The Synadia Authors
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
import {
  Kv,
  KvBucketConfig,
  KvBucketInfo,
  Kvm,
  KvWatchFn,
  KvWatchOpts,
  toKvEntryInfo,
  Watcher,
} from "./types.ts";
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
      return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
    }
    return Promise.resolve(new KvImpl(this.url, this.apiKey, bucket));
  }

  async destroy(bucket: string): Promise<void> {
    const r = await this.doFetch(
      "DELETE",
      `/v1/kvm/buckets/${bucket}`,
    );
    if (!r.ok) {
      r.body?.cancel().catch(() => {});
      return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
    }
    r.body?.cancel().catch(() => {});
    return Promise.resolve();
  }

  async purge(bucket: string): Promise<void> {
    const r = await this.doFetch("DELETE", `/v1/kvm/buckets/${bucket}/purge`);
    r.body?.cancel().catch(() => {});
    if (!r.ok) {
      return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
    }
    return Promise.resolve();
  }

  async list(): Promise<string[]> {
    const r = await this.doFetch("GET", "/v1/kvm/buckets", undefined, {
      headers: {
        "Accept": "application/json",
      },
    });
    if (!r.ok) {
      return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
    }
    return r.json();
  }

  async info(bucket: string): Promise<KvBucketInfo> {
    const r = await this.doFetch(
      "GET",
      `/v1/kvm/buckets/${bucket}`,
      undefined,
      {
        headers: {
          "Accept": "application/json",
        },
      },
    );
    if (!r.ok) {
      r.body?.cancel().catch(() => {});
      return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
    }
    return r.json();
  }

  async keys(bucket: string, filter = ">"): Promise<string[]> {
    const opts = [];
    if (typeof filter === "string") {
      opts.push(`filter=${encodeURIComponent(filter)}`);
    }

    const qs = opts.join("&");
    const path = qs.length > 0
      ? `/v1/kvm/buckets/${bucket}/keys?${qs}`
      : `/v1/kvm/buckets/${bucket}/keys`;

    const r = await this.doFetch("GET", path, undefined, {
      headers: {
        "Accept": "application/json",
      },
    });
    if (!r.ok) {
      return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
    }
    return r.json();
  }

  watch(
    bucket: string,
    opts: KvWatchOpts,
  ): Promise<KvWatcher> {
    const args: string[] = [];
    args.push(`X-Nats-Api-Key=${this.apiKey}`);

    const dopts = Object.assign({
      filter: ">",
      idleHeartbeat: 0,
      include: "",
      ignoreDeletes: false,
      startSequence: 1,
    }, opts) as KvWatchOpts;

    if (dopts.filter) {
      args.push(`filter=${encodeURIComponent(dopts.filter)}`);
    }
    if (dopts.idleHeartbeat && dopts.idleHeartbeat > 0) {
      args.push(`idleHeartbeat=${dopts.idleHeartbeat}`);
    }
    if (dopts.include) {
      args.push(`include=${dopts.include}`);
    }
    if (dopts.ignoreDeletes) {
      args.push(`ignoreDeletes=true`);
    }
    if (dopts.resumeRevision && dopts.resumeRevision > 0) {
      args.push(`resumeRevision=${dopts.resumeRevision}`);
    }

    const qs = args.join("&");
    const path = qs.length > 0
      ? `/v1/kvm/buckets/${bucket}/watch?${qs}`
      : `/v1/kvm/buckets/${bucket}/watch`;

    return Promise.resolve(
      new KvWatcher(new EventSource(new URL(path, this.url)), opts.callback),
    );
  }
}

class KvWatcher implements Watcher {
  fn: KvWatchFn;
  es: EventSource;
  constructor(es: EventSource, fn: KvWatchFn) {
    this.es = es;
    this.fn = fn;

    es.addEventListener("update", (e: MessageEvent) => {
      this.fn(undefined, toKvEntryInfo(e));
    });

    es.addEventListener("closed", () => {
      this.fn(new Error("watcher closed"), undefined);
    });
  }
  stop(): void {
    this.es.close();
  }
}
