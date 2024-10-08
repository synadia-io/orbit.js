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
export interface Deferred<T> extends Promise<T> {
  /**
   * Resolves the Deferred to a value T
   * @param value
   */
  resolve: (value?: T | PromiseLike<T>) => void;
  /**
   * Rejects the Deferred
   * @param reason
   */
  // deno-lint-ignore no-explicit-any
  reject: (reason?: any) => void;
}

/**
 * Returns a Promise that has a resolve/reject methods that can
 * be used to resolve and defer the Deferred.
 */
export function deferred<T>(): Deferred<T> {
  let methods = {};
  const p = new Promise<T>((resolve, reject): void => {
    methods = { resolve, reject };
  });
  return Object.assign(p, methods) as Deferred<T>;
}

export function addEventSource(
  url: string | URL,
  eventSourceInitDict?: EventSourceInit,
): Promise<EventSource> {
  const d = deferred<EventSource>();
  const es = new EventSource(url, eventSourceInitDict);
  es.addEventListener("open", () => {
    d.resolve(es);
  });

  es.addEventListener("error", () => {
    d.reject(new Error("error creating the EventSource"));
  });

  return d;
}
