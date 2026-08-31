#!/usr/bin/env python3
"""
Voice Form Filler — Unified Server Orchestrator (main.py)

Single-command orchestrator that discovers models, initializes, and manages:
  1. Sherpa-ONNX ASR WebSocket Server (ws://localhost:8001)
  2. Kokoro-ONNX TTS HTTP/WebSocket Server (http://localhost:8000)
  3. Static Web Server for form testing and UI (http://localhost:8080)

Usage:
  python main.py
  python main.py --no-web
  python main.py --asr-port 8001 --tts-port 8000 --web-port 8080
"""

import argparse
import http.server
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Configure UTF-8 output encoding for Windows compatibility
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Terminal color codes
class Colors:
    HEADER = "\033[95m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"
    RESET = "\033[0m"


def log(tag: str, message: str, color: str = Colors.CYAN):
    tag_str = f"{color}[{tag.upper()}]{Colors.RESET}"
    print(f"{tag_str} {message}", flush=True)


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Checks if a TCP port is currently open and in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.connect((host, port))
            return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            return False


def wait_for_port(port: int, timeout_sec: float = 15.0, host: str = "127.0.0.1") -> bool:
    """Polls until a port starts accepting connections or timeout occurs."""
    start_time = time.time()
    while time.time() - start_time < timeout_sec:
        if is_port_in_use(port, host):
            return True
        time.sleep(0.3)
    return False


def discover_asr_models(base_dir: str = "models") -> Optional[Dict[str, str]]:
    """Automatically finds required Sherpa-ONNX ASR model files."""
    models_path = Path(base_dir)
    if not models_path.exists():
        return None

    encoder = None
    decoder = None
    joiner = None
    tokens = None

    # Search in base directory and all subdirectories
    for root, _, files in os.walk(models_path):
        for f in files:
            full_p = os.path.join(root, f)
            name_lower = f.lower()
            if "encoder" in name_lower and f.endswith(".onnx") and not encoder:
                encoder = full_p
            elif "decoder" in name_lower and f.endswith(".onnx") and not decoder:
                decoder = full_p
            elif "joiner" in name_lower and f.endswith(".onnx") and not joiner:
                joiner = full_p
            elif name_lower.startswith("tokens") and f.endswith(".txt") and not tokens:
                tokens = full_p

    if encoder and decoder and joiner and tokens:
        return {
            "encoder": encoder,
            "decoder": decoder,
            "joiner": joiner,
            "tokens": tokens,
        }
    return None


def discover_tts_models(base_dir: str = "models") -> Optional[Dict[str, str]]:
    """Automatically finds Kokoro TTS model and voices bin."""
    models_path = Path(base_dir)
    kokoro_onnx = None
    voices_bin = None

    # Check root level and models dir
    candidates = [
        models_path / "kokoro-v1.0.onnx",
        Path("kokoro-v1.0.onnx"),
    ]
    for c in candidates:
        if c.exists():
            kokoro_onnx = str(c)
            break

    voice_candidates = [
        models_path / "voices-v1.0.bin",
        Path("voices-v1.0.bin"),
    ]
    for v in voice_candidates:
        if v.exists():
            voices_bin = str(v)
            break

    if kokoro_onnx and voices_bin:
        return {"model": kokoro_onnx, "voices": voices_bin}
    return None


class StreamLogger(threading.Thread):
    """Streams and tags stdout/stderr of subprocesses in real-time."""

    def __init__(self, pipe, tag: str, color: str):
        super().__init__(daemon=True)
        self.pipe = pipe
        self.tag = tag
        self.color = color

    def run(self):
        try:
            for line in iter(self.pipe.readline, ""):
                if not line:
                    break
                stripped = line.rstrip()
                if stripped:
                    log(self.tag, stripped, self.color)
        except Exception:
            pass


