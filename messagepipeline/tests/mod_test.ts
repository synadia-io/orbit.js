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
import type { Msg } from "../src/mod.ts";
import { MutableMsg, Pipeline } from "../src/mod.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { nuid, syncIterator } from "@nats-io/nats-core";
import { setup } from "./server.ts";

Deno.test("mm - copies values", async () => {
  await using ctx = await setup();
  const { nc } = ctx;
  const subj = nuid.next();
  const reply = subj.split("").reverse().join();
  const sub = syncIterator<Msg>(nc.subscribe(subj));
  const h = headers();
  h.set("test", "a");
  nc.publish(subj, JSON.stringify({ hello: "world" }), { reply, headers: h });
  const m = await sub.next();
  assertExists(m);

  const ms = MutableMsg.fromMsg(m);
  assertEquals(ms.sid, 1);
  assertEquals(ms.subject, subj);
  assertEquals(ms.reply, reply);
  assertEquals(ms.headers?.get("test"), "a");
  assertEquals(ms.string(), '{"hello":"world"}');
  assertEquals(ms.json(), { hello: "world" });

  assertEquals(ms.respond(), true);
  assertEquals(ms.respondError(400, "hello"), true);
});

Deno.test("mm - publisher must be set", () => {
  const mm = new MutableMsg();
  assertThrows(
    () => {
      mm.respond();
    },
    Error,
    "publisher is not set",
  );

  assertThrows(
    () => {
      mm.respondError(500, "hello");
    },
    Error,
    "publisher is not set",
  );
});

Deno.test("mm - respondRequest needs a publisher and a reply", async () => {
  const mm = new MutableMsg();
  await assertRejects(
    () => mm.respondRequest(),
    Error,
    "publisher is not set",
  );
  await using ctx = await setup();
  const { nc } = ctx;
  mm.publisher = nc;
  await assertRejects(
    () => mm.respondRequest(),
    Error,
    "reply is not set",
  );
});

Deno.test("mm - respondRequest", async () => {
  await using ctx = await setup();
  const { nc } = ctx;
  const subj = nuid.next();

  // one responder uses the connection as its publisher, the other the
  // publisher of the message it received
  const answers: string[] = [];
  const done = (async () => {
    let i = 0;
    for await (const m of nc.subscribe(subj, { max: 2 })) {
      const mm = i++ === 0 ? new MutableMsg() : MutableMsg.fromMsg(m);
      if (i === 1) {
        mm.publisher = nc;
        mm.reply = m.reply!;
      }
      const r = await mm.respondRequest("question");
      answers.push(r.string());
    }
  })();

  for (let i = 0; i < 2; i++) {
    const r = await nc.request(subj);
    assertEquals(r.string(), "question");
    r.respond(`answer ${i}`);
  }
  await done;
  assertEquals(answers, ["answer 0", "answer 1"]);
});

Deno.test("mm - respond", async () => {
  await using ctx = await setup();
  const { nc } = ctx;
  const subj = nuid.next();

  (async () => {
    for await (const m of nc.subscribe(subj)) {
      const mm = new MutableMsg();
      mm.publisher = nc;
      mm.reply = m.reply!;
      mm.respond();
    }
  })().catch();

  await nc.request(subj);
});

Deno.test("mm - data", () => {
  const mm = new MutableMsg();
  assertEquals(mm.data, new Uint8Array(0));
  mm.data = new TextEncoder().encode("hello world");
  assertEquals(mm.string(), "hello world");
});

Deno.test("mm - subject", () => {
  const mm = new MutableMsg();
  assertEquals(mm.subject, "");
  mm.subject = "hello.world";
  assertEquals(mm.subject, "hello.world");
});

Deno.test("mm - reply", () => {
  const mm = new MutableMsg();
  assertEquals(mm.reply, "");
  mm.reply = "hello.world";
  assertEquals(mm.reply, "hello.world");
});

Deno.test("mm - sid", () => {
  const mm = new MutableMsg();
  assertEquals(mm.sid, 0);
  mm.sid = 1;
  assertEquals(mm.sid, 1);
});

Deno.test("mm - headers", () => {
  const mm = new MutableMsg();
  assertEquals(mm.headers, undefined);
  mm.headers = headers();
  mm.headers.set("hello", "world");
  assertEquals(mm.headers.get("hello"), "world");
});

Deno.test("pipeline", async () => {
  function toJSON(m: Msg): Promise<Msg> {
    const mm = MutableMsg.fromMsg(m);
    try {
      const message = m.string();
      if (message === "") {
        throw new Error("message is empty");
      }
      const body = { message };
      mm.data = new TextEncoder().encode(JSON.stringify(body));
    } catch (err) {
      const body = { error: (err as Error).message };
      mm.data = new TextEncoder().encode(JSON.stringify(body));
    }
    return Promise.resolve(mm);
  }

  const pipeline = new Pipeline(toJSON);
  await using ctx = await setup();
  const { nc } = ctx;
  const subj = nuid.next();
  const sub = nc.subscribe(subj);
  (async () => {
    for await (const m of sub) {
      pipeline.transform(m)
        .then((mm) => {
          nc.respondMessage(mm);
        })
        .catch((err) => {
          const mm = MutableMsg.fromMsg(m);
          mm.respondError(500, err.message);
        });
    }
  })().then();

  let r = await nc.request(subj, "hello!");
  assertEquals(r.json(), { message: "hello!" });

  r = await nc.request(subj, "");
  assertEquals(r.json(), { error: "message is empty" });
});

Deno.test("pipeline error", async () => {
  function failIt(): Promise<Msg> {
    return Promise.reject(new Error("zonk!"));
  }

  const pipeline = new Pipeline(failIt);
  await using ctx = await setup();
  const { nc } = ctx;
  const subj = nuid.next();
  const sub = nc.subscribe(subj);
  (async () => {
    for await (const m of sub) {
      pipeline.transform(m)
        .catch(() => {
          m.respond("zonk!");
        });
    }
  })().then();

  const r = await nc.request(subj, "hello!");
  assertEquals(r.string(), "zonk!");
});
