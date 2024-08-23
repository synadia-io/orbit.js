# AuthCallout

This library implements a simple Auth Callout Framework in JavaScript.
AuthCallout enables authentication and authorization to be delegated to a
service. The service examines credentials specified by a connection, and in turn
issues the credentials that the server will use or rejects the connection.

There are two components to this library:

- an Authorizer
- an AuthorizationService

The Authorizer is a simple interface used for implementing an AuthCallout.

```typescript
authorize(
  req: jwt.AuthorizationRequest,
): Promise<Partial<jwt.AuthorizationResponse>>;
```

The authorizer receives authorization requests in the form of a
`jwt.AuthorizationRequest` and returns a `jwt.AuthorizationResponse.`

The AuthorizationService handles all the boilerplate of unpacking the input to
the Authorizer and the packing of the response sent to the server.
