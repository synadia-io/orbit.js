/*
 * Copyright 2026 Synadia Communications, Inc
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
 * High-throughput batch publish to JetStream (ADR-50).
 *
 * A regular JetStream publish waits for an ack on every message. Fast ingest
 * opens a batch and streams messages into it: the server acks the batch
 * periodically and sets the pace from how busy the stream is. Awaiting each
 * {@link FastIngest.add} is all the back-pressure a producer needs.
 *
 * Requires nats-server 2.14.0 or later, and a stream created with
 * `allow_batched: true`.
 *
 * This module re-exports the fast-ingest API of `@nats-io/jetstream`, which is
 * still internal there, as a stable surface until it lands in the public
 * JetStream API.
 *
 * @example
 * ```ts
 * import { wsconnect } from "@nats-io/nats-core";
 * import { startFastIngest } from "@synadiaorbit/fastingest";
 *
 * const nc = await wsconnect({ servers: "wss://demo.nats.io:8443" });
 * // the first message opens the batch
 * const fi = await startFastIngest(nc, "orders.created", "order 0", {
 *   allowGaps: false,
 *   ackInterval: 100,
 * });
 * for (let i = 1; i < 999; i++) {
 *   // resolves when the server's pacing has room for the message
 *   await fi.add("orders.created", `order ${i}`);
 * }
 * // store a final message and commit; end() commits without one
 * const ack = await fi.last("orders.created", "order 999");
 * console.log(`stored ${ack.count} messages, last seq ${ack.seq}`);
 * await nc.close();
 * ```
 *
 * @module
 */

import { startFastIngest as start } from "@nats-io/jetstream/internal";
import type {
  FastIngest as JsFastIngest,
  FastIngestOptions as JsFastIngestOptions,
  FastIngestProgress as JsFastIngestProgress,
  JetStreamPublishOptions,
} from "@nats-io/jetstream/internal";
import type { NatsConnection, Payload } from "@nats-io/nats-core";

/**
 * A fast-ingest batch, returned by {@link startFastIngest}.
 *
 * - `add(subj, payload?, opts?)` publishes a message, and resolves with a
 *   {@link FastIngestProgress} when the in-flight window has room.
 * - `last(subj, payload?, opts?)` stores a final message and commits the
 *   batch; `end(opts?)` commits without one. Both resolve to the batch ack,
 *   with the last stored stream sequence (`seq`) and the number of messages
 *   stored (`count`).
 * - `ping(timeout?)` keeps the batch alive and returns progress fresh from the
 *   server. The server abandons a batch idle for 10 seconds.
 * - `done()` resolves with the batch ack however the batch ended.
 * - `gaps()` yields `{ lastSeq, seq }` for each range of batch sequences the
 *   server didn't receive.
 * - `batch` is the batch id, matching `batch` on the batch ack.
 *
 * Full member docs:
 * {@link https://jsr.io/@nats-io/jetstream/doc/internal/~/FastIngest}
 */
export type FastIngest = JsFastIngest;

/**
 * Options for {@link startFastIngest}.
 *
 * - `allowGaps` (required): `false` aborts the batch at the first gap,
 *   `true` reports gaps through `gaps()` and keeps going.
 * - `ackInterval`: the most messages the server may go between acks. The
 *   server picks the actual interval from the stream's load. Default 10.
 * - `maxOutstandingAcks`: how many ack windows may be unacked before `add()`
 *   waits, an integer from 1 to 3. Default 2.
 * - `inboxPrefix`: prefix of the batch's reply subject. Default `_INBOX`.
 *
 * {@link https://jsr.io/@nats-io/jetstream/doc/internal/~/FastIngestOptions}
 */
export type FastIngestOptions = JsFastIngestOptions;

/**
 * Batch progress returned by {@link FastIngest.add} and
 * {@link FastIngest.ping}: `batchSeq` is the message's 1-based position in the
 * batch (not its stream sequence), `ackSeq` the highest position the server
 * has acknowledged.
 *
 * {@link https://jsr.io/@nats-io/jetstream/doc/internal/~/FastIngestProgress}
 */
export type FastIngestProgress = JsFastIngestProgress;

/**
 * Starts a fast-ingest batch, publishing `payload` to `subj` as its first
 * message, and resolves once the server has acknowledged it.
 *
 * Rejects if the options are invalid (for example `maxOutstandingAcks`
 * outside 1 to 3), or if the stream for `subj` wasn't created with
 * `allow_batched: true`.
 *
 * @param nc - the connection to publish on
 * @param subj - subject of the first message, which selects the stream
 * @param payload - payload of the first message
 * @param opts - {@link FastIngestOptions}, where only `allowGaps` is
 *   required, plus any JetStream publish options (headers, expectations) for
 *   the first message
 * @param defaultTimeout - milliseconds to wait for the server's acks,
 *   default 5000
 */
export function startFastIngest(
  nc: NatsConnection,
  subj: string,
  payload: Payload | undefined,
  opts:
    & { allowGaps: boolean }
    & Partial<FastIngestOptions>
    & Partial<JetStreamPublishOptions>,
  defaultTimeout?: number,
): Promise<FastIngest> {
  return start(nc, subj, payload, opts, defaultTimeout);
}
