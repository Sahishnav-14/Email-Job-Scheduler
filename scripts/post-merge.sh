set -euo pipefail

npm install --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
