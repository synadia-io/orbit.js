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
/**
 * Value represents a payload type value. Can be a string, Uint8Array or a ReadableStream<Uint8Array>.
 */
export type Value = string | Uint8Array | ReadableStream<Uint8Array>;

/**
 * This function converts a MessageEvent into a KvChangeEvent
 * @param m
 */
export function toKvChangeEvent(m: MessageEvent): KvChangeEvent {
  // deno-lint-ignore no-explicit-any
  return JSON.parse(m.data, function (this: any, key: string, value: any): any {
    if (key === "created" && value !== "") {
      return new Date(Date.parse(value));
    }
    return value;
  }) as KvChangeEvent;
}

/**
 * KvOperation types operations recorded by the KV, such as "PUT", "DEL" or "PURGE"
 */
export type KvOperation = "PUT" | "DEL" | "PURGE";

/**
 * KvChangeEvent is the interface of events for a Kv Watch.
 */
export interface KvChangeEvent {
  /**
   * The name of the key
   */
  key: string;
  /**
   * The name of the bucket
   */
  bucket: string;
  /**
   * The created Date for the entry
   */
  created: Date;
  /**
   * The revision of the entry
   */
  revision: number;
  /**
   * The delta from the entry's revision the latest revision in the KV
   */
  delta: number;
  /**
   * The operation type of the entry
   */
  operation: KvOperation;
}

/**
 * KvEntryInfo describes the metadata properties for a KvEntry
 */
export interface KvEntryInfo {
  /**
   * The bucket storing the entry
   */
  bucket: string;
  /**
   * The created Date for the entry
   */
  created: Date;
  /**
   * The revision of the entry
   */
  revision: number;
  /**
   * The delta from the entry's revision the latest revision in the KV
   */
  delta: number;
  /**
   * The operation type of the entry
   */
  operation: KvOperation;
  /**
   * The value of the entry - if string type, it is base64 encoded
   */
  value: Uint8Array | string;
}

/**
 * Represents a KvEntry, note you can access data directly via KvEntryInfo properties.
 */
export interface KvEntry extends KvEntryInfo {
  /**
   * Returns the value of the entry in string form.
   */
  string(): string;

  /**
   * Returns the value of the entry as a JavaScript object.
   * @param reviver
   */
  json<T>(reviver?: ReviverFn): T;
}

/**
 * A ReviverFn allows you to modify the object returned by KvEntry#json()
 * during JSON parsing.
 */
export type ReviverFn = (key: string, value: unknown) => unknown;

/**
 * Kv is the interface to a NATS Kv
 */
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

  /**
   * Purge removes all history values for an entry that has been deleted.
   */
  purge(): Promise<void>;

  /**
   * Keys returns a list of subjects known to be in the KV. Note that
   * this operation will list entries that have been deleted (have a KvOperation "DEL").
   * @param filter
   */
  keys(filter?: string): Promise<string[]>;

  /**
   * Returns a watcher that notifies you of changes to the KV.
   * This creates an EventSource under the hood - note that if
   * there's an error, the reason for the error is not available.
   * @param opts
   */
  watch(opts: KvWatchOpts): Promise<Watcher>;

  /**
   * Returns information about a Kv bucket.
   */
  info(): Promise<KvBucketInfo>;
}

/**
 * Type of describing the state of a Kv
 */
export type KvBucketInfo = {
  /**
   * Name of the bucket
   */
  name: string;
  /**
   * The number of values (entries in the KV), will include
   * values that are in history.
   */
  values: number;
  /**
   * Maximum number of history entries for a key
   */
  history: number;
  /**
   * Maximum amount of milliseconds an entry can live in the KV
   */
  ttl: number;
  /**
   * The storage type of the Kv
   */
  backing_store: string;
  /**
   * The number of bytes that the KV uses on disk
   */
  size: number;
  /**
   * True if the KV compresses values
   */
  compression: boolean;
};

/**
 * Type describing a Kv configuration
 */
export type KvBucketConfig = {
  /**
   * An user specified description
   */
  description: string;
  /**
   * The maximum size in bytes for an entry
   */
  max_value_size: number;
  /**
   * The maximum number of history entries per key
   */
  history: number;
  /**
   * The number of milliseconds that an entry will live (0 is forever)
   */
  ttl: number;
  /**
   * The maximum amount of storage that the KV can grow to
   */
  max_bytes: number;
  /**
   * The type of storage used by the KV
   */
  storage: "file" | "memory";
  /**
   * The number of replicas for the KV
   */
  replicas: number;
  /**
   * Compress the KV data
   */
  compression: boolean;
  /**
   * User metadata entries
   */
  metadata: Record<string, string>;
};

/**
 * Types of data to include on when watching the Kv.
 * All history will include all values and their changes recorded in history
 * Updates only will only notify when there's a change in the Kv after the watch is started
 * Last value will notify of the latest values for a key when the watcher starts.
 */
