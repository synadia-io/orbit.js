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
  connect,
  ConnectionOptions,
  credsAuthenticator,
  NatsConnection,
} from "@nats-io/transport-deno";
import * as jwt from "@nats-io/jwt";

export const operator: jwt.Key =
  "SOAPXH4XXMKP7QXBTZBDILJLHWYUCTV6IGFNMYGBX2QTC4WFSWI6VDT6VQ";
export const SYS: jwt.Key =
  "SAAAT3MCGKCBKNISEFKEMBTLXCYCHSKCXGZMBYHCJMOEVWQR7SQ74LYCCQ";
export const targetAccount: jwt.Key =
  "SAAGNWU5END33QMSWG3LGWDBQLHYGC4OBIC7KUDZXQIX7ZHUCAOG3XTO2U";
export const authAccount: jwt.Key =
  "SAAN5THFDPFRZA47Q3S3AGKIDA5ZBR2JZP6HWVJ4YYI7DXVW2OQN5IKRZM";
export const authUser: jwt.Key =
  "SUAEUUEEU2MBHZ55Z2W7XA2VHWMB6FEIOYYTMHAHEN5BQLODPSGA3QCTZM";

export const limits = {
  conn: -1,
  data: -1,
  payload: -1,
  subs: -1,
};

export class SysClient {
  nc: NatsConnection;

  constructor(nc: NatsConnection) {
    this.nc = nc;
  }

  async getAccount(
    account: jwt.Key,
  ): Promise<jwt.ClaimsData<jwt.Account>> {
    const k = jwt.checkKey(account, "A");
    const r = await this.nc.request(
      `$SYS.REQ.ACCOUNT.${k.getPublicKey()}.CLAIMS.LOOKUP`,
    );
    return jwt.decode<jwt.Account>(r.string());
  }

  async updateAccount(
    token: string,
  ): Promise<void> {
    const a = jwt.decode<jwt.Account>(token);
    const r = await this.nc.request(
      `$SYS.REQ.ACCOUNT.${a.sub}.CLAIMS.UPDATE`,
      token,
    );
    const d = r.json<{ data: { code: number } }>();
    if (d.data.code !== 200) {
      console.log(d);
      return Promise.reject(new Error(`error updating account: ${d}`));
    }
    return Promise.resolve();
  }
}

export async function generateAccount(
  name: string,
  id: jwt.Key,
  config: Partial<jwt.Account> = {},
): Promise<string> {
  const okp = jwt.checkKey(operator, "O", true);
  const kp = jwt.checkKey(id, "A", true);
  const a = Object.assign({}, { limits }, config);
  return await jwt.encodeAccount(name, kp, a, { signer: okp });
}

export async function addAccount(
  preload: Record<string, string>,
  name: string,
  id: jwt.Key,
  config: Partial<jwt.Account> = {},
): Promise<void> {
  const kp = jwt.checkKey(id, "A", true);
  const token = await generateAccount(name, id, config);
  const pk = kp.getPublicKey();
  preload[pk] = token;
}

export async function updateAccount(
  nc: NatsConnection,
  name: string,
  account: jwt.Key,
  config: Partial<jwt.Account>,
): Promise<void> {
  const token = await generateAccount(name, account, config);
  const kp = jwt.checkKey(account, "A", true);
  const r = await nc.request(
    `$SYS.REQ.ACCOUNT.${kp.getPublicKey()}.CLAIMS.UPDATE`,
    token,
  );
  const d = r.json<{ data: { code: number } }>();
  if (d.data.code !== 200) {
    console.log("error updating account: ", d);
    return Promise.reject("failed");
  }
  return Promise.resolve();
}

export async function getAccount(
  nc: NatsConnection,
  account: jwt.Key,
): Promise<jwt.ClaimsData<jwt.Account>> {
  const k = jwt.checkKey(account, "A");

  const r = await nc.request(
    `$SYS.REQ.ACCOUNT.${k.getPublicKey()}.CLAIMS.LOOKUP`,
  );
  return jwt.decode<jwt.Account>(r.string());
}

export async function connectUser(
  port: number,
  name: string,
  user: jwt.Key,
  account: jwt.Key,
  config: Partial<jwt.User> = {},
  opts: ConnectionOptions = {},
): Promise<NatsConnection> {
  const jwtTok = await jwt.encodeUser(
    name,
    user,
    account,
    Object.assign(jwt.defaultUser(), config),
  );
  const creds = jwt.fmtCreds(jwtTok, jwt.checkKey(user, "U", true));
  const authenticator = credsAuthenticator(creds);
  const co = Object.assign({ port, authenticator }, opts);
  return connect(co);
}

export async function connectAuth(
  port: number,
  name: string,
  account: jwt.Key,
  opts?: ConnectionOptions,
): Promise<[NatsConnection, jwt.KeyPair]> {
  const ukp = jwt.createUser();
  const nc = await connectUser(
    port,
    name,
    ukp,
    account,
    jwt.defaultUser({
      bearer_token: true,
      pub: { deny: [">"] },
      sub: { deny: [">"] },
    }),
    opts,
  );
  return [nc, ukp];
}