class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler that logs only errors and key hits quietly."""

    def log_message(self, format, *args):
        code = args[1] if len(args) > 1 else ""
        if code and str(code) not in ("200", "304"):
            log("WEB", f"{args[0]} - status {code}", Colors.YELLOW)


def start_static_web_server(port: int, directory: str = ".") -> socketserver.TCPServer:
    """Runs a lightweight HTTP server in a background thread."""
    handler = QuietHTTPHandler

    class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True
        daemon_threads = True

    server = ThreadedTCPServer(("0.0.0.0", port), handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return server


def get_python_interpreter() -> str:
    """Returns the most appropriate python interpreter (venv or active)."""
    venv_python_win = Path("venv") / "Scripts" / "python.exe"
    venv_python_nix = Path("venv") / "bin" / "python"

    if venv_python_win.exists():
        return str(venv_python_win.resolve())
    if venv_python_nix.exists():
        return str(venv_python_nix.resolve())
    return sys.executable


def main():
    parser = argparse.ArgumentParser(
        description="Voice Form Filler — Unified Server Orchestrator"
    )
    parser.add_argument("--asr-port", type=int, default=8001, help="ASR WebSocket port (default: 8001)")
    parser.add_argument("--tts-port", type=int, default=8000, help="TTS HTTP/WebSocket port (default: 8000)")
    parser.add_argument("--web-port", type=int, default=8080, help="Static Web server port (default: 8080)")
    parser.add_argument("--models-dir", type=str, default="models", help="Directory containing models")
    parser.add_argument("--no-asr", action="store_true", help="Disable ASR server")
    parser.add_argument("--no-tts", action="store_true", help="Disable TTS server")
    parser.add_argument("--no-web", action="store_true", help="Disable Static Web server")
    args = parser.parse_args()

    python_bin = get_python_interpreter()

    print(f"{Colors.HEADER}{Colors.BOLD}")
    print("===================================================================")
    print("       Voice Form Filler — Unified Server Orchestrator (Phase 2)    ")
    print("===================================================================")
    print(f"{Colors.RESET}")

    log("MAIN", f"Using Python runtime: {python_bin}", Colors.CYAN)

    subprocesses: List[Tuple[str, subprocess.Popen]] = []
    web_server = None

    try:
        # 1. Discover & Launch ASR Server
        if not args.no_asr:
            asr_models = discover_asr_models(args.models_dir)
            if not asr_models:
                log("ASR", f"Warning: Could not automatically locate all ASR ONNX models in '{args.models_dir}'.", Colors.RED)
                log("ASR", "Expected: encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx, tokens.txt", Colors.YELLOW)
            else:
                log("ASR", f"Models discovered: {asr_models['encoder']}", Colors.GREEN)
                asr_cmd = [
                    python_bin,
                    "asr_server.py",
                    "--encoder", asr_models["encoder"],
                    "--decoder", asr_models["decoder"],
                    "--joiner", asr_models["joiner"],
                    "--tokens", asr_models["tokens"],
                    "--port", str(args.asr_port),
                ]
                log("ASR", f"Launching ASR WebSocket server on port {args.asr_port}...", Colors.BLUE)
                asr_proc = subprocess.Popen(
                    asr_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    cwd=os.getcwd(),
                )
                StreamLogger(asr_proc.stdout, "ASR", Colors.BLUE).start()
                subprocesses.append(("ASR", asr_proc))

        # 2. Discover & Launch TTS Server
        if not args.no_tts:
            tts_models = discover_tts_models(args.models_dir)
            if not tts_models:
                log("TTS", f"Warning: Kokoro TTS model files not found in '{args.models_dir}'.", Colors.YELLOW)
            log("TTS", f"Launching Kokoro TTS server on port {args.tts_port}...", Colors.GREEN)
            tts_cmd = [
                python_bin,
                "tts_server.py",
            ]
            tts_proc = subprocess.Popen(
                tts_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=os.getcwd(),
            )
            StreamLogger(tts_proc.stdout, "TTS", Colors.GREEN).start()
            subprocesses.append(("TTS", tts_proc))

        # 3. Launch Static Web Server
        if not args.no_web:
            try:
                web_server = start_static_web_server(args.web_port)
                log("WEB", f"Static Web Server running at http://localhost:{args.web_port}", Colors.CYAN)
            except OSError as e:
                log("WEB", f"Could not bind Web Server to port {args.web_port}: {e}", Colors.RED)

        # 4. Service Readiness Verification
        print()
        log("MAIN", "Verifying service readiness...", Colors.YELLOW)
        
        if not args.no_asr:
            if wait_for_port(args.asr_port, timeout_sec=12.0):
                log("MAIN", f"✔ ASR WebSocket Server is ACTIVE on ws://localhost:{args.asr_port}", Colors.GREEN)
            else:
                log("MAIN", f"⚠ ASR Server did not respond on port {args.asr_port} yet.", Colors.YELLOW)

        if not args.no_tts:
            if wait_for_port(args.tts_port, timeout_sec=12.0):
                log("MAIN", f"✔ TTS HTTP/WebSocket Server is ACTIVE on http://localhost:{args.tts_port}", Colors.GREEN)
            else:
                log("MAIN", f"⚠ TTS Server did not respond on port {args.tts_port} yet.", Colors.YELLOW)

        if not args.no_web and web_server:
            log("MAIN", f"✔ Web Application UI is READY at http://localhost:{args.web_port}/voice-form.html", Colors.GREEN)

        print(f"\n{Colors.BOLD}{Colors.GREEN}===================================================================")
        print("  All Services Orchestrated Successfully!")
        print("  Available URLs:")
        if not args.no_web:
            print(f"    • Voice Form UI:      http://localhost:{args.web_port}/voice-form.html")
            print(f"    • Form Scanner Test:  http://localhost:{args.web_port}/form-test.html")
            print(f"    • Unit Test Suite:    http://localhost:{args.web_port}/test_scanner.html")
        if not args.no_asr:
            print(f"    • ASR WebSocket:      ws://localhost:{args.asr_port}")
        if not args.no_tts:
            print(f"    • TTS WebSocket:      ws://localhost:{args.tts_port}/ws/stream")
            print(f"    • TTS API Docs:       http://localhost:{args.tts_port}/docs")
        print("===================================================================")
        print(f"  Press Ctrl+C to stop all servers.{Colors.RESET}\n", flush=True)

        # Keep main thread alive and monitor child processes
        while True:
            for name, proc in subprocesses:
                ret = proc.poll()
                if ret is not None:
                    log("MAIN", f"Process {name} exited with code {ret}", Colors.RED)
            time.sleep(1.0)

    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}[MAIN] Shutting down all orchestrated servers gracefully...{Colors.RESET}")
    finally:
        # Terminate web server
        if web_server:
            try:
                web_server.shutdown()
                web_server.server_close()
                log("WEB", "Web Server stopped.", Colors.CYAN)
            except Exception:
                pass

        # Terminate subprocesses
        for name, proc in subprocesses:
            if proc.poll() is None:
                log("MAIN", f"Stopping {name} server (PID {proc.pid})...", Colors.YELLOW)
                proc.terminate()
                try:
                    proc.wait(timeout=3.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    log("MAIN", f"Force-killed {name} server.", Colors.RED)

        log("MAIN", "All servers stopped. Goodbye!", Colors.GREEN)


if __name__ == "__main__":
    main()
