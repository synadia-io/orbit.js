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
import type {
  Msg,
  MsgCallback,
  NatsConnection,
  QueuedIterator,
  Subscription,
} from "@nats-io/nats-core";
import { createInbox } from "@nats-io/nats-core";
import { QueuedIteratorImpl } from "@nats-io/nats-core/internal";

export class MuxSubscription {
  prefix: string;
  sub: Subscription;
  handlers: Map<string, MsgCallback<Msg> | QueuedIterator<Msg>> = new Map();
  constructor(nc: NatsConnection) {
    const prefix = createInbox();
    this.prefix = prefix;
    this.sub = nc.subscribe(`${prefix}.>`, {
      callback: (err, msg: Msg) => {
        if (err !== null) {
          // the subscription should be done, and the
          // closed will report the error
          console.error("mux subscription error", err);
          return;
        }
        const token = msg.subject.slice(prefix.length + 1);
        const fn = this.handlers.get(token);
        if (typeof fn === "function") {
          try {
            fn(null, msg);
          } catch (_) {
            // eat it
          }
        } else if (fn instanceof QueuedIteratorImpl) {
          fn.push(msg);
        } else {
          console.error("mux not found", token);
        }
      },
    });

    this.sub.closed.then((err) => {
      for (const [_, fn] of this.handlers) {
        if (fn instanceof QueuedIteratorImpl) {
          fn.push(() => {
            fn.stop(err ? err : undefined);
          });
        }
      }
    });

    return this;
  }

  /**
   * A promise that resolves when the subscription closes. If the promise
   * resolves to an error, the subscription was closed because of an error
   * typically a permissions error. Note that this promise doesn't reject, but
   * rather resolves to void (no error) or an Error
   */
  get closed(): Promise<void | Error> {
    return this.sub.closed;
  }

  /**
   * Returns true if the subscription is draining.
   */
  isDraining(): boolean {
    return this.sub.isDraining();
  }

  /**
   * Returns true if the subscription is closed.
   */
  isClosed(): boolean {
    return this.sub.isClosed();
  }

  /**
   * Returns the subject used to create the subscription.
   */
  getSubject(): string {
    return this.sub.getSubject();
  }

  subjectFor(partialSubject: string): string {
    if (partialSubject.startsWith(this.prefix)) {
      partialSubject = partialSubject.slice(this.prefix.length + 1);
    }
    if (partialSubject.startsWith(".")) {
      throw new Error("partial subject must not start with '.'");
    }
    return `${this.prefix}.${partialSubject}`;
  }

  tokenFor(subj: string): string {
    if (subj.startsWith(this.prefix)) {
      subj = subj.slice(this.prefix.length + 1);
    }
    if (subj.startsWith(".")) {
      throw new Error("partial subject must not start with '.'");
    }
    return subj;
  }

  newMuxInbox(subj: string): QueuedIterator<Msg>;
  newMuxInbox(subj: string, cb: MsgCallback<Msg>): undefined;
  newMuxInbox(
    subj: string,
    cb?: MsgCallback<Msg>,
  ): QueuedIterator<Msg> | undefined {
    // this will verify the subject is somewhat sane
    subj = this.tokenFor(subj);
    if (typeof cb === "function") {
      this.handlers.set(subj, cb);
      return;
    }

    const qi = new QueuedIteratorImpl<Msg>();
    qi.iterClosed.then(() => {
      this.handlers.delete(subj);
    });
    this.handlers.set(subj, qi);
    return qi;
  }

  cancelMuxInbox(subj: string) {
    subj = this.tokenFor(subj);
    const qi = this.handlers.get(subj);
    if (qi instanceof QueuedIteratorImpl) {
      qi.push(() => {
        qi.stop();
      });
    }
    this.handlers.delete(subj);
  }

  /**
   * Drain the subscription, closing it after processing all messages
   * currently in flight for the client. Returns a promise that resolves
   * when the subscription finished draining.
   */
  drain(): Promise<void> {
    return this.sub.drain();
  }

  /**
   * Stop the subscription from receiving messages. You can optionally
   * specify that the subscription should stop after the specified number
   * of messages have been received. Note this count is since the lifetime
   * of the subscription.
   * @param max
   */
  unsubscribe(max?: number): void {
    return this.sub.unsubscribe(max);
  }
}
