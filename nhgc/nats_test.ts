import { newNHG } from "./mod.ts";
import { delay } from "https://deno.land/std@0.200.0/async/delay.ts";
import { getConnectionDetails } from "./credentials.ts";
import {
  assert,
  assertEquals,
  assertExists,
  fail,
} from "https://deno.land/std@0.207.0/assert/mod.ts";

Deno.test("nats - pub", async () => {
  const nhg = newNHG(getConnectionDetails());
  await nhg.nats.publish("hello");
});

Deno.test("nats - sub", async () => {
  const nhg = newNHG(getConnectionDetails());
  const msgs = [];
  const sub = await nhg.nats.subscribe("hello", (err, msg) => {
    if (err) {
      fail(err.message);
    } else if (msg) {
      msgs.push(msg);
    }
  });

  const ticker = setInterval(() => {
    nhg.nats.publish("hello", new Date().toISOString())
      .then();
  }, 250);

  await delay(1000);
  sub.unsubscribe();
  clearInterval(ticker);
  assert(msgs.length > 0);
});

Deno.test("nats - request reply", async () => {
  const nhg = newNHG(getConnectionDetails());
  const nc = nhg.nats;
  const sub = await nc.subscribe("q", (err, msg) => {
    if (err) {
      fail(err.message);
    }
    if (msg) {
      if (msg.reply) {
        nc.publish(msg.reply, "OK: " + msg.string());
      }
    }
  });
  const r = await nc.request("q", "hello");
  assertEquals(r.string(), "OK: hello");
  sub.unsubscribe();
});

Deno.test("nats - publish headers", async () => {
  const nhg = newNHG(getConnectionDetails());
  const nc = nhg.nats;
  const sub = await nc.subscribe("q", (err, msg) => {
    if (err) {
      fail(err.message);
    }
    assertExists(msg);
    assertEquals(msg.headers.get("Hello-World"), "Hi");
  });

  await nc.publish("q", undefined, { headers: { "NatsH-Hello-World": "Hi" } });
  await nc.flush();
  sub.unsubscribe();
});

Deno.test("nats - request headers", async () => {
  const nhg = newNHG(getConnectionDetails());
  const nc = nhg.nats;
  const sub = await nc.subscribe("q", (err, msg) => {
    if (err) {
      fail(err.message);
    }
    assertExists(msg);
    assertEquals(msg.headers.get("Hello-World"), "Hi");
    assertExists(msg.reply);
    nc.publish(msg.reply);
  });

  await nc.request("q", undefined, { headers: { "NatsH-Hello-World": "Hi" } });
  sub.unsubscribe();
});

Deno.test("nats - queue subs", async () => {
  const nhg = newNHG(getConnectionDetails());
  const nc = nhg.nats;

  const a = [];
  const sub1 = await nc.subscribe("q.*", (err, msg) => {
    if (err) {
      fail(err.message);
    }
    a.push(msg?.subject);
  }, { queue: "hello" });

  const b = [];
  const sub2 = await nc.subscribe("q.*", (err, msg) => {
    if (err) {
      fail(err.message);
    }
    b.push(msg?.subject);
  }, { queue: "hello" });

  const proms = [];
  for (let i = 0; i < 100; i++) {
    proms.push(nc.publish(`q.${i}`));
  }
  proms.push(nc.flush());
  proms.push(await delay(1000));

  await Promise.all(proms);

  assertEquals(a.length + b.length, 100);

  sub1.unsubscribe();
  sub2.unsubscribe();
});
