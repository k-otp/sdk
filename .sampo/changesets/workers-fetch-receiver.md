---
npm/@k-otp/sdk: patch
---

Fix default HTTP requests failing with `TypeError: Illegal invocation` on Cloudflare Workers by preserving the global receiver of native `fetch`. Core and server clients retain lazy fetch resolution, and custom fetch implementations are used unchanged. The Kiota client also uses Workers-compatible manual redirect handling while continuing to reject redirects without following them.
