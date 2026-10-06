# Kiota PoC fixtures

The root security rules apply. These independent test packages are unpublished
fixtures, outside the Bun/Sampo release workspace. They may use standard native
language tools and real public Kiota runtimes. JS/TS uses Bun and ttsc.

- Use only the vendored public `spec/openapi.json` and artificial fixture data.
- Requests must reach a loopback mock or an explicitly guarded mock transport.
  Never send requests to the production base URL from generated clients.
- Keep generated sources, installed dependencies, packages and logs under
  `.cache/kiota-poc`; never edit generated sources or commit them.
- Keep raw and transformed input results separate. A successful generation is
  not evidence of compilation, wire compatibility, or package usability.
- Preserve failed stages in result JSON. Missing evidence is not success.
- Do not publish packages, bump SDK versions, or change release workflows.
