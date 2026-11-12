#!/usr/bin/env python3
"""临时验证结果收集器（仅用于本次验证，验证完即删除）。"""
import http.server
import json
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
OUT = sys.argv[2] if len(sys.argv) > 2 else "_result.txt"
RESULT = {"done": False, "text": ""}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        if self.path.startswith("/result"):
            self._send(200, RESULT["text"].encode("utf-8"))
        elif self.path.startswith("/done"):
            self._send(200, b"1" if RESULT["done"] else b"0")
        else:
            self._send(404, b"nope")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n).decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"text": raw}
        RESULT["text"] = payload.get("text", raw)
        RESULT["done"] = True
        with open(OUT, "w", encoding="utf-8") as f:
            f.write(RESULT["text"])
        self._send(200, b"ok")

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"[collector] listening on {PORT}, writing to {OUT}", flush=True)
        httpd.serve_forever()
