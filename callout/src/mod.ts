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
import { NatsConnection, NatsError, StringCodec } from "@nats-io/nats-core";
import type { Codec, MsgHdrs } from "@nats-io/nats-core";
import { Service, ServiceError, ServiceMsg, Svc } from "@nats-io/services";
import { KeyPair } from "@nats-io/nkeys";

export interface Authorizer {
  /**
   * authorize is the basis of an authorization service. It processes a
   * jwt.AuthorizationRequest however convenient, and then returns a
   * jwt.AuthorizationResponse. A generic service is responsible for
   * subscribing to `$SYS.REQ.USER.AUTH` and gathering the request information
   * and then calling this API. The response is then sent back to the server,
   * thus authorizing or rejecting the connection request.
   *
   * The Authorizer issues user JWTs that are targeted for the account
   * the user is placed in.
   *
   * @param req
   */
  authorize(
    req: jwt.AuthorizationRequest,
  ): Promise<Partial<jwt.AuthorizationResponse>>;
}

const NatsServerXkeyHeader = "Nats-Server-Xkey";
const ExpectedAudience = "nats-authorization-request";

/**
 * Creates a NATS service that processes authorization requests.
 *
 * @param {NatsConnection} nc - The NATS connection object.
 * @param {Authorizer} authorizer - The authorizer object.
 * @param {jwt.Key} authorizationResponseSigner - The key used to sign users
 * @param {KeyPair} [encryptionKey] - The key used to encrypt authorization traffic (encryption required if set)
 * @return {Promise<Service>} - A promise to the service
 */
export async function authorizationService(
  nc: NatsConnection,
  authorizer: Authorizer,
  authorizationResponseSigner: jwt.Key,
  encryptionKey?: KeyPair,
): Promise<Service> {
  const tc = new TokenCallout(
    authorizer,
    authorizationResponseSigner,
    encryptionKey,
  );

  const f = new Svc(nc);
  const svc = await f.add({ name: "auth", version: "0.0.1" });
  svc.stopped
    .then(() => {
      console.log("authorization service stopped");
    })
    .catch((err: Error) => {
      console.log("authorization service stopped", err);
    });

  const user = svc.addGroup("$SYS.REQ.USER");
  user.addEndpoint("AUTH", (err: NatsError | null, m: ServiceMsg) => {
    if (err) {
      console.log("handler err", err);
      svc.stop(err);
      return;
    }
    tc.process(m.data, m.headers).then((r: Uint8Array) => {
      m.respond(r);
    }).catch((err) => {
      const { code, message } = err instanceof ServiceError
        ? err
        : { code: 400, message: err.message };
      m.respondError(code, "error processing request", message);
    });
  });
  return svc;
}

export class TokenCallout {
  authorizer: Authorizer;
  authorizationResponseSigner: jwt.KeyPair;
  encryptionKey?: KeyPair;
  sc: Codec<string>;

  constructor(
    authorizer: Authorizer,
    authAccountKey: jwt.Key,
    encryptionKey?: KeyPair,
  ) {
    if (!authorizer) {
      throw new Error("authorizer is required");
    }
    this.authorizationResponseSigner = jwt.checkKey(
      authAccountKey,
      ["A"],
      true,
    );
    if (encryptionKey) {
      this.encryptionKey = jwt.checkKey(encryptionKey, ["X"], true);
    }
    this.authorizer = authorizer;
    this.sc = StringCodec();
  }

  async process(
    data: Uint8Array,
    requestHeaders?: MsgHdrs,
  ): Promise<Uint8Array> {
    let serverKey = "";

    let isEncrypted = false;
    if (data.length > 4) {
      const s = this.sc.decode(data.subarray(0, 4));
      // NATS jwts will start with eyJ0
      isEncrypted = s !== "eyJ0";
    }
    // check for misconfigurations
    if (this.encryptionKey && !isEncrypted) {
      return Promise.reject(
        new Error(
          "configuration mismatch - service requires encryption but server doesn't",
        ),
      );
    }
    if (!this.encryptionKey && isEncrypted) {
      return Promise.reject(
        new Error(
          "configuration mismatch - service does not require encryption but server does",
        ),
      );
    }

    if (this.encryptionKey) {
      serverKey = requestHeaders?.get(NatsServerXkeyHeader) || "";
      const dd = this.encryptionKey.open(data, serverKey);
      if (dd === null) {
        return Promise.reject(new Error("failed to decrypt message"));
      }
      data = dd;
    }

    // decode the request and perform some sanity checks
    const req = await this.decode(this.sc.decode(data));
    if (this.encryptionKey && req.server_id.xkey !== serverKey) {
      return Promise.reject(
        new Error("server key in request didn't match server key in headers"),
      );
    }

    const cr = await this.authorizer.authorize(req);
    if (cr.error) {
      // show the error
      console.log(cr.error);
    }
    const r = await jwt.encodeAuthorizationResponse(
      req.user_nkey,
      req.server_id.id,
      this.authorizationResponseSigner,
      cr,
      {},
    );

    if (this.encryptionKey) {
      const rd = this.sc.encode(r);
      return this.encryptionKey.seal(rd, serverKey);
    }
    return this.sc.encode(r);
  }

  decode(data: string): Promise<jwt.AuthorizationRequest> {
    try {
      const token: jwt.ClaimsData<jwt.AuthorizationRequest> = jwt.decode<
        jwt.AuthorizationRequest
      >(data);
      if (token.aud !== ExpectedAudience) {
        return Promise.reject(new ServiceError(500, "bad request"));
      }

      const ar = token.nats as jwt.AuthorizationRequest;
      if (!ar) {
        return Promise.reject(new ServiceError(500, "bad request"));
      }
      // check the server id is a valid nkey
      jwt.checkKey(ar.server_id.id, ["N"]);

      return Promise.resolve(ar);
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
