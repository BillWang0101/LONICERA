import argparse
import json
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

ACTIONS = ["fold", "check", "call", "bet_33", "bet_75", "bet_130", "raise_250", "raise_400", "allin"]
TEXTURE_INDEX = {"none": 0, "dry": 1, "medium": 2, "wet": 3}
FIT_INDEX = {
    "preflop": 0,
    "air": 1,
    "overcards": 2,
    "straight_draw": 3,
    "flush_draw": 4,
    "combo_draw": 5,
    "middle_or_bottom_pair": 6,
    "top_pair_weak_kicker": 7,
    "top_pair_good_kicker": 8,
    "overpair": 9,
    "two_pair": 10,
    "set": 11,
}
BLOCKER_INDEX = {"none": 0, "light": 1, "medium": 2, "strong": 3}
POSITION_INDEX = {"OOP": 0, "IP": 1, None: 0}
INITIATIVE_INDEX = {"defender": 0, "aggressor": 1}


def encode_sample(sample):
    board = sample["boardFeatures"]
    hand = sample["handFeatures"]
    abstraction = sample["abstraction"]
    legal = sample["legalActions"]
    teacher = sample["teacherPolicy"]
    vector = [
        sample["contextFeatures"]["effectiveBb"] / 100.0,
        board.get("wetness", 0.0),
        float(board.get("paired", False)),
        float(board.get("monotone", False)),
        float(board.get("connected", False)),
        board.get("highCards", 0) / 3.0,
        TEXTURE_INDEX.get(board.get("texture"), 0) / max(1, len(TEXTURE_INDEX) - 1),
        hand.get("strength", 0.0),
        FIT_INDEX.get(hand.get("fit"), 0) / max(1, len(FIT_INDEX) - 1),
        float(hand.get("hasFlushDraw", False)),
        float(hand.get("hasStraightDraw", False)),
        float(hand.get("hasComboDraws", False)),
        float(hand.get("hasTopPair", False)),
        float(hand.get("hasOverpair", False)),
        float(hand.get("hasSet", False)),
        BLOCKER_INDEX.get(abstraction.get("blockerClass"), 0) / max(1, len(BLOCKER_INDEX) - 1),
        POSITION_INDEX.get(abstraction.get("position"), 0),
        INITIATIVE_INDEX.get(abstraction.get("initiative"), 0),
        float(abstraction.get("spr", 0.0)) / 20.0,
        float(sample.get("confidence", 0.0)),
    ]
    legal_mask = [1.0 if action in legal else 0.0 for action in ACTIONS]
    target = [teacher.get(action, 0.0) for action in ACTIONS]
    return torch.tensor(vector + legal_mask, dtype=torch.float32), torch.tensor(target, dtype=torch.float32)


class PolicyDataset(Dataset):
    def __init__(self, path):
        self.rows = []
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                self.rows.append(json.loads(line))

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        return encode_sample(self.rows[idx])


class PolicyMLP(nn.Module):
    def __init__(self, input_dim, output_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
        )
        self.policy_head = nn.Linear(64, output_dim)
        self.confidence_head = nn.Linear(64, 1)

    def forward(self, x):
        hidden = self.net(x)
        return self.policy_head(hidden), torch.sigmoid(self.confidence_head(hidden))


def masked_policy_loss(logits, targets, legal_mask):
    illegal_penalty = (1.0 - legal_mask) * 1e9
    masked_logits = logits - illegal_penalty
    log_probs = torch.log_softmax(masked_logits, dim=-1)
    return -(targets * log_probs).sum(dim=-1).mean()


def train(args):
    dataset = PolicyDataset(args.dataset)
    if len(dataset) == 0:
      raise RuntimeError("dataset is empty")
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True)
    sample_features, _ = dataset[0]
    model = PolicyMLP(sample_features.shape[0], len(ACTIONS))
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    for epoch in range(args.epochs):
        running = 0.0
        for features, targets in loader:
            legal_mask = features[:, -len(ACTIONS) :]
            logits, confidence = model(features)
            loss = masked_policy_loss(logits, targets, legal_mask)
            confidence_target = targets.max(dim=-1, keepdim=True).values
            loss = loss + torch.nn.functional.mse_loss(confidence, confidence_target)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            running += float(loss.item())
        print(json.dumps({"epoch": epoch + 1, "loss": running / max(1, len(loader))}))

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "input_dim": sample_features.shape[0],
            "actions": ACTIONS,
        },
        output_path,
    )
    print(json.dumps({"ok": True, "output": str(output_path), "rows": len(dataset)}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()
    train(args)


if __name__ == "__main__":
    main()
