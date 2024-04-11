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
  KvBucketInfo,
  KvEntry,
  KvWatchFn,
  KvWatchOpts,
  Operation,
  ReviverFn,
  toKvChangeEvent,
  Value,
  Watcher,
} from "./types.ts";
import { HttpImpl } from "./nhgc.ts";
import { Deferred, deferred } from "./util.ts";

type KvE = {
  bucket: string;
  created: string;
  revision: number;
  delta: number;
  operation: Operation;
  value: Uint8Array;
};

class KvEntryImpl implements KvEntry {
  entry: KvE;
  constructor(e: KvE) {
    this.entry = e;
  }

  static async parse(r: Response): Promise<KvEntry | null> {
    if (!r.ok) {
      if (r.status === 404) {
        r.body?.cancel().catch(() => {
        });
        return Promise.resolve(null);
      } else {
        r.body?.cancel().catch(() => {});
        const reason = r.headers.get("x-nats-api-gateway-error") ||
          r.statusText;
        return Promise.reject(new Error(`${r.status}: ${reason}`));
      }
    }
    if (r.headers.get("Content-Type") === "application/json") {
      return r.json();
    } else {
      const value = new Uint8Array(await r.arrayBuffer());
      const kve = {
        bucket: r.headers.get("X-Nats-Kv-Name") || "",
        created: r.headers.get("X-Nats-Kv-Created") || "",
        revision: parseInt(r.headers.get("X-Nats-Kv-Revision") || "0"),
        delta: parseInt(r.headers.get("X-Nats-Kv-Delta") || "0"),
        operation: r.headers.get("X-Nats-Kv-Operation") as Operation,
        value,
      };
      return Promise.resolve(new KvEntryImpl(kve));
    }
  }

  get value(): Uint8Array {
    return this.entry.value;
  }

  get operation(): Operation {
    return this.entry.operation;
  }

  get delta(): number {
    return this.entry.delta;
  }

  get revision(): number {
    return this.entry.revision;
  }

  get created(): Date {
    return new Date(Date.parse(this.entry.created));
  }

  get bucket(): string {
    return this.entry.bucket;
  }

  json<T>(reviver?: ReviverFn): T {
    return JSON.parse(this.string(), reviver) as T;
  }
  string(): string {
    return new TextDecoder().decode(this.entry.value);
  }
}

export class KvImpl extends HttpImpl implements Kv {
  bucket: string;
  constructor(url: string, apiKey: string, bucket: string) {
    super(url, apiKey);
    this.bucket = bucket;
  }
  async get(
    key: string,
    revision = 0,
  ): Promise<KvEntry | null> {
    try {
      const opts = [];
      if (revision > 0) {
        opts.push(`revision=${revision}`);
      }

      const qs = opts.join("&");
      const path = qs.length > 0
        ? `/v1/kv/${this.bucket}/${key}?${qs}`
        : `/v1/kv/${this.bucket}/${key}`;

      const v = await this.doFetch(
        "get",
        path,
        undefined,
      );
      return KvEntryImpl.parse(v);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  create(key: string, value?: Value): Promise<number> {
    return this._put("post", this.bucket, key, value);
  }

  async _put(
    method: string,
    bucket: string,
    key: string,
    value?: Value,
    previousRevision = -1,
  ): Promise<number> {
    const opts = [];
    if (previousRevision > -1) {
      opts.push(`previousRevision=${previousRevision}`);
    }

    const qs = opts.join("&");
    const path = qs.length > 0
      ? `/v1/kv/${bucket}/${key}?${qs}`
      : `/v1/kv/${bucket}/${key}`;

    const r = await this.doFetch(method, path, value, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!r.ok) {
      return this.handleError(r);
    }

    return r.json();
  }

  put(
    key: string,
    value?: Value,
    previousRevision = -1,
  ): Promise<number> {
    return this._put("put", this.bucket, key, value, previousRevision);
  }

  async delete(key: string, purge = false): Promise<boolean> {
    const opts = [];
    if (purge === true) {
      opts.push(`purge=true`);
    }

    const qs = opts.join("&");
    const path = qs.length > 0
      ? `/v1/kv/${this.bucket}/${key}?${qs}`
      : `/v1/kv/${this.bucket}/${key}`;

    const r = await this.doFetch(
      "delete",
      path,
      undefined,
      {
        headers: {
          "Accept": "application/json",
        },
      },
    );
    r.body?.cancel().catch(() => {});
    return r.ok;
  }

  async purge(): Promise<void> {
    const r = await this.doFetch(
      "DELETE",
      `/v1/kvm/buckets/${this.bucket}/purge`,
    );
    r.body?.cancel().catch(() => {});
    if (!r.ok) {
      return this.handleError(r);
    }
    return Promise.resolve();
  }

  async keys(filter = ">"): Promise<string[]> {
    const opts = [];
    if (typeof filter === "string") {
      opts.push(`filter=${encodeURIComponent(filter)}`);
    }

    const qs = opts.join("&");
    const path = qs.length > 0
      ? `/v1/kvm/buckets/${this.bucket}/keys?${qs}`
      : `/v1/kvm/buckets/${this.bucket}/keys`;

    const r = await this.doFetch("GET", path, undefined, {
      headers: {
        "Accept": "application/json",
      },
    });
    if (!r.ok) {
      return this.handleError(r);
    }
    return r.json();
  }

  watch(
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
      ? `/v1/kvm/buckets/${this.bucket}/watch?${qs}`
      : `/v1/kvm/buckets/${this.bucket}/watch`;

    return Promise.resolve(
      new KvWatcher(new EventSource(new URL(path, this.url)), opts.callback),
    );
  }

  async info(): Promise<KvBucketInfo> {
    const r = await this.doFetch(
      "GET",
      `/v1/kvm/buckets/${this.bucket}`,
      undefined,
      {
        headers: {
          "Accept": "application/json",
        },
      },
    );
    if (!r.ok) {
      return this.handleError(r);
    }
    return r.json();
  }
}

class KvWatcher implements Watcher {
  fn: KvWatchFn;
  es: EventSource;
  stopped: Deferred<void>;
  constructor(es: EventSource, fn: KvWatchFn) {
    this.es = es;
    this.fn = fn;
    this.stopped = deferred();

    es.addEventListener("update", (e: MessageEvent) => {
      this.fn(undefined, toKvChangeEvent(e));
    });

    es.addEventListener("closed", () => {
      this.fn(new Error("watcher closed"), undefined);
      this.stopped.resolve();
    });
  }
  stop(): Promise<void> {
    if (this.es.readyState === this.es.CLOSED) {
      this.stopped.resolve();
    }
    this.es.close();
    return this.stopped;
  }
}
