/*
 * Copyright 2025 Synadia Communications, Inc
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

import type { ConnectionOptions } from "@nats-io/nats-core";

type ConnectionProperty = Omit<
  keyof ConnectionOptions & { creds: string },
  "authenticator" | "reconnectDelayHandler"
>;

const booleanProps = [
  "debug",
  "ignoreAuthErrorAbort",
  "ignoreClusterUpdates",
  "noAsyncTraces",
  "noEcho",
  "noRandomize",
  "pedantic",
  "reconnect",
  "resolve",
  "verbose",
  "waitOnFirstConnect",
  "handshakeFirst",
] as const;

const numberProps = [
  "maxPingOut",
  "maxReconnectAttempts",
  "pingInterval",
  "reconnectJitter",
  "reconnectJitterTLS",
  "reconnectTimeWait",
  "timeout",
] as const;

const stringProps = [
  "name",
  "inboxPrefix",
] as const;
const arrayProps = ["servers"] as const;

const tlsBooleanProps = [
  "handshakeFirst",
];

const tlsStringProps = [
  "cert",
  "certFile",
  "ca",
  "caFile",
  "key",
  "keyFile",
];

function encodeStringPropsFn(src: Record<string, unknown>, target: URL) {
  return (n: string) => {
    const v = src[n] as string | undefined;
    if (v) {
      target.searchParams.append(n, encodeURIComponent(v));
    }
  };
}

function encodeBooleanPropsFn(src: Record<string, unknown>, target: URL) {
  return (n: string) => {
    const v = src[n] as boolean | undefined;
    if (typeof v === "boolean") {
      target.searchParams.append(n, v ? "true" : "false");
    }
  };
}

function encodeNumberPropsFn(src: Record<string, unknown>, target: URL) {
  return (n: string) => {
    const v = src[n] as number | undefined;
    if (typeof v === "number") {
      target.searchParams.append(n, v.toString());
    }
  };
}

export function encode(opts: Partial<ConnectionOptions>): string {
  opts = opts || {};
  opts = Object.assign({}, opts);

  if (typeof opts?.servers === "string") {
    opts.servers = [opts.servers];
  }
  let u: URL;
  if (opts?.servers?.length) {
    if (
      opts.servers[0].startsWith("nats://") ||
      opts.servers[0].startsWith("wss://") ||
      opts.servers[0].startsWith("ws://")
    ) {
      u = new URL(opts.servers[0]);
    } else {
      u = new URL(`nats://${opts.servers[0]}`);
    }
    // remove this server from the list as it is part of the URL
    opts.servers = opts.servers.slice(1);
  } else {
    u = new URL("nats://127.0.0.1:4222");
  }
  if (opts.port) {
    u.port = `${opts.port}`;
  }

  if (opts.user) {
    u.username = opts.user;
  }
  if (opts.pass) {
    u.password = opts.pass;
  }
  if (opts.token) {
    u.username = opts.token;
  }

  arrayProps.forEach((n) => {
    let v = opts[n] as string[] | string;
    if (!Array.isArray(v)) {
      v = [v];
    }
    if (v) {
      v.forEach((s) => {
        u.searchParams.append(n, encodeURIComponent(s));
      });
    }
  });

  stringProps.forEach(encodeStringPropsFn(opts, u));
  numberProps.forEach(encodeNumberPropsFn(opts, u));
  booleanProps.forEach(encodeBooleanPropsFn(opts, u));

  if (opts.tls) {
    if (u.protocol !== "nats:") {
      throw new Error("tls options can only be used with nats:// urls");
    }
    u.protocol = opts.tls.handshakeFirst ? "natss:" : "tls:";
    tlsStringProps.forEach(
      encodeStringPropsFn(opts.tls as Record<string, unknown>, u),
    );
  }

  return u.toString();
}

type Values = boolean | number | string | string[];
type Obj = Record<string, Values>;
type Config = Record<string, Values | Obj>;

function configBooleanFn(u: URL, target: Config) {
  return (n: string) => {
    const v = u?.searchParams.get(n) || null;
    if (v !== null) {
      target[n] = v === "true";
    }
  };
}

function configNumberFn(u: URL, target: Config) {
  return (
    n: string,
  ) => {
    const v = u?.searchParams.get(n) || null;
    if (v !== null) {
      target[n] = parseInt(v);
    }
  };
}

function configStringFn(u: URL, target: Config) {
  return (n: string) => {
    const v = u?.searchParams.get(n);
    if (v) {
      target[n] = decodeURIComponent(v);
    }
  };
}

function configStringArrayFn(u: URL, target: Config) {
  return (n: string) => {
    let a = u?.searchParams.getAll(n);
    a = a?.map((s) => decodeURIComponent(s));
    if (!target[n]) {
      target[n] = a;
    } else {
      const aa = target[n] as string[];
      aa.push(...a);
      target[n] = aa;
    }
  };
}

export function parse(
  str = "",
): Promise<Partial<ConnectionOptions>> {
  if (str === "") {
    return Promise.resolve({ servers: "127.0.0.1:4222" });
  }

  const u = URL.parse(str);
  if (u === null) {
    return Promise.reject(new Error(`failed to parse '${str}'`));
  }

  const opts: ConnectionOptions = {};
  const r = opts as Record<string, Values>;
  if (u.protocol === "natss:") {
    opts.tls = { handshakeFirst: true };
    r.servers = [u.host];
  } else if (u.protocol !== "nats:") {
    const protocol = u.protocol;
    const host = u.host;
    let s = `${protocol}//${host}`;
    if (u.pathname && u.pathname !== "/") {
      s += u.pathname;
    }
    r.servers = [s];
  } else {
    r.servers = [u.host];
  }

  if (u.username) {
    if (u.password === undefined || u.password === "") {
      opts.token = u.username;
    } else {
      opts.user = u.username;
    }
  }
  if (u.password) {
    opts.pass = u.password;
  }
  if (u.protocol === "natss") {
    opts.tls = { handshakeFirst: true };
  }

  booleanProps.forEach(configBooleanFn(u, r));
  stringProps.forEach(configStringFn(u, r));
  numberProps.forEach(configNumberFn(u, r));
  arrayProps.forEach(configStringArrayFn(u, r));

  const tls: Obj = opts.tls as Obj || {};
  tlsBooleanProps.forEach(configBooleanFn(u, tls));
  tlsStringProps.forEach(configStringFn(u, tls));
  if (Object.keys(tls).length > 0) {
    opts.tls = tls;
  }

  return Promise.resolve(opts);
}
