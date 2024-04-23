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
import { Value } from "./types.ts";

export interface Http {
  doFetch(
    method: string,
    path: string,
    body: string | ReadableStream<Uint8Array>,
    opts?: RequestInit,
  ): Promise<Response>;
}

export class HttpImpl implements Http {
  url: string;
  apiKey: string;

  constructor(url: string, apiKey: string) {
    this.url = url;
    this.apiKey = apiKey;
  }
  doFetch(
    method: string,
    path: string,
    body?: Value,
    opts: RequestInit = {},
  ): Promise<Response> {
    const u = new URL(path, this.url);

    if (body?.constructor === Uint8Array) {
      const d = body;
      body = new ReadableStream({
        start(controller) {
          controller.enqueue(d);
          controller.close();
        },
      });
    }
    const r = Object.assign(opts, { method, body });
    const headers = new Headers(opts.headers);
    headers.append("Authorization", this.apiKey);
    r.headers = headers;
    return fetch(u, r);
  }

  // deno-lint-ignore no-explicit-any
  handleError(r: Response): Promise<any> {
    r.body?.cancel().catch(() => {});
    const reason = r.headers.get("x-nats-api-gateway-error") || r.statusText;
    return Promise.reject(new Error(`${r.status}: ${reason}`));
  }
}
