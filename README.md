<p align="center">
  <img src="orbit.png">
</p>

**Orbit.js** is an API toolkit and incubator for NATS functionality, providing
specialized utilities that extend the NATS JavaScript ecosystem. Each module
offers higher-level abstractions and productivity tools that, if proven popular
and stable, may eventually migrate to become first-class APIs in the core NATS
clients.

This toolkit serves as a proving ground for innovative messaging patterns and
advanced features, allowing developers to experiment with cutting-edge NATS
capabilities.

# Utilities

This is a list of the current utilities hosted here

| Module          | Description                                   | Docs                                   |
| --------------- | --------------------------------------------- | -------------------------------------- |
| NHGC            | A Javascript client for the NATS HTTP Gateway | [README.md](nhgc/README.md)            |
| MuxSub          | A NATS multiplexing subscription utility      | [README.md](muxsub/README.md)          |
| MessagePipeline | Middleware transformations for NATS messages  | [README.md](messagepipeline/README.md) |
| Counters        | JetStream-based atomic counter implementation | [README.md](counters/README.md)        |
