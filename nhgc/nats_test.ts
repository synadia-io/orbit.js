import { newNHG } from "./mod.ts";
import { delay } from "https://deno.land/std@0.200.0/async/delay.ts";
import { getConnectionDetails } from "./credentials.ts";
import {
  assertEquals,
  fail,
} from "https://deno.land/std@0.207.0/assert/mod.ts";

Deno.test("nats - pub", async () => {
  const nhg = newNHG(getConnectionDetails());
  await nhg.nats.publish("hello");
});

Deno.test("nats - sub", async () => {
  const nhg = newNHG(getConnectionDetails());
  const sub = await nhg.nats.subscribe("hello", (err, msg) => {
    if (err) {
      console.log(err);
    } else if (msg) {
      console.log(msg.string());
    }
  });

  const ticker = setInterval(() => {
    nhg.nats.publish("hello", new Date().toISOString())
      .then();
  }, 1000);

  await delay(5000);
  clearInterval(ticker);
  sub.unsubscribe();
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
