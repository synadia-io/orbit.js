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

import { Kv, KvEntry, Operation, ReviverFn, Value } from "./types.ts";
import { HttpImpl } from "./nhgc.ts";

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
        return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
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
      r.body?.cancel().catch();
      return Promise.reject(new Error(`${r.status}: ${r.statusText}`));
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
}
