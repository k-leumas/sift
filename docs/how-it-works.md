# How it works

Every message goes through up to three tiers, cheapest first. Each tier either decides confidently or passes the message on. The reasoning behind this design is in [ADR 0002](adr/0002-tiered-classification.md).

```
   IMAP (one loop per mailbox)
          │
          ▼
 ┌───────────────────┐  match
 │ Exact rules       │─────────────────────────┐
 │ run in code       │                         │
 └─────────┬─────────┘                         ▼
           │ no match                 ┌─────────────────┐
           ▼                          │   Apply label   │
 ┌───────────────────┐  confident     │                 │
 │ Classifier        │───────────────▶│                 │
 │ (local embeddings)│                └─────────────────┘
 │                   │                         ▲
 └─────────┬─────────┘                         │ confident
           │ unsure, not trained yet,          │
           │ or picked for a spot check        │
           ▼                                   │
 ┌───────────────────┐                ┌────────┴────────┐
 │ LLM               │───────────────▶│ Validate output │
 │ small, local      │                └────────┬────────┘
 │ + similar examples│                         │ unsure
 └───────────────────┘                         ▼
                                      ┌─────────────────┐
                                      │  Review queue   │──▶ your answer
                                      └─────────────────┘    retrains classifier
```

## Exact rules

