const serverOnly = (): never => {
  throw new TypeError("@k-otp/sdk/kiota requires a server environment");
};
export class KotpApiError extends Error {
  constructor() {
    super();
    serverOnly();
  }
}
export class KotpTransportError extends Error {
  constructor() {
    super();
    serverOnly();
  }
}
export class KotpClient {
  constructor() {
    serverOnly();
  }
  issue(): never {
    return serverOnly();
  }
  verify(): never {
    return serverOnly();
  }
  status(): never {
    return serverOnly();
  }
  issues(): never {
    return serverOnly();
  }
  issueDetail(): never {
    return serverOnly();
  }
  creditLedger(): never {
    return serverOnly();
  }
  balance(): never {
    return serverOnly();
  }
  templates(): never {
    return serverOnly();
  }
  templateDetail(): never {
    return serverOnly();
  }
}
