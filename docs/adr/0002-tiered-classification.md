# ADR 0002: Tiered classification, trained only on the owner's labels

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Sift runs on a mini PC or Mac mini at home, usually without a usable GPU in Docker. It has to classify every incoming email into one of the owner's categories, get better at the owner's specific inbox over time, and always be able to explain a decision.

Running every email through an LLM is the obvious design, and it falls short on all three counts:

- **Speed and load.** Even a 1B-class model on a CPU takes noticeably longer per email than the rest of the pipeline put together, and a backlog after a weekend away is slow to clear.
- **Learning.** An LLM only "learns" through the examples placed in its prompt. It doesn't get measurably better at the owner's inbox in a way you can inspect or chart.
- **Explanation.** The model's stated reason is generated text. It's useful, but it isn't evidence.

Most email is also repetitive: receipts look like receipts, and the same recruiters and newsletters write every week. Spending the most expensive step on the easiest messages is wasteful.

## Decision

### Three tiers, cheapest first

1. **Exact rules.** Rules from `rules.md` that can be decided deterministically (sender, domain, phrase) run in code.
2. **Classifier (local embeddings).** Each email is embedded with a small local embedding model. A per-mailbox classifier (nearest neighbors plus logistic regression) predicts a category and a confidence. It's fast enough to retrain after every label.
3. **LLM (small, local).** A 1B-class instruct model receives the owner's categories and judgment rules, the most similar confirmed examples, and the fenced-off email. Its output is limited to the owner's categories by a JSON schema.

A message moves to the next tier when the current tier doesn't match (exact rules), isn't confident or isn't trained for that category yet (classifier), or is selected for a spot check. If the LLM isn't confident, the message goes to the owner's review queue.

### The classifier trains only on the owner's labels

The classifier's training set contains only labels the owner confirmed or corrected. Labels applied automatically by any tier, **including the LLM**, are excluded. This rule is the core of the design:

- **The owner is the only source of truth.** Every tier makes guesses, and a guess shouldn't train another guess without being checked.
- **Mistakes must stay visible.** If the classifier learned an LLM mistake, it would then handle those emails confidently itself. They would stop reaching the LLM or the review queue, and the mistake would become permanent and invisible.
- **Spot checks need independent opinions.** Spot checks compare the classifier with the LLM. That comparison only means something if they learned from different sources (the owner's labels vs the owner's written rules). If the classifier learned from the LLM, they would agree by construction.

### Quick confirm closes the cold-start gap

Training only on the owner's labels makes the cold start slow. To fix that, Sift periodically offers a small batch of recent LLM decisions for one-key approval. Approved or corrected decisions become owner labels and join the training set. Batches are filled first from categories below `min_examples_per_category`, then from the LLM's least confident decisions, so each confirmation teaches the classifier as much as possible.

### Learning directly from the LLM is an experiment, not a default

Letting the classifier learn from the LLM's most confident decisions ("distillation") might shorten the cold start further. It is available only behind an experimental flag and evaluated with the eval harness: the classifier trained with and without LLM labels on the synthetic inbox, compared on accuracy, learning curves, and how many of the LLM's errors the classifier inherits. If it's ever enabled by default, it needs a superseding ADR, and LLM labels must be weighted below the owner's, dropped when the owner disagrees, excluded from the cold-start count, and excluded from spot-check comparisons.

## Consequences

**Positive**

- Most mail is handled by exact rules and the classifier, so the LLM only runs on a small share of messages and a 1B-class model on a CPU is enough.
- The classifier measurably improves on the owner's inbox, and the improvement can be charted (accuracy vs training-set size).
- The classifier's explanations are evidence: the actual past emails it resembled.
- Errors stay visible, because nothing trains on unchecked guesses.

**Negative**

- More moving parts than a single LLM call: two models, a trained classifier per mailbox, escalation logic and per-tier thresholds to tune.
- The cold start is slower than with distillation. Quick confirm reduces it, but it asks the owner for attention.
- The classifier learns judgment rules from labels, not from the rule text, so a rule change can contradict earlier labels. The rule-change preview has to surface those conflicts (see the README).

## Alternatives considered

**LLM only.** The simplest design. Rejected for speed on CPU hardware, for lack of measurable learning, and because it spends the most expensive step on the easiest emails.

**Fine-tuning a small LLM on the owner's labels.** Rejected. It needs far more labeled data than one person produces, slow training runs and usually a GPU, and the result is harder to inspect than a classifier over embeddings.

**Classifier only (no LLM).** Rejected. It can't do anything until it has examples, and it can't apply new plain-English rules until the owner has labeled enough emails under them.

**The classifier learns from the LLM by default.** Rejected as a default for the reasons above (hidden mistakes, broken spot checks). Kept as a measured experiment.