Rules that can be decided deterministically, such as a sender, a domain or a phrase in the body, run in code. They're instant, free, and always right about what they cover. These come from your plain-English rules (see [Configuring Sift](configuration.md)). Until plain-English rules arrive in M3, you write them yourself in each mailbox's `rules.yaml` (see [The rules file today](configuration.md#the-rules-file-today)).

## Classifier (local embeddings)

Each message is turned into an embedding by a small local embedding model (`nomic-embed-text` by default). A lightweight classifier (nearest neighbors plus logistic regression) trained on **your confirmed labels for this mailbox** predicts a category and a confidence.

- **What it trains on:** only labels you confirmed or corrected, whether in Sift's review queue, in [quick confirm](#quick-confirm), or by [relabeling in your mail app](#learning-from-your-mail-app). Labels Sift applied on its own, including the LLM's, are never used as training data, so the classifier can't copy the LLM's mistakes or reinforce its own. A label you simply left alone doesn't count either, since you may never have looked at that email.
- **Retraining:** it retrains in the background after every correction. On a few thousand emails this takes milliseconds.
- **Cold start:** a category is only handled by the classifier once it has enough confirmed examples (`min_examples_per_category`, default 15). Until then, that category's mail goes to the LLM. The UI shows the classifier's coverage growing as you use Sift.
- **Explanation:** "Looks like these 3 emails you labeled *Job search*," with links to them.

## LLM (small, local)

When the classifier is unsure or not ready, a small instruct model through Ollama (1B-class by default) classifies the message. Its prompt has three clearly separated parts:

1. Your categories and plain-English judgment rules (trusted)
2. Your most similar past corrections, retrieved by embedding (trusted)
3. The email itself (untrusted, fenced off)

The model must answer with one of your categories, a confidence and a one-sentence reason, enforced with JSON-schema structured output. Malformed output is retried once, then sent to review.

**What runs today (M1).** Mail that no exact rule matches goes straight to the LLM: there is no classifier and no retrieved examples yet, so the prompt holds your categories and judgment lines, then the email.

- **Local only.** Sift talks only to the Ollama server at `models.url` and uses the model named in `models.llm` (`qwen3:1.7b` by default). Before each pass it checks that the model is pulled on that server and is not an Ollama cloud model, and it refuses a cloud model, because the prompt, and so your email, would leave this machine.
- **Email is fenced as untrusted data.** The email's fields sit inside a fence marked with a fresh random marker for every attempt, and the body is cut at 4,000 characters, with a note saying so.
- **Unsure goes to review.** An answer below `tiers.llm.confidence_threshold` (default 0.75, see [Technical settings](configuration.md#technical-settings)) is held for review instead of labelled.
- **The trace stores the recipe, not the prompt.** It records the prompt version, the rules version, the model and its digest, so the prompt can be rebuilt, but not the prompt text itself.
- **Problems show in the mailbox list.** If Ollama is down or the model is missing, `docker compose run --rm setup sift mailbox list` shows the mailbox as `error: Ollama unreachable at http://host.docker.internal:11434 (ECONNREFUSED)` or `error: Ollama at http://host.docker.internal:11434 has no model qwen3:1.7b; run: ollama pull qwen3:1.7b`. Sift retries on its own and carries on once Ollama answers again. If Ollama fails on one message only (for example an HTTP 500 every time it sees that email) while it answers for the rest, the other mail is still classified, the mailbox stays ok, and the list shows `ok; 1 message could not be classified (ids: <id>); see docker compose logs worker`. This means some messages could not be classified; their ids are listed (at most three, then a count). After three such passes, if Ollama still answers a short test request that contains no mail, the worker holds that message for review with the reason `llm_error`, so it no longer stays pending. An Ollama outage never puts a message in review: its mail stays pending until Ollama answers again.

## Spot checks

A small random sample of the classifier's decisions (`spot_check_rate`, default 5%) is also sent to the LLM. If the two disagree, the message goes to the review queue. This catches drift and gives you a running measure of how well the classifier agrees with the rules as written.

Spot checks only work because the two tiers learn from different sources: the classifier from your labels, the LLM from your written rules. If the classifier learned from the LLM, they would agree by construction and the check would catch nothing.

## Quick confirm

The classifier needs your confirmed labels to learn, and waiting for corrections alone makes the cold start slow. Quick confirm speeds it up without letting the LLM teach the classifier directly.

Every so often, Sift offers a short batch of recent LLM decisions: *"The model sorted these 20 emails. Look right?"* You approve or fix each one with a single key. Every answer becomes **your** label and joins the classifier's training set.

- **Which emails it picks:** categories that haven't reached `min_examples_per_category` come first, then decisions where the LLM was least confident. Twenty well-chosen confirmations teach the classifier more than a hundred random ones.
- **How often:** when there's a batch worth reviewing, never more than once a day by default (`quick_confirm.max_per_day`). It's a nudge, not a queue you have to clear.
- **What changes:** nothing about the labels already applied in your mail client, unless you fix one.

## Review queue

Anything no tier is confident about waits for you in a review queue covering all your mailboxes, with one-key labeling. Every answer you give becomes training data for that mailbox's classifier and retrieval data for its LLM.

## Learning from your mail app

You don't have to open Sift to correct it. If you move an email from one label to another in your normal mail app (Proton Mail on the web, desktop or mobile), Sift notices and treats it as a correction.

**How it notices.** Proton Bridge shows each label as a folder, such as `Labels/Noise`. About once a minute, Sift lists what's in each label folder and compares it with what it expects. IMAP gives the same email a different ID (UID) in every folder, so emails are matched across folders by Proton's internal message ID, which Bridge adds to every email as the `X-Pm-Internal-Id` header. Sift trusts that header only on a mailbox pinned to Bridge's certificate (`imap.tls.pin_sha256`, see [Security model](security.md)), and an email without exactly one such header is matched by its `Message-ID` header instead.

Proton Bridge offers no IMAP change tracking (CONDSTORE/QRESYNC), so Sift cannot ask only for what changed: on every poll it compares each label folder's full list of UIDs with what it stored, and checks the folder's UIDVALIDITY. This is as measured on Proton Bridge v3.27.0 in the M1 spike, whose findings are scoped like this: *"Measured on Proton Bridge v3.27.0 (commit 04e46eb4), 2026-10-06; later Bridge versions may differ."* See the [spike findings](../.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md) and the [ADR 0003 addendum](adr/0003-traces-and-mail-app-relabels.md#addendum-2026-10-proton-bridge-spike-m1).

**What it does with a change.** Each email's state is stored in the database, so it doesn't matter whether the two halves of a change happen seconds or weeks apart:

| What Sift sees on an email it labeled | What it means | What Sift does |
|---|---|---|
| Its label removed and a different one added | A correction | Records your new label and learns from it |
| Its label removed, nothing added | "Wrong, but I didn't say what's right" | Learns nothing yet; asks in quick confirm: *"You removed Noise from this. Where should it go?"* |
| A second label added, the original kept | Unclear | Asks in quick confirm |
| The email deleted | Cleanup, not feedback | Ignores it |
| A change Sift made itself | Its own echo | Ignores it |

**Sending the fix to the right place.** When you correct a label, Sift reads that email's [trace](#decision-traces) to see which tier got it wrong:

- **An exact rule:** retraining can't help, so Sift suggests a rule change: *"You moved this out of Reading, but your newsletter rule put it there. Edit the rule?"*
- **The classifier:** it retrains on the corrected label.
- **The LLM:** the email becomes a retrieval example, and it joins your private eval set so future prompt or model changes are tested against it.

## Decision traces

Every classification produces a trace, like a stack trace for a label. It records each tier that ran, what it looked at, how confident it was, and why it decided or passed the email on:

```
Email: "Senior Frontend role at Acme"            → Job search (applied 09:14)
├─ Exact rules     12 checked, 0 matched
│                  nearest miss: "newsletters → Reading" (sender not a list)
├─ Classifier v14  Job search 0.62 · Noise 0.31
│                  neighbors: 3 emails you labeled Job search
│                  0.62 < 0.85 threshold → escalate
├─ LLM             qwen3:1.7b, prompt v3
│                  rules used: "Recruiter emails about frontend or AI roles…"
│                  examples: 6 retrieved · output valid · confidence 0.88
└─ Action          copied to Labels/Job search
   versions: rules r7 · classifier v14 · prompt v3 · model qwen3:1.7b
```

- **Answering "why?"** Every email in the UI has a **Why?** link that opens its trace.
- **Replay.** Because the trace records every version involved, you can rerun an old decision against today's rules, classifier and model and see whether it would change.
- **Targeted fixes.** Corrections use the trace to decide what to fix (see above).
- **Where it lives.** IMAP can't attach notes to an email in your mailbox, so traces are stored in Sift and linked from the UI.

Traces use the same span structure as LLM observability tools, one span per tier, so they could be exported to one later.

**What M1 stores today.** Every decision is a row in the `decision` table of Sift's database, with its trace in the `spans` column: the exact rules span (how many rules were checked, the match or the nearest miss), a classifier span marked `not trained` (the classifier arrives in M2, so the layout will not change), the LLM span (model and digest, prompt version, each attempt, confidence and reason), and the action span, which stays `pending`. **Nothing is written into your mailbox yet**: labels in Proton arrive next, with the rest of M1. There is no UI yet either. To count decisions by outcome:

```sh
docker compose exec -T db psql -U postgres -d sift -Atc "select outcome, count(*) from decision group by 1 order by 1"
```

You should see one line per outcome, such as `labelled|12` and `review|3`.
