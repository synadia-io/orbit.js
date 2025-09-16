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
import { MutableMsg, Pipeline } from "../src/mod.ts";
import { Empty, headers, type Msg, wsconnect } from "@nats-io/nats-core";

function valid(m: Msg): Msg {
  if (m.data.length > 0) {
    return MutableMsg.fromMsg(m);
  } else {
    // so you could respond here, the code base needs to be certain
    // that of that behaviour as there's nothing preventing another
    // respond elsewhere.
    const h = headers();
    h.set("Error", "message is empty");
    m.respond(Empty, { headers: h });
    // the throws will be caught by the pipeline, which can then
    // choose to ignore the message
    throw new Error("message is empty");
  }
}

function reverse(m: Msg): Msg {
  try {
    const mm = MutableMsg.fromMsg(m);
    mm.data = new TextEncoder().encode(m.string().split("").reverse().join(""));
    return mm;
  } catch (err) {
    const h = headers();
    h.set("Error", err.message);
    m.respond(Empty, { headers: h });
    // the throws will be caught by the pipeline, which can then
    // choose to ignore the message
    throw err;
  }
}

const nc = await wsconnect({ servers: ["wss://demo.nats.io:8443"] });
const iter = nc.subscribe("hello");
(async () => {
  const pipeline = new Pipeline(valid, reverse);
  for await (const m of iter) {
    try {
      const r = await pipeline.transform(m);
      nc.respondMessage(r);
    } catch (_) {
      m.respond("error");
    }
  }
})();
await nc.flush();

const nc2 = await wsconnect({ servers: ["wss://demo.nats.io:8443"] });
let i = 0;
setInterval(() => {
  nc2.request("hello", `hello ${++i}`)
    .then((r: Msg) => {
      console.log(r.string());
    });
}, 1000);
