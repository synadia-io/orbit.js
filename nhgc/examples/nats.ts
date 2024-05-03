import { newNHG } from "../mod.ts";
import { getConnectionDetails } from "../credentials.ts";

// create the gateway client
const nhg = newNHG(getConnectionDetails());

const nc = nhg.nats;

// to receive messages you can create a subscription.
// subscriptions are backed by an EventSource (SSE)":
let count = 0;
const sub = await nc.subscribe("hello", (err, msg) => {
  if (err) {
    console.error(err.message);
    return;
  }
  if (msg) {
    count++;
    // print a message
    console.log(
      `[${count}]: msg with payload "${msg.string()}" which has ${
        msg.data?.length || 0
      } bytes`,
    );
    // print the headers
    console.log("\t", msg.headers);

    // if you think the data is JSON, you can use:
    // msg.json() to decode it.
  }
});

// you can publish an empty message
await nc.publish("hello");

// you can specify a payload - payload can be a string, an Uint8Array or a ReadableStream<Uint8Array>
await nc.publish("hello", "world");

// you can also specify headers that will be included on the message.
// the only restriction is that the header keys must begin with the prefix `NatsH-`.
// Note that the prefix will be stripped. So for `NatsH-Hello` the NATS message
// will have a `Hello` header.
await nc.publish("hello", "world", {
  headers: {
    "NatsH-Language": "EN",
  },
});

// Implementing a service is simply a subscription that replies - services are usually
// in a queue group so they distribute the load
const svc = await nc.subscribe("q", async (err, msg) => {
  if (err) {
    console.error(err.message);
    return;
  }
  if (msg?.reply) {
    // echo the request - we are going to echo all the headers back and because
    // we are using the gateway, we need to transform them:
    const headers = new Headers();
    msg.headers.forEach((v, k) => {
      headers.append(`NatsH-${k}`, v);
    });
    await nc.publish(msg.reply, msg.data, { headers });
  } else {
    console.log("message doesn't have a reply - ignoring");
  }
}, { queue: "a" });

// to trigger a request:
const r = await nc.request("q", "question", {
  headers: {
    "NatsH-My-Header": "Hi",
  },
});
console.log(
  `got a response with payload "${r.string()}" which has ${
    r.data?.length || 0
  } bytes\n\t`,
  r.headers,
);

// now - it is also publish a request, that redirects to a different
// subscription - this is only used on advanced usages, but shows that
// you can delegate someone else to process your message.

await nc.publishWithReply("q", "hello", "question2", {
  headers: {
    "NatsH-My-Header": "Hi",
  },
});

await nc.flush();

sub.unsubscribe();
svc.unsubscribe();
