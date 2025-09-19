/*
 * Copyright 2025 Synadia Communications, Inc
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
  BaseApiClientImpl,
  JetStreamStatus,
  validateStreamName,
} from "@nats-io/jetstream/internal";

import type {
  BatchCallback,
  CompletionResult,
  DirectLastFor,
  DirectMsgRequest,
  JetStreamOptions,
} from "@nats-io/jetstream/internal";
import type {
  CallbackFn,
  Msg,
  NatsConnection,
  QueuedIterator,
} from "@nats-io/nats-core/internal";
import {
  createInbox,
  Empty,
  Feature,
  QueuedIteratorImpl,
} from "@nats-io/nats-core/internal";

export type DirectCounterRequest = DirectMsgRequest;

type RecordWithLastBySubj = Record<string, unknown> & {
  last_by_subj?: string;
};
export type CounterDirectLastFor = Omit<DirectLastFor, "callback"> & {
  callback: BatchCallback<Msg>;
};

export class CounterApi extends BaseApiClientImpl {
  constructor(nc: NatsConnection, opts?: JetStreamOptions) {
    super(nc, opts);
  }

  async get(
    stream: string,
    query: DirectCounterRequest,
  ): Promise<Msg> {
    validateStreamName(stream);

    if ("start_time" in query) {
      const { min, ok } = this.nc.features.get(Feature.JS_BATCH_DIRECT_GET);
      if (!ok) {
        throw new Error(`start_time direct option require server ${min}`);
      }
    }

    const qq = query as RecordWithLastBySubj;
    // Extract last_by_subj for subject construction, then remove it from the payload
    // because it will be included in the subject instead
    const last_by_subj = qq.last_by_subj;
    if (qq.last_by_subj) {
      delete qq.last_by_subj;
    }

    const payload = qq ? JSON.stringify(qq) : Empty;

    const pre = this.opts.apiPrefix || "$JS.API";
    const subj = last_by_subj
      ? `${pre}.DIRECT.GET.${stream}.${last_by_subj}`
      : `${pre}.DIRECT.GET.${stream}`;

    return await this.nc.request(
      subj,
      payload,
      { timeout: this.timeout },
    );
  }

  getBatch(
    stream: string,
    opts: CounterDirectLastFor,
  ): Promise<QueuedIterator<Msg>> {
    opts.batch = opts.batch || 1024;
    // copy the options
    opts = { ...opts };

    validateStreamName(stream);
    const callback = typeof opts.callback === "function" ? opts.callback : null;
    const iter = new QueuedIteratorImpl<Msg>();

    function pushIter(
      done: CompletionResult | null,
      d: Msg | CallbackFn,
    ) {
      if (done) {
        iter.push(() => {
          done.err ? iter.stop(done.err) : iter.stop();
        });
        return;
      }
      iter.push(d);
    }

    function pushCb(
      done: CompletionResult | null,
      m: Msg | CallbackFn,
    ) {
      const cb = callback!;
      if (typeof m === "function") {
        m();
        return;
      }
      cb(done, m);
    }

    if (callback) {
      iter.iterClosed.then((err) => {
        push({ err: err ? err : undefined }, {} as Msg);
        sub.unsubscribe();
      });
    }

    const push = callback ? pushCb : pushIter;

    const inbox = createInbox(this.nc.options.inboxPrefix);
    let batchSupported = false;
    const sub = this.nc.subscribe(inbox, {
      timeout: 5000,
      callback: (err, msg) => {
        if (err) {
          iter.stop(err);
          sub.unsubscribe();
          return;
        }
        const status = JetStreamStatus.maybeParseStatus(msg);
        if (status) {
          if (status.isEndOfBatch()) {
            push({}, () => {
              iter.stop();
            });
          } else {
            const err = status.toError();
            push({ err }, () => {
              iter.stop(err);
            });
          }
          return;
        }
        if (!batchSupported) {
          if (typeof msg.headers?.get("Nats-Num-Pending") !== "string") {
            // no batch/max_bytes option was provided, so single response
            sub.unsubscribe();
            push({}, () => {
              iter.stop();
            });
          } else {
            batchSupported = true;
          }
        }

        push(null, msg);
      },
    });

    const pre = this.opts.apiPrefix || "$JS.API";
    const subj = `${pre}.DIRECT.GET.${stream}`;

    const payload = JSON.stringify(opts, (key, value) => {
      if (
        (key === "up_to_time" || key === "start_time") && value instanceof Date
      ) {
        return value.toISOString();
      }
      return value;
    });

    this.nc.publish(subj, payload, { reply: inbox });

    return Promise.resolve(iter);
  }
}
