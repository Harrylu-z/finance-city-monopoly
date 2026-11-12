#!/usr/bin/env python3
"""本地静态服务器 —— 零依赖。

用法:
    python serve.py            # 默认 http://127.0.0.1:8000
    python serve.py 8080       # 指定端口
    python serve.py 8080 --no-browser

设计要点:
  * 显式 MIME 类型，确保 ES Module (.js) 以 text/javascript 正常加载。
  * 双栈监听（IPv4 + IPv6），避免浏览器访问 localhost 时先尝试 IPv6
    失败、等待 ~2s TCP 超时再回退 IPv4 的卡顿。
  * 多线程处理，避免并发请求互相阻塞。
"""
import http.server
import os
import socket
import sys
import threading
import webbrowser

DEFAULT_PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    """静态文件处理器 —— 显式声明 MIME 类型，确保 ES Module 正常加载。"""

    EXTENSIONS = {
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".ico": "image/x-icon",
        ".webmanifest": "application/manifest+json",
        ".woff2": "font/woff2",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in self.EXTENSIONS:
            return self.EXTENSIONS[ext]
        return super().guess_type(path)

    def end_headers(self):
        # 纯静态站：开发期禁用缓存；部署到 CDN 后不依赖此设置
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] " + (fmt % args) + "\n")


class ThreadedServer(http.server.ThreadingHTTPServer):
    """多线程服务器 —— 避免并发请求互相阻塞。"""

    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        # 允许在同一个端口上同时绑定 IPv4 与 IPv6（双栈）
        if self.address_family == socket.AF_INET6 and hasattr(socket, "IPV6_V6ONLY"):
            try:
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            except OSError:
                pass
        super().server_bind()


class DualStackServer(ThreadedServer):
    """双栈服务器 —— 同时接受 IPv6 与 IPv4(映射) 连接。

    浏览器的 'localhost' 会先尝试 IPv6（::1）；若服务端只监听 IPv4，
    浏览器需要等约 2 秒 TCP 超时才会回退 IPv4，导致首屏极慢。
    """

    address_family = socket.AF_INET6


def _pick_port(requested):
    """端口被占用时自动向后找一个可用端口。"""
    for offset in range(0, 20):
        port = requested + offset
        if _port_free(port):
            return port
    return requested


def _port_free(port):
    for family, addr in ((socket.AF_INET6, ("::", port)), (socket.AF_INET, ("0.0.0.0", port))):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as s:
                if family == socket.AF_INET6:
                    s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
                s.bind(addr)
        except OSError:
            continue
    return True


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    PORT = int(argv[0]) if argv else DEFAULT_PORT
    OPEN_BROWSER = "--no-browser" not in sys.argv

    PORT = _pick_port(PORT)
    httpd = None
    try:
        httpd = DualStackServer(("::", PORT), Handler)
    except OSError:
        try:
            httpd = ThreadedServer(("0.0.0.0", PORT), Handler)
        except OSError as exc:
            print(f"[serve] 端口 {PORT} 无法绑定：{exc}", file=sys.stderr)
            sys.exit(1)

    url = f"http://127.0.0.1:{PORT}/"
    print("=" * 56)
    print("  中国金融城 · 像素大富翁  开发服务器")
    print(f"  本地地址: {url}")
    print(f"  目录: {ROOT}")
    print("  按 Ctrl+C 停止")
    print("=" * 56)
    sys.stdout.flush()

    if OPEN_BROWSER:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] 已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
