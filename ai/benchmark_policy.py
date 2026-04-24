import argparse
import json
from pathlib import Path
from statistics import mean
from time import perf_counter

import torch

from train_policy import ACTIONS, PolicyDataset, PolicyMLP


def percentile(values, p):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * p))))
    return float(ordered[index])


def top_action_from_tensor(tensor_row, legal_actions):
    best_action = None
    best_value = None
    legal_set = set(legal_actions)
    for action, value in zip(ACTIONS, tensor_row.tolist()):
        if action not in legal_set:
            continue
        if best_value is None or value > best_value:
            best_action = action
            best_value = value
    return best_action, float(best_value or 0.0)


def benchmark(args):
    checkpoint = torch.load(args.model, map_location="cpu")
    model = PolicyMLP(checkpoint["input_dim"], len(checkpoint["actions"]))
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    dataset = PolicyDataset(args.dataset)
    limit = min(args.limit or len(dataset), len(dataset))
    latencies = []
    confidence_values = []
    selected_action_counts = {}
    invalid_selections = 0
    top1_matches = 0
    avg_teacher_mass = []

    with torch.no_grad():
      for index in range(limit):
        row = dataset.rows[index]
        features, targets = dataset[index]
        legal_actions = row["legalActions"]
        started = perf_counter()
        logits, confidence = model(features.unsqueeze(0))
        latency_ms = (perf_counter() - started) * 1000.0
        latencies.append(latency_ms)
        confidence_values.append(float(confidence.item()))

        probs = torch.softmax(logits, dim=-1)[0]
        selected_action, selected_prob = top_action_from_tensor(probs, legal_actions)
        teacher_action, _ = top_action_from_tensor(targets, legal_actions)
        if selected_action not in legal_actions:
            invalid_selections += 1
            continue
        selected_action_counts[selected_action] = selected_action_counts.get(selected_action, 0) + 1
        if teacher_action == selected_action:
            top1_matches += 1
        action_index = ACTIONS.index(selected_action)
        avg_teacher_mass.append(float(targets[action_index].item()))

    summary = {
        "ok": True,
        "modelVersion": Path(args.model).name,
        "dataset": str(Path(args.dataset)),
        "sampleCount": limit,
        "latencyMs": {
            "mean": round(mean(latencies), 3) if latencies else 0.0,
            "p50": round(percentile(latencies, 0.50), 3),
            "p95": round(percentile(latencies, 0.95), 3),
            "max": round(max(latencies), 3) if latencies else 0.0,
        },
        "confidence": {
            "mean": round(mean(confidence_values), 4) if confidence_values else 0.0,
            "min": round(min(confidence_values), 4) if confidence_values else 0.0,
            "max": round(max(confidence_values), 4) if confidence_values else 0.0,
        },
        "invalidSelections": invalid_selections,
        "selectedActionCounts": selected_action_counts,
        "top1Agreement": round(top1_matches / limit, 4) if limit else 0.0,
        "avgTeacherMassOnSelected": round(mean(avg_teacher_mass), 4) if avg_teacher_mass else 0.0,
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    benchmark(args)


if __name__ == "__main__":
    main()
