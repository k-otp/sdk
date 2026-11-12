using Workerd = import "/workerd/workerd.capnp";

const tests :Workerd.Config = (
  services = [
    (name = "sdk-legacy", worker = (
      modules = [(name = "worker.mjs", esModule = embed "worker.mjs")],
      compatibilityDate = "2026-02-12",
      compatibilityFlags = ["nodejs_compat"],
      globalOutbound = "mock-api"
    )),
    (name = "sdk", worker = (
      modules = [(name = "worker.mjs", esModule = embed "worker.mjs")],
      # Keep the compatibility date that reproduces the receiver regression.
      compatibilityDate = "2026-08-04",
      globalOutbound = "mock-api"
    )),
    (name = "mock-api", worker = (
      modules = [(name = "mock-api.mjs", esModule = embed "mock-api.mjs")],
      compatibilityDate = "2026-08-04"
    )),
    # All SDK requests stay inside workerd. External networking is disabled.
    (name = "internet", network = (allow = []))
  ]
);
