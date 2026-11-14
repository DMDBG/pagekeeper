#!/usr/bin/env bash
# Downloads the two open-source libraries Pagekeeper bundles (JSZip for EPUB/zip, pdf.js for PDF)
# and draws the app icons. The GitHub builds run this automatically.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p web/vendor
fetch() { curl -fsSL --retry 3 -o "web/vendor/$2" "$1"; echo "fetched $2"; }
fetch "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"          jszip.min.js
fetch "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"         pdf.min.js
fetch "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"  pdf.worker.min.js
node scripts/make-icon.js
