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

import { type NatsConnection, wsconnect } from "@nats-io/nats-core";
import {
  cleanup,
  jetstreamServerConf,
  NatsServer,
  wsServerConf,
} from "@nats-io/nst";

export type TestContext = {
  ns: NatsServer;
  nc: NatsConnection;
  [Symbol.asyncDispose](): Promise<void>;
};

// starts a nats-server of the test's own, with a websocket listener (and
// jetstream when asked), and connects to it with wsconnect. use it with
// `await using`, which stops the server when the test ends
export async function setup(jetstream = false): Promise<TestContext> {
  const conf = jetstream ? jetstreamServerConf(wsServerConf()) : wsServerConf();
  const ns = await NatsServer.start(conf);
  const nc = await wsconnect({ servers: `ws://127.0.0.1:${ns.websocket}` });
  return {
    ns,
    nc,
    [Symbol.asyncDispose]() {
      return cleanup(ns, nc);
    },
  };
}
