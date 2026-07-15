#!/usr/bin/env bash
# Local static server with COOP/COEP (needed for pthread SharedArrayBuffer).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/www"
PORT="${PORT:-8080}"

python3 - <<'PY' "$PORT"
import http.server, socketserver, sys

PORT = int(sys.argv[1])

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **getattr(http.server.SimpleHTTPRequestHandler, "extensions_map", {}),
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving www/ on http://localhost:{PORT}/ (COOP/COEP enabled)")
    httpd.serve_forever()
PY
