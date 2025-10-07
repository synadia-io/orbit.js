/*
 * Copyright 2024 Synadia Communications, Inc
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

import { headers } from "@nats-io/nats-core";

import type {
  Msg,
  MsgHdrs,
  MsgImpl,
  NatsConnection,
  Payload,
  Publisher,
  PublishOptions,
  ReviverFn,
} from "@nats-io/nats-core/internal";

import { ServiceErrorCodeHeader, ServiceErrorHeader } from "@nats-io/services";

export type {
  Msg,
  MsgHdrs,
  Payload,
  PublishOptions,
  ReviverFn,
} from "@nats-io/nats-core";

import { Empty } from "@nats-io/nats-core/internal";

/**
 * MutableMsg is a mutable implementation of the NATS Msg interface.
 * It allows modification of message properties such as subject, reply, data,
 * and headers, making it suitable for use in message transformation pipelines.
 */
export class MutableMsg implements Msg {
  #_data?: Uint8Array;
  #_subject?: string;
  #_sid?: number;
  #_reply?: string | undefined;
  #_headers?: MsgHdrs | undefined;
  #_publisher?: Publisher;

  /**
   * Creates a MutableMsg from an existing Msg instance.
   * @param src - The source message to copy from.
   * @returns A new MutableMsg instance with all properties copied from the source.
   */
  static fromMsg(src: Msg): MutableMsg {
    const m = new MutableMsg();
    m.#_subject = src.subject;
    m.#_reply = src.reply;
    m.#_data = src.data;
    m.#_sid = src.sid;
    m.#_headers = src.headers;
    m.#_publisher = (src as MsgImpl).publisher;

    return m;
  }

  /**
   * Gets the message payload data.
   */
  get data(): Uint8Array {
    return this.#_data || Empty;
  }

  /**
   * Sets the message payload data.
   */
  set data(data: Uint8Array) {
    this.#_data = data;
  }

  /**
   * Gets the subject the message was published to.
   */
  get subject(): string {
    return this.#_subject || "";
  }

  /**
   * Sets the subject.
   */
  set subject(s: string) {
    this.#_subject = s;
  }

  /**
   * Gets the reply subject for the message.
   */
  get reply(): string {
    return this.#_reply || "";
  }

  /**
   * Sets the reply subject.
   */
  set reply(reply: string) {
    this.#_reply = reply;
  }

  /**
   * Gets the subscription ID.
   */
  get sid(): number {
    return this.#_sid || 0;
  }

  /**
   * Sets the subscription ID.
   */
  set sid(sid: number) {
    this.#_sid = sid;
  }

  /**
   * Gets the message headers.
   */
  get headers(): MsgHdrs | undefined {
    return this.#_headers;
  }

  /**
   * Sets the message headers.
   */
  set headers(h: MsgHdrs | undefined) {
    this.#_headers = h;
  }

  /**
   * Gets the publisher instance.
   */
  get publisher(): Publisher | undefined {
    return this.#_publisher;
  }

  /**
   * Sets the publisher instance.
   */
  set publisher(p: Publisher | NatsConnection) {
    this.#_publisher = p;
  }

  /**
   * Sends an error response to the reply subject with error headers.
   * @param code - The error code.
   * @param description - The error description.
   * @param data - Optional payload data.
   * @param opts - Optional publish options.
   * @returns True if the response was sent successfully.
   * @throws {Error} If the publisher is not set.
   */
  respondError(
    code: number,
    description: string,
    data?: Uint8Array,
    opts?: PublishOptions,
  ): boolean {
    opts = opts || {};
    opts.headers = opts.headers || headers();
    opts.headers?.set(ServiceErrorCodeHeader, `${code}`);
    opts.headers?.set(ServiceErrorHeader, description);
    return this.respond(data, opts);
  }

  /**
   * Sends a response to the reply subject.
   * @param payload - Optional payload to send in the response.
   * @param opts - Optional publish options.
   * @returns True if the response was sent successfully.
   * @throws {Error} If the publisher is not set.
   */
  respond(payload?: Payload, opts?: PublishOptions): boolean {
    if (this.publisher) {
      this.publisher.publish(this.reply!, payload!, opts);
      return true;
    }
    throw new Error("publisher is not set");
  }

  /**
   * Parses the message data as JSON.
   * @param reviver - Optional reviver function for JSON.parse.
   * @returns The parsed JSON object.
   */
  json<T>(reviver?: ReviverFn): T {
    return JSON.parse(new TextDecoder().decode(this.data), reviver);
  }

  /**
   * Decodes the message data as a UTF-8 string.
   * @returns The decoded string.
   */
  string(): string {
    return new TextDecoder().decode(this.data);
  }
}

/**
 * Interface for message transformation pipelines.
 */
export interface Pipelines {
  /**
   * Transforms a message through the pipeline.
   * @param m - The message to transform.
   * @returns A promise that resolves to the transformed message.
   */
  transform(m: Msg): Promise<Msg>;
}

/**
 * A function that transforms a NATS message.
 * Pipeline functions can be synchronous or asynchronous.
 */
export type PipelineFn = (msg: Msg) => Promise<Msg> | Msg;

/**
 * Pipeline orchestrates a sequence of message transformations.
 * Each transformation function in the pipeline receives the output of the previous function.
 * If any transformation throws an error, the pipeline stops and rejects.
 */
export class Pipeline implements Pipelines {
  private readonly pipeline: PipelineFn[];

  /**
   * Creates a new Pipeline with the specified transformation functions.
   * @param pipeline - One or more transformation functions to apply in sequence.
   */
  constructor(...pipeline: PipelineFn[]) {
    this.pipeline = pipeline;
  }

  /**
   * Transforms a message by applying each pipeline function in sequence.
   * @param m - The message to transform.
   * @returns A promise that resolves to the transformed message.
   * @throws Rejects with the error if any transformation function throws.
   */
  async transform(m: Msg): Promise<Msg> {
    for (const fn of this.pipeline) {
      try {
        m = await fn(m);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return Promise.resolve(m);
  }
}
