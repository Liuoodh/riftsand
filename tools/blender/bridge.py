"""
Minimal client for the MCP-for-Blender (ahujasid/blender-mcp) add-on socket bridge.

The add-on listens on 127.0.0.1:9876 and speaks one JSON object per connection:
    request  {"type": "execute_code", "params": {"code": "..."}}
    response {"status": "success" | "error", "result": {...}}

This script lets any external process reuse exactly the same code path the MCP
server uses, which is handy for long, reproducible art builds (the MCP chat
round-trip is not great for a 500-line modelling script).

Usage:
    python tools/blender/bridge.py ping
    python tools/blender/bridge.py run tools/blender/scripts/tank.py
    python tools/blender/bridge.py code "import bpy; print(len(bpy.data.objects))"
"""

import json
import socket
import sys
import time

HOST = "127.0.0.1"
PORT = 9876
BUF = 65536


def send(command, timeout=600.0):
    payload = json.dumps(command).encode("utf-8")
    sock = socket.create_connection((HOST, PORT), timeout=10)
    sock.settimeout(timeout)
    try:
        sock.sendall(payload)
        chunks = []
        while True:
            data = sock.recv(BUF)
            if not data:
                break
            chunks.append(data)
            try:
                return json.loads(b"".join(chunks).decode("utf-8", "replace"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
        return {"status": "error", "message": "connection closed with no response"}
    finally:
        sock.close()


def run_code(code, timeout=600.0):
    return send({"type": "execute_code", "params": {"code": code}}, timeout=timeout)


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0

    mode = argv[0]
    if mode == "ping":
        print(json.dumps(send({"type": "ping", "params": {}}), ensure_ascii=False))
        return 0
    if mode == "info":
        print(json.dumps(send({"type": "get_scene_info", "params": {}}), ensure_ascii=False, indent=2))
        return 0
    if mode == "run":
        path = argv[1]
        with open(path, "r", encoding="utf-8") as fh:
            code = fh.read()
        started = time.time()
        res = run_code(code)
        print(json.dumps(res, ensure_ascii=False, indent=2)[:8000])
        print("elapsed %.1fs" % (time.time() - started), file=sys.stderr)
        return 0 if res.get("status") == "success" else 1
    if mode == "code":
        res = run_code(argv[1])
        print(json.dumps(res, ensure_ascii=False, indent=2)[:8000])
        return 0 if res.get("status") == "success" else 1

    print("unknown mode: %s" % mode, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
