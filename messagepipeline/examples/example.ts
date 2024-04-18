import { Msg, MutableMsg, SyncPipeline } from "../mod.ts";
import { connect, Empty, headers } from "nats";

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

const nc = await connect({ servers: ["demo.nats.io"] });
const iter = nc.subscribe("hello");
(async () => {
  const pipeline = new SyncPipeline(valid, reverse);
  for await (const m of iter) {
    const r = pipeline.transform(m);
    if (r.isError) {
      // the error was already handled (but that really depends on the
      // implementation of the transformation handlers.
      m.respond("error");
    } else {
      nc.respondMessage(r.value);
    }
  }
})();
await nc.flush();

const nc2 = await connect({ servers: ["demo.nats.io"] });
let i = 0;
setInterval(() => {
  nc2.request("hello", `hello ${++i}`)
    .then((r) => {
      console.log(r.string());
    });
}, 1000);
