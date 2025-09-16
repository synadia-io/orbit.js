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

import { deferred, wsconnect } from "@nats-io/nats-core";
import type { Msg } from "@nats-io/nats-core";
import { MuxSubscription } from "../src/mod.ts";
import { assertEquals } from "@std/assert";

Deno.test("muxsub", async () => {
  const nc = await wsconnect({
    servers: ["wss://demo.nats.io:8443"],
    debug: true,
  });

  const mux = new MuxSubscription(nc);

  const s1 = mux.newMuxInbox("foo.bar", (_, msg: Msg) => {
    console.log("got a foo.bar!", msg?.subject);
  });
  // this is a callback
  assertEquals(s1, undefined);

  const d = deferred<void>();
  const qi = mux.newMuxInbox("bar.foo");
  (async () => {
    for await (const m of qi) {
      console.log("got a bar.foo!", m.subject);
    }
  })().then(() => {
    console.log("qi done");
    d.resolve();
  });
  // this is a callback so no iter

  nc.publish(mux.subjectFor("foo.bar"), "hello world");
  nc.publish(mux.subjectFor("bar.foo"), "world hello");

  await mux.drain();
  // iter closed!
  await d;
  await nc.close();
});
