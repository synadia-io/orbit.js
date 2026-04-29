# fastingest

Re-export of the JetStream fast-ingest batch publish API from
`@nats-io/jetstream`. Provides `startFastIngest()` and related types as a stable
orbit surface while the API remains in the jetstream module's internal export.

Fast-ingest trades atomicity for throughput: messages may be dropped, and the
server reports gaps via `FastIngestProgress`. Requires NATS server 2.14.0+ and a
stream created with `allow_batched: true`.

## Install

```bash
npm install @synadiaorbit/fastingest
```

```bash
deno add jsr:@synadiaorbit/fastingest
```

## Usage

```ts
import { wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import { startFastIngest } from "@synadiaorbit/fastingest";

const nc = await wsconnect({ servers: "wss://demo.nats.io:8443" });

const jsm = await jetstreamManager(nc);
await jsm.streams.add({
  name: "batch",
  subjects: ["q"],
  allow_batched: true,
});

const fi = await startFastIngest(nc, "q", "1", {
  allowGaps: false,
  ackInterval: 5,
});
await fi.add("q", "2");
await fi.add("q", "3");
const ack = await fi.last("q", "4");
console.log(ack.count, ack.seq);

await nc.close();
```

See `@nats-io/jetstream` source for `FastIngest`, `FastIngestOptions`, and
`FastIngestProgress` shapes.
