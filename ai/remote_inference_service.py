import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter

import torch

from train_policy import ACTIONS, PolicyMLP, encode_sample


class ModelRuntime:
    def __init__(self, checkpoint_path):
        checkpoint = torch.load(checkpoint_path, map_location="cpu")
        self.actions = checkpoint["actions"]
        self.model = PolicyMLP(checkpoint["input_dim"], len(self.actions))
        self.model.load_state_dict(checkpoint["state_dict"])
        self.model.eval()
        self.version = Path(checkpoint_path).name

    def decide(self, payload):
        sample = {
            "contextFeatures": {
                "effectiveBb": payload["effectiveBb"],
            },
            "boardFeatures": payload["abstraction"]["boardTexture"],
            "handFeatures": payload["abstraction"]["handFeatures"],
            "abstraction": {
                "blockerClass": payload["abstraction"]["blockerClass"],
                "position": payload["abstraction"]["position"],
                "initiative": payload["abstraction"]["initiative"],
                "spr": payload["abstraction"]["spr"],
            },
            "legalActions": payload["legalActions"],
            "teacherPolicy": {action: 1.0 / len(payload["legalActions"]) for action in payload["legalActions"]},
            "confidence": 1.0,
        }
        features, _ = encode_sample(sample)
        with torch.no_grad():
            logits, confidence = self.model(features.unsqueeze(0))
            probs = torch.softmax(logits, dim=-1)[0].tolist()
        legal = set(payload["legalActions"])
        filtered = {action: prob for action, prob in zip(self.actions, probs) if action in legal}
        total = sum(filtered.values()) or 1.0
        normalized = {action: value / total for action, value in filtered.items()}
        selected = max(normalized.items(), key=lambda item: item[1])[0]
        return {
            "policy": normalized,
            "selectedAction": selected,
            "confidence": float(confidence.item()),
            "modelVersion": self.version,
            "coverageStatus": payload.get("coverage", {}).get("reason", "covered_spot"),
        }


def make_handler(runtime):
    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status, payload):
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8"))
            started = perf_counter()
            if self.path == "/health":
                self._send_json(200, {"ok": True, "status": "online", "modelVersion": runtime.version})
                return
            if self.path != "/decide":
                self._send_json(404, {"ok": False, "error": "not_found"})
                return
            response = runtime.decide(payload)
            response["latencyMs"] = round((perf_counter() - started) * 1000, 2)
            self._send_json(200, response)

        def log_message(self, format, *args):
            return

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8900)
    args = parser.parse_args()

    runtime = ModelRuntime(args.model)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(runtime))
    print(json.dumps({"ok": True, "host": args.host, "port": args.port, "modelVersion": runtime.version}))
    server.serve_forever()


if __name__ == "__main__":
    main()
