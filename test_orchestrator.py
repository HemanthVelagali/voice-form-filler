#!/usr/bin/env python3
"""
Automated Lifecycle Test for main.py Orchestrator
"""

import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def is_port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.connect((host, port))
            return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            return False


def test_orchestrator_web():
    port = 8099
    print(f"Testing main.py orchestrator startup with web server on port {port}...")
    python_exe = sys.executable
    proc = subprocess.Popen(
        [python_exe, "main.py", "--web-port", str(port), "--no-asr", "--no-tts"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        # Poll up to 6 seconds for port to open
        ready = False
        for _ in range(20):
            if is_port_open(port):
                ready = True
                break
            time.sleep(0.3)

        assert ready, f"Web server did not start listening on port {port}"
        print(f"[OK] Port {port} is open and accepting connections.")

        url = f"http://127.0.0.1:{port}/voice-form.html"
        print(f"Fetching {url}...")
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=3) as resp:
            content = resp.read().decode("utf-8")
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            assert "Voice Recognition Form" in content, "Expected HTML content in response"
            print("[OK] Web server responded correctly (200 OK).")

    finally:
        print("Stopping orchestrator process...")
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=4)
                print("[OK] Orchestrator terminated cleanly.")
            except subprocess.TimeoutExpired:
                proc.kill()
                print("[WARN] Orchestrator required force-kill.")


if __name__ == "__main__":
    test_orchestrator_web()
    print("[SUCCESS] All orchestrator lifecycle tests PASSED!")