export type KvInclude = "allHistory" | "updatesOnly" | "lastValue" | "";

/**
 * Callback for the watcher
 */
export type KvWatchFn = (err?: Error, e?: KvChangeEvent) => void;

/**
 * Interface for interacting with a Watcher. Allows you to stop it,
 * as well as get notified when it stops.
 */
export interface Watcher {
  /**
   * Requests the watcher to stop yielding values.
   */
  stop(): void;

  /**
   * Promise that resolves to true when the watcher stops.
   */
  stopped: Promise<void>;
}

/**
 * Options for a Watch
 */
export type KvWatchOpts = WatchOpts & {
  /**
   * Filter watcher to the specified key
   */
  filter?: string;
  /**
   * Resume a watch at a the specified revision.
   */
  resumeRevision?: number;
  /**
   * A callback that will get called when a value is added, updated, or deleted.
   * Note that values pruned by a TTL may not get notified.
   */
  callback: KvWatchFn;
};

export type HeartbeatOpts = {
  /**
   * Send a heartbeat if no values are notified within the specified time.
   * This option should be left to its default (30_000 millis) unless you
   * have been directed by support to use a different value.
   */
  idleHeartbeat?: number;
};

export type SubOpts = {
  /**
   * NATS queue group to place the subscription under
   */
  queue: string;
} & HeartbeatOpts;

export type WatchOpts = HeartbeatOpts & {
  /**
   * Values to include in the updates
   */
  include?: KvInclude;
  /**
   * If true, deletes will not be notified
   */
  ignoreDeletes?: boolean;
};

/**
 * An interface for managing Kvs
 */
export interface Kvm {
  /**
   * Start a context for operating on a specific Kv. Note this operation
   * doesn't perform any remote calls.
   * @param bucket
   */
  get(bucket: string): Kv;

  /**
   * Add a new Kv bucket
   * @param bucket
   * @param config
   */
  add(bucket: string, config?: Partial<KvBucketConfig>): Promise<Kv>;

  /**
   * Destroy a Kv bucket
   * @param bucket
   */
  destroy(bucket: string): Promise<void>;

  /**
   * List available Kv bucket names
   */
  list(): Promise<string[]>;

  /**
   * Get info on a Kv
   * @param bucket
   */
  info(bucket: string): Promise<KvBucketInfo>;
}

export interface Msg {
  headers: Headers;
  subject: string;
  reply?: string;
  data?: Uint8Array;

  string(): string;
  json<T>(r?: ReviverFn): T;
}

export type MsgCallback = (err?: Error, msg?: Msg) => void;

export interface Sub {
  unsubscribe(): void;
}

export interface Nats {
  /**
   * Publishes the specified data to the specified subject.
   * @param subject
   * @param data
   * @param opts - { headers?: HeadersInit }
   */
  publish(
    subject: string,
    data?: Value,
    opts?: { headers?: HeadersInit },
  ): Promise<void>;

  /**
   * Publishes the specified data to the specified subject with the
   * specified reply subject.
   * @param subject
   * @param reply
   * @param data
   * @param opts - { headers?: HeadersInit }
   *
   * You can also specify headers - Note only headers that start with
   * `NatsH-` are sent via NATS.
   */
  publishWithReply(
    subject: string,
    reply: string,
    data?: Value,
    opts?: { headers?: HeadersInit },
  ): Promise<void>;

  /**
   * Publishes a request with specified data in the specified subject expecting a
   * response before a timeout in milliseconds. The api returns a
   * Promise that resolves when the first response to the request is received. If
   * there are no responders (a subscription) listening on the request subject,
   * the request will fail as soon as the server processes it.
   *
   * You can specify a timeout in milliseconds - default is 2000 milliseconds.
   *
   * You can also specify headers - Note only headers that start with
   * `NatsH-` are sent via NATS.
   * @param subject
   * @param data
   * @param opts - { timeout?: number; headers?: HeadersInit }
   */
  request(
    subject: string,
    data?: Value,
    opts?: { timeout?: number; headers?: HeadersInit },
  ): Promise<Msg>;

  /**
   * Subscribe expresses interest in the specified subject. The subject may
   * have wildcards. Messages are delivered to the callback
   * subscribe(subject: string, cb: MsgCallback): Promise<Sub>;
   * This creates an EventSource under the hood - note that if
   * there's an error, the reason for the error is not available.
   * @param subject
   * @param cb (err?: Error, msg?: Msg) => void;
   * @param opts subscription options
   */
  subscribe(
    subject: string,
    cb: MsgCallback,
    opts?: Partial<SubOpts>,
  ): Promise<Sub>;

  /**
   * Performs a round trip to the server.
   */
  flush(): Promise<void>;
}
