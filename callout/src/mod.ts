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

export type AuthorizerResponse = string;

export type UserInfo = {
  server: {
    name: string;
    host: string;
    id: string;
    cluster: string;
    ver: string;
    seq: number;
    jetstream: string;
    time: string;
  };
  data: {
    user: string;
    account: string;
    permissions: {
      publish: { deny: string[]; allow: string[] };
      subscribe: { deny: string[]; allow: string[] };
    };
  };
};

export { authorizationService } from "./service.ts";
