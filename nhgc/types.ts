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
export type Value = string | Uint8Array | ReadableStream<Uint8Array>;

export type Operation = "PUT" | "DEL" | "PURGE";

export function toKvEntryInfo(m: MessageEvent): KvEntryInfo {
  return JSON.parse(m.data) as KvEntryInfo;
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
  create(key: string, value?: Value): Promise<number>;
  get(key: string, revision?: number): Promise<KvEntry | null>;
  put(
    key: string,
    value?: Value,
    previousRevision?: number,
  ): Promise<number>;
  delete(key: string, purge?: boolean): Promise<boolean>;
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

export type KvWatchFn = (err?: Error, e?: KvEntryInfo) => void;

export interface Watcher {
  stop(): void;
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
  include: Include;
  ignoreDeletes: boolean;
};

export interface Kvm {
  get(bucket: string): Kv;
  add(bucket: string, config?: Partial<KvBucketConfig>): Promise<Kv>;
  destroy(bucket: string): Promise<void>;
  purge(bucket: string): Promise<void>;
  list(): Promise<string[]>;
  info(bucket: string): Promise<KvBucketInfo>;
  keys(bucket: string, filter?: string): Promise<string[]>;
  watch(bucket: string, opts: KvWatchOpts): Promise<Watcher>;
}
