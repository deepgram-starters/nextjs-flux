# Next.js Flux

A first-class Next.js implementation of `node-flux`. The UI is implemented in Next.js; `server.js` hosts Next and the `/api/flux` WebSocket upgrade path required by the Flux contract. `flux-html` remains the behavioral reference and is intentionally not a second frontend submodule.

```sh
git submodule update --init --recursive
corepack pnpm install
cp sample.env .env
# Set DEEPGRAM_API_KEY in .env
corepack pnpm dev
```
