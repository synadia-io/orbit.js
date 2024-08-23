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

import {
  JSONCodec,
  NatsConnection,
  NatsError,
  StringCodec,
} from "@nats-io/nats-core";
import type { Codec } from "@nats-io/nats-core";
import { Authorizer, AuthorizerResponse, UserInfo } from "./mod.ts";
import { Service, ServiceError, ServiceMsg, Svc } from "@nats-io/services";
import * as jwt from "@nats-io/jwt";

export async function authorizationService(
  nc: NatsConnection,
  authorizer: Authorizer,
  authAccountKey: jwt.Key,
): Promise<Service> {
  const r = await nc.request(`$SYS.REQ.USER.INFO`);
  const ui = r.json<UserInfo>();

  const tc = new TokenCallout(
    ui,
    authorizer,
    authAccountKey,
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
    tc.process(m.data).then((r: AuthorizerResponse) => {
      m.respond(r);
    }).catch((err) => {
      const { code, message } = err instanceof ServiceError
        ? err
        : { code: 400, message: err.message };
      m.respondError(code, message);
    });
  });
  return svc;
}

export class TokenCallout {
  context: UserInfo;
  authorizer: Authorizer;
  authAccountKey: jwt.KeyPair;
  authAccountPK: string;
  base64: jwt.Base64UrlCodec;
  sc: Codec<string>;
  jc: Codec<unknown>;

  constructor(
    context: UserInfo,
    authorizer: Authorizer,
    authAccountKey: jwt.Key,
  ) {
    this.context = context;
    if (!authorizer) {
      throw new Error("authorizer is required");
    }
    this.authAccountKey = jwt.checkKey(authAccountKey, ["A"], true);
    this.authAccountPK = this.authAccountKey.getPublicKey();
    this.authorizer = authorizer;
    this.sc = StringCodec();
    this.jc = JSONCodec();
    this.base64 = new jwt.Base64UrlCodec();
  }

  async process(
    data: Uint8Array,
  ): Promise<AuthorizerResponse> {
    // decode the request and perform some sanity checks
    const req = await this.decode(data);
    // console.log(req);
    const cr = await this.authorizer.authorize(req);
    if (cr.error) {
      console.log(cr.error);
    }
    return jwt.encodeAuthorizationResponse(
      req.user_nkey,
      req.server_id.id,
      this.authAccountKey,
      cr,
      {},
    );
  }

  decode(data: Uint8Array): Promise<jwt.AuthorizationRequest> {
    try {
      const token: jwt.ClaimsData<jwt.AuthorizationRequest> = jwt.decode<
        jwt.AuthorizationRequest
      >(
        this.sc.decode(data),
      );
      if (token.aud !== "nats-authorization-request") {
        console.log("bad audience");
        return Promise.reject(new ServiceError(500, "bad request"));
      }

      const ar = token.nats as jwt.AuthorizationRequest;
      if (!ar) {
        console.log("missing auth request");
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
