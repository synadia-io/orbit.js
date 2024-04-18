import { headers } from "nbc/mod.ts";
import { Msg, MutableMsg, Pipeline, SyncPipeline } from "./mod.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertThrows,
} from "https://deno.land/std@0.221.0/assert/mod.ts";
import { connect, nuid, syncIterator } from "nats";

Deno.test("mm - copies values", async () => {
  const nc = await connect({ servers: "demo.nats.io" });
  const subj = nuid.next();
  const reply = subj.split("").reverse().join();
  const sub = syncIterator(nc.subscribe(subj));
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

  await nc.close();
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

Deno.test("mm - respond", async () => {
  const nc = await connect({ servers: "demo.nats.io" });
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
  await nc.close();
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

Deno.test("sync pipeline", async () => {
  function toJSON(m: Msg): Msg {
    const mm = MutableMsg.fromMsg(m);
    try {
      const message = m.string();
      if (message === "") {
        throw new Error("message is empty");
      }
      const body = { message };
      mm.data = new TextEncoder().encode(JSON.stringify(body));
    } catch (err) {
      const body = { error: err.message };
      mm.data = new TextEncoder().encode(JSON.stringify(body));
    }
    return mm;
  }

  const pipeline = new SyncPipeline(toJSON);
  const nc = await connect({ servers: "demo.nats.io" });
  const subj = nuid.next();
  const sub = nc.subscribe(subj);
  (async () => {
    for await (const m of sub) {
      const r = pipeline.transform(m);
      if (r.isError) {
        const mm = MutableMsg.fromMsg(m);
        mm.respondError(500, r.error.message);
      } else {
        nc.respondMessage(r.value);
      }
    }
  })().then();

  let r = await nc.request(subj, "hello!");
  assertEquals(r.json(), { message: "hello!" });

  r = await nc.request(subj, "");
  assertEquals(r.json(), { error: "message is empty" });

  await nc.close();
});

Deno.test("sync pipeline error", async () => {
  function failIt(): Msg {
    throw new Error("zonk!");
  }

  const pipeline = new SyncPipeline(failIt);
  const nc = await connect({ servers: "demo.nats.io" });
  const subj = nuid.next();
  const sub = nc.subscribe(subj);
  (async () => {
    for await (const m of sub) {
      const r = pipeline.transform(m);
      assert(r.isError);
      assertExists(r.error);
      m.respond("zonk!");
    }
  })().then();

  const r = await nc.request(subj, "hello!");
  assertEquals(r.string(), "zonk!");

  await nc.close();
});

Deno.test("async pipeline", async () => {
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
      const body = { error: err.message };
      mm.data = new TextEncoder().encode(JSON.stringify(body));
    }
    return Promise.resolve(mm);
  }

  const pipeline = new Pipeline(toJSON);
  const nc = await connect({ servers: "demo.nats.io" });
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

  await nc.close();
});

Deno.test("asyncpipeline error", async () => {
  function failIt(): Promise<Msg> {
    return Promise.reject(new Error("zonk!"));
  }

  const pipeline = new Pipeline(failIt);
  const nc = await connect({ servers: "demo.nats.io" });
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

  await nc.close();
});
