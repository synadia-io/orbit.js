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
export type Value = string | Uint8Array | ReadableStream<Uint8Array>;

export type Operation = "PUT" | "DEL" | "PURGE";

export function toKvChangeEvent(m: MessageEvent): KvChangeEvent {
  // deno-lint-ignore no-explicit-any
  return JSON.parse(m.data, function (this: any, key: string, value: any): any {
    if (key === "created" && value !== "") {
      return new Date(Date.parse(value));
    }
    return value;
  }) as KvChangeEvent;
}

export interface KvChangeEvent {
  key: string;
  bucket: string;
  created: Date;
  revision: number;
  delta: number;
  operation: Operation;
}

export interface KvEntryInfo {
  bucket: string;
  created: Date;
  revision: number;
  delta: number;
  operation: Operation;
  value: Uint8Array | string;
}

export interface KvEntry extends KvEntryInfo {
  string(): string;
  json<T>(reviver?: ReviverFn): T;
}

export type ReviverFn = (key: string, value: unknown) => unknown;

export interface Kv {
  /**
   * Creates an entry in the KV only if it doesn't already exist.
   * @return the revision of the key.
   * @param key
   * @param value
   */
  create(key: string, value?: Value): Promise<number>;

  /**
   * Retrieves the entry from the KV, or null if the entry doesn't
   * exist or has been deleted.
   * @param key
   * @param revision - if specified will return the value at the specified revision.
   */
  get(key: string, revision?: number): Promise<KvEntry | null>;

  /**
   * Adds or updates the specified entry.
   * @param key
   * @param value
   * @param previousRevision - if specified the previous revision for the entry must be the revision specified
   */
  put(
    key: string,
    value?: Value,
    previousRevision?: number,
  ): Promise<number>;

  /**
   * Deletes the specified entry.
   * @param key
   * @param purge - if specified, history values are removed.
   */
  delete(key: string, purge?: boolean): Promise<boolean>;

  /** */
  purge(): Promise<void>;
  keys(filter?: string): Promise<string[]>;
  watch(opts: KvWatchOpts): Promise<Watcher>;
  info(): Promise<KvBucketInfo>;
}

export type KvBucketInfo = {
  name: string;
  values: number;
  history: number;
  ttl: number;
  backing_store: string;
  size: number;
  compression: boolean;
};

export type KvBucketConfig = {
  description: string;
  max_value_size: number;
  history: number;
  ttl: number;
  max_bytes: number;
  storage: "file" | "memory";
  replicas: number;
  compression: boolean;
  metadata: Record<string, string>;
};

export type Include = "allHistory" | "updatesOnly" | "lastValue" | "";

export type KvWatchFn = (err?: Error, e?: KvChangeEvent) => void;

export interface Watcher {
  stop(): void;
  stopped: Promise<void>;
}

export type KvWatchOpts = WatchOpts & {
  filter?: string;
  resumeRevision?: number;
  callback: KvWatchFn;
};

export type HeartbeatOpts = {
  idleHeartbeat?: number;
};

export type WatchOpts = HeartbeatOpts & {
  include?: Include;
  ignoreDeletes?: boolean;
};

export interface Kvm {
  get(bucket: string): Kv;
  add(bucket: string, config?: Partial<KvBucketConfig>): Promise<Kv>;
  destroy(bucket: string): Promise<void>;
  list(): Promise<string[]>;
  info(bucket: string): Promise<KvBucketInfo>;
}
