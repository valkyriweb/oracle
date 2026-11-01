set -euo pipefail
export PATH=/tmp/depsec-node/bin:/tmp/depsec-pnpm-oracle/node_modules/.bin:$PATH
export CI=true DO_NOT_TRACK=1
npm install --prefix /tmp/depsec-pnpm-oracle --no-audit --no-fund pnpm@11.28.2
pnpm install --frozen-lockfile
pnpm audit --json > /tmp/oracle-audit-final.json || test "$?" -eq 1
pnpm run check
pnpm run docs:check
pnpm run docs:site
pnpm run test --maxWorkers=2
node scripts/provider-native-capture-proof.mjs
node scripts/browser-connection-proof.mjs
pnpm run test:packed-cli
