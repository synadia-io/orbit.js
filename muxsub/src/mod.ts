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

/**
 * MuxSubscription provides a multiplexed subscription mechanism that allows
 * multiple logical subscriptions to share a single underlying NATS subscription.
 * This is useful for reducing the number of subscriptions when many temporary
 * reply subjects are needed, such as in request-response patterns.
 */
export class MuxSubscription {
  /**
   * The inbox prefix used for all multiplexed subjects.
   */
  prefix: string;
  /**
   * The underlying NATS subscription.
   */
  sub: Subscription;
  /**
   * Map of tokens to their corresponding message handlers (callbacks or iterators).
   */
  handlers: Map<string, MsgCallback<Msg> | QueuedIterator<Msg>> = new Map();
  /**
   * Creates a new MuxSubscription instance.
   * @param nc - The NATS connection to use for the subscription.
   */
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
   * A promise that resolves when the MuxSubscription closes. If the promise
   * resolves to an error, the subscription was closed because of an error
   * typically a permission error. Note that this promise doesn't reject, but
   * rather resolves to void (no error) or an Error
   */
  get closed(): Promise<void | Error> {
    return this.sub.closed;
  }

  /**
   * Returns true if the MuxSubscription is draining.
   */
  isDraining(): boolean {
    return this.sub.isDraining();
  }

  /**
   * Returns true if the MuxSubscription is closed.
   */
  isClosed(): boolean {
    return this.sub.isClosed();
  }

  /**
   * Returns the wildcard subject used by the MuxSubscription.
   */
  getSubject(): string {
    return this.sub.getSubject();
  }

  /**
   * Returns the subject for the specified subject token.
   * If the partial subject already contains the prefix, it is stripped first.
   * @param partialSubject - The partial subject to convert to a full subject.
   * @returns The full subject with the mux prefix.
   * @throws {Error} If the partial subject starts with '.'.
   */
  subjectFor(partialSubject: string): string {
    if (partialSubject.startsWith(this.prefix)) {
      partialSubject = partialSubject.slice(this.prefix.length + 1);
    }
    if (partialSubject.startsWith(".")) {
      throw new Error("partial subject must not start with '.'");
    }
    return `${this.prefix}.${partialSubject}`;
  }

  /**
   * Extracts the token (suffix) from the full subject.
   * If the subject already contains the prefix, it is stripped.
   * @param subj - The subject to extract the token from.
   * @returns The token extracted from the subject.
   * @throws {Error} If the subject starts with '.'.
   */
  tokenFor(subj: string): string {
    if (subj.startsWith(this.prefix)) {
      subj = subj.slice(this.prefix.length + 1);
    }
    if (subj.startsWith(".")) {
      throw new Error("partial subject must not start with '.'");
    }
    return subj;
  }

  /**
   * Creates a new inbox backed by the MuxSubscription for receiving messages.
   *
   * This method has two forms:
   * - When called with only a subject, it returns a QueuedIterator for async iteration
   * - When called with a subject and callback, it registers the callback and returns undefined
   *
   * @param subj - The subject token for this inbox.
   * @returns A QueuedIterator when no callback is provided, undefined when a callback is provided.
   */
  newMuxInbox(subj: string): QueuedIterator<Msg>;
  /**
   * Creates a new inbox backed by the MuxSubscription for receiving messages with a callback.
   * @param subj - The subject token for this inbox.
   * @param cb - The callback to invoke when messages are received.
   * @returns undefined
   */
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

  /**
   * Cancels an inbox for the specified token, stopping message delivery and
   * cleaning up resources. Other inboxes in the MuxSubscription will continue
   * to receive messages. If the handler is a QueuedIterator, it will be
   * stopped gracefully.
   * @param subj - The subject token of the inbox to cancel.
   */
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
   * Drain the MuxSubscription, closing it after processing all messages
   * currently in flight for the client. All inboxes are stopped.
   * @returns A promise that resolves when the subscription finished draining.
   */
  drain(): Promise<void> {
    return this.sub.drain();
  }

  /**
   * Stops the MuxSubscription. All inboxes are stopped. You can optionally
   * specify that the subscription should stop after the specified number
   * of messages have been received. Note this count is since the lifetime
   * of the subscription.
   * @param max - Optional maximum number of messages to receive before unsubscribing
   * and stopping the MuxSubscription
   */
  unsubscribe(max?: number): void {
    return this.sub.unsubscribe(max);
  }
}
