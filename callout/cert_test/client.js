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

import { connect } from "@nats-io/transport-node";

// process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const nc = await connect({
  servers: "localhost",
  tls: {
    certFile: "./certs/client-id-auth-cert.pem",
    keyFile: "./certs/client-id-auth-key.pem",
    caFile: "./certs/ca.pem",
    handshakeFirst: true,
  },
});

console.log("here");
