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

import * as jwt from "@nats-io/jwt";
import { connect } from "@nats-io/transport-node";
import { authorizationService } from "../lib/mod.js";
import * as x509 from "@peculiar/x509";

const akp = jwt.checkKey(
  "SAAGNWU5END33QMSWG3LGWDBQLHYGC4OBIC7KUDZXQIX7ZHUCAOG3XTO2U",
  "A",
  true,
);

const nc = await connect({
  user: "auth",
  pass: "pwd",
  tls: {
    certFile: "./certs/client-cert.pem",
    keyFile: "./certs/client-key.pem",
    caFile: "./certs/ca.pem",
    handshakeFirst: true,
  },
});

console.log("connected");

function describeCert(s) {
  const cc = new x509.X509Certificate(s);
  console.log({
    issuer: cc.issuer,
    subject: cc.subject,
    subjectAltName: cc.subjectAltName,
  });
}

// Here's an example of the Authorizer, it simply crafts a JWT.
class CertAuthorizer {
  async authorize(
    req,
  ) {
    try {
      if (!req.client_tls) {
        throw new Error("expected client TLS configuration");
      }
      if (
        !Array.isArray(req.client_tls.verified_chains) &&
        !Array.isArray(req.client_tls.certs)
      ) {
        throw new Error("expected client certs or verified chains");
      }
      req.client_tls.certs?.forEach((s) => {
        describeCert(s);
      });

      req.client_tls.verified_chains?.forEach((a) => {
        a.forEach((s) => {
          describeCert(s);
        });
      });

      const user = jwt.defaultUser({
        pub: { allow: ["$SYS.REQ.USER.INFO"] },
        sub: { allow: ["q", "_INBOX.>"] },
        resp: { max: 1 },
      });
      const token = await jwt.encodeUser(
        req.client_info.user || "U",
        req.user_nkey,
        akp,
        user,
        // User is placed into account `B`, because the `aud` or audience
        // for the authorization is account `B` - this is in conf only
        // to place into the $G account, simply specify that instead of `B`
        { aud: "B" },
      );
      // the authorizer is simply returning a struct with the jwt is successful
      return { jwt: token };
    } catch (err) {
      // or an error if it fails or wants to reject
      return { error: `failed: ${err.message}` };
    }
  }
}

// This is the authorizationService - which is effectively boilerplate for
// handling requests to `$SYS.REQ.USER.AUTH` - the service will decode the request,
// perform some simple checks, and use the authorizer to create the JWTs,
// it will then package the returned response from the authorizer into
// a JWT which is signed with the account key (in case of conf, same signer)
// and return it to the NATS server
const service = await authorizationService(nc, new CertAuthorizer(), akp);
