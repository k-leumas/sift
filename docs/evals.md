# Evals

Sift ships with a **synthetic inbox**: a few hundred realistic, entirely fictional emails with known correct labels, in `fixtures/synthetic-inbox/`. It's used for:

- **CI.** Every PR runs the full pipeline against it.
- **Choosing a model.** Compare candidate LLMs and embedding models on accuracy and latency, then ship the smallest one that clears your bar.
- **Prompt and rule changes.** The **Evals** page compares versions and lists the exact emails a change fixed or broke.
- **The public demo**, which runs on the synthetic inbox only.

Each eval run reports:

- Accuracy and a confusion matrix per category
- **Coverage per tier:** what share of mail each tier decided, and how accurate each tier was on its share
- How the classifier's accuracy grows with training-set size (the learning curve)
- Latency per tier on your hardware

## Open experiment: should the classifier learn from the LLM?

By default the classifier never trains on the LLM's labels unless you've approved them (see [ADR 0002](adr/0002-tiered-classification.md)). A riskier variant would let it learn from the LLM's most confident decisions, counted as weaker examples than yours and dropped whenever you disagree. That could shorten the cold start a lot, or quietly lock in the LLM's mistakes.

The eval harness can measure this directly: train the classifier with and without LLM labels on the synthetic inbox, then compare accuracy, learning curves and how many of the LLM's errors the classifier picks up. The variant stays behind an experimental flag until the numbers say it helps.

```sh
pnpm eval --experiment learn-from-llm
```

Your own labeled mail stays in your database and can be used as a private eval set per mailbox. It is never committed. Every LLM mistake you correct is added to that set automatically, so each future prompt or model change is tested against the mistakes you've already caught.

```sh
pnpm eval                                   # synthetic inbox, current config
pnpm eval --mailbox personal                # your own confirmed labels
pnpm eval --models qwen3:0.6b,qwen3:1.7b,gemma3:1b
pnpm eval --compare prompt:v3 prompt:v4
```
