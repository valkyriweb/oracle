set -euo pipefail
mkdir -p /tmp/depsec-node /tmp/depsec-pnpm
curl -fsSL https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.gz -o /tmp/depsec-node.tar.gz
curl -fsSL https://nodejs.org/dist/v24.11.1/SHASUMS256.txt | grep ' node-v24.11.1-linux-x64.tar.gz$' | sed 's@node-v24.11.1-linux-x64.tar.gz@/tmp/depsec-node.tar.gz@' | sha256sum -c -
tar -xzf /tmp/depsec-node.tar.gz -C /tmp/depsec-node --strip-components=1
export PATH=/tmp/depsec-node/bin:/tmp/depsec-pnpm/node_modules/.bin:$PATH
export CI=true DO_NOT_TRACK=1
npm install --prefix /tmp/depsec-pnpm --no-audit --no-fund pnpm@11.28.2
node --version
pnpm --version
trap 'cp /tmp/oracle-audit-after.json burn-proof/audit-after.json 2>/dev/null || true; tar -czf burn-proof/result.tar.gz package.json pnpm-lock.yaml pnpm-workspace.yaml burn-proof/*.json 2>/dev/null || true' EXIT
pnpm update zod undici body-parser qs ip-address puppeteer-core --depth Infinity
pnpm audit --json > /tmp/oracle-audit-after.json || test "$?" -eq 1
node --input-type=module -e 'import fs from "node:fs";const a=JSON.parse(fs.readFileSync("/tmp/oracle-audit-after.json"));console.log(a.metadata.vulnerabilities);if(a.metadata.vulnerabilities.high || a.metadata.vulnerabilities.critical)process.exit(1)'
pnpm run check
pnpm run docs:check
pnpm run docs:site
pnpm run test --maxWorkers=2
pnpm run build
node scripts/provider-native-capture-proof.mjs
node scripts/browser-connection-proof.mjs
pnpm run test:packed-cli
