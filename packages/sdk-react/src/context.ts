import {
  createOtpClient,
  type OtpClient,
  type OtpClientOptions,
} from "@k-otp/sdk-core";
import type { OtpIssueVerifyClient } from "@k-otp/sdk-core/headless";
import {
  type Context,
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react";

/** Any client with `issue`/`verify` (an `OtpClient` from `createOtpClient`). */
export type OtpClientLike = OtpIssueVerifyClient;

const OtpClientContext: Context<OtpClientLike | null> =
  createContext<OtpClientLike | null>(null);
OtpClientContext.displayName = "OtpClientContext";

export type OtpProviderProps = {
  children?: ReactNode;
} & (
  | {
      /** A client you created (e.g. with `createOtpClient`). */
      client: OtpClientLike;
      options?: undefined;
    }
  | {
      /**
       * Options for `createOtpClient`. Read once on the first render; pass a
       * `client` instead to control its lifetime.
       */
      options: OtpClientOptions;
      client?: undefined;
    }
);

/**
 * Makes an OTP client available to `useOtpClient`, `useOtpIssue`,
 * `useOtpVerify` and `useOtpFlow`. Creating the client performs no I/O, so
 * the provider is safe to render on the server.
 */
export const OtpProvider = (props: OtpProviderProps): ReactElement => {
  const [owned] = useState<OtpClient | null>(() =>
    props.client ? null : createOtpClient(props.options),
  );
  const client = props.client ?? owned;
  return createElement(
    OtpClientContext.Provider,
    { value: client },
    props.children,
  );
};

/**
 * Returns the client from the nearest `OtpProvider` (or `client` when given).
 * Throws a `TypeError` when there is neither.
 */
export const useOtpClient = (client?: OtpClientLike): OtpClientLike => {
  const fromContext = useContext(OtpClientContext);
  const resolved = client ?? fromContext;
  if (!resolved) {
    throw new TypeError(
      "No K-OTP client found. Wrap your components in <OtpProvider> or pass `client` to the hook.",
    );
  }
  return resolved;
};
