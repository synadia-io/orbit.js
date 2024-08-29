# AuthCallout

This library implements an Auth Callout Framework in JavaScript. AuthCallout
enables authentication and authorization to be delegated to a service. The
service examines credentials specified by a connection, and in turn issues the
credentials that the server will use or rejects the connection.

There are two components to this library:

- an `AuthorizationService`
- an `Authorizer`

The AuthorizationService is a NATS service that handles AuthCallout requests via
a customized `Authorizer`. The Authorizer is simply an interface (a function)
used for implementing the AuthCallout logic:

```typescript
authorize(
    req: jwt.AuthorizationRequest,
): Promise<Partial<jwt.AuthorizationResponse>>
```

The AuthorizationService handles all the boilerplate of unpacking the
`jwt.AuthorizationRequest` and verifying input for the Authorizer and the
packing of the `jwt.AuthorizationResponse` response sent to the server.

The authorizer processes authorization requests in the form of a decoded
`jwt.AuthorizationRequest` and returns a decoded `jwt.AuthorizationResponse.`

## Overview of Auth Callout

On connect, the server will process the connection options provided by the user.
These options may place the user into an _Authorization Account_ if the server
is configured using delegated authentication, or simply connect to the server.
If the user is not a _special_ user associated with a callout service, the
server packages the connection options and other information, generates a JWT
(`AuthorizationRequest`). If the callout configuration requires encryption, the
JWT is then encrypted. The request is then publishes a request to a callout
service on the subject `$SYS.REQ.USER.AUTH`.

The callout service then examines the decodes the request, decrypting if
necessary, and performs some checks like verifying that the server encryption
configuration matches the service configuration. If encrypted, the service will
also check that the request was sent by the expected server.

At this point the callout service can inspect the connection options (typically
looking at `auth_token`), and accessing any external system if necessary to
validate the user based on the collected information.

If the request succeeds, the callout service generates a NATS user JWT setting
the audience to the account name (when using conf), or properly generating a
user for the target account. The user id used (nkey) must match a
server-provided nkey. The service then generates a simple JSON document with a
`jwt` field that includes the generated JWT.

If there was an error the service generates a simple JSON document with an
`error` field that includes some textual information that the server may be able
to log - note that in some cases, such as mismatches between encryption result
in reject authentication due to bad parsing of the payload.

The JSON document then is embedded into the `jwt.AuthorizationResponse` jwt and
encrypted if necessary for the server that sent the request.

### The server configuration

The server's `auth_callout` configuration (part of the `authorization` block)
associates a user with a callout service. The callout service authenticates
normally.

Here's an example, of a server using a standard configuration:

```
# we define one or more account(s), the service can place users on this
# account - if no accounts are defined, the only account the service can
# place users in is the $G account (global account)
accounts: {
  "B": {},
},
authorization: {
  users: [{ user: "auth", password: "pwd" }],
  auth_callout: {
    # the authcallout service will issue JWTs using the private key
    # SAADBFQHO4ZIQ4ZR73NO73J7PF647YB43RHXWH3LEGKWE7K6J2TLLWMAUY
    # that maps to the public key below - the server uses this to verify
    # that the credentials are issued by what it expects.
    issuer: "ACZC2JADR7322VTXVEAQNC5CEFLOAGT3GQUFRZ7UZXMOCIXGFFN4QT2W",
    # this last relation maps auth users that are not forwarded to the
    # authcallout service
    auth_users: ["auth"],
  },
}
```

## The Callout Library

As you can tell from the above description, the process of unpacking and packing
the request and response is fairly involved boilerplate which adds additional
complexity as the service has and embedded JWT in the response JWT document, and
has to possibly encrypt and decrypt.

For purposes of this library, the `Authorizer` code only needs to focus on
inspecting an already decoded and verified `jwt.AuthorizationRequest`. Fields
available in the request such as `user`, `pass`, `auth_token`, even certs, can
be used to obtain some sort of context for the user that it is authorizing.

Here's an example of the `Authorizer`:

```typescript
// this is the private key we are going to use to generate responses
// (and users in this case).
const accountA: jwt.Key =
  "SAAGNWU5END33QMSWG3LGWDBQLHYGC4OBIC7KUDZXQIX7ZHUCAOG3XTO2U";
// parse the key
const akp = jwt.checkKey(accountA, "A", true);

class FirstAuthorizer implements Authorizer {
  async authorize(
    req: jwt.AuthorizationRequest,
  ): Promise<Partial<jwt.AuthorizationResponse>> {
    try {
      // inspect the request however necessary - in this case just a simple
      // test in the username/password
      if (req.connect_opts.user !== "b" || req.connect_opts.pass !== "hello") {
        return { error: "not allowed" };
      }
      // define some permissions/limits
      const user = jwt.defaultUser({
        pub: { allow: ["$SYS.REQ.USER.INFO"] },
        sub: { allow: ["q", "_INBOX.>"] },
        resp: { max: 1 },
      });
      // generate the user JWT
      const token = await jwt.encodeUser(
        // if the client provided a name for the connection we use it
        req.client_info.user || "U",
        // use the server assigned nkey for the connecting user
        req.user_nkey,
        // this is the private key from the account
        akp,
        user,
        // User is placed into account `B`, because the `aud` or audience
        // for the authorization is account `B` - this is in conf only
        // to place into the $G account, simply specify `$G` instead of `B`
        { aud: "B" },
      );
      // the authorizer finally returns the JWT
      return { jwt: token };
    } catch (err) {
      // or an error if it fails or wants to reject
      return { error: `failed: ${err.message}` };
    }
  }
}
```

The result of the `authorizer` function is an `jwt.AuthorizationResponse`. The
service will take care of taking this input and generating the JWT and possibly
encrypting it if necessary.

As for the service to actually run the authorizer, all we need is a connection,
the `Authorizer` we defined above, and the `Key` that the service will use to
sign the responses.

```typescript
const nc = await connect({
  user: "auth",
  pass: "pwd",
});

// run the service (this is a standard NATS service, so you
// can monitor it, etc).
await authorizationService(nc, new FirstAuthorizer(), akp);
```
