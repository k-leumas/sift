<!-- generated-by: gsd-doc-writer -->
# Contributing to Sift

Issues and PRs are welcome. Sift is **pre-alpha and still in design**: the repository holds the design docs and ADRs, but no application code, package manifest, test suite or CI yet. Most of the useful contributions right now are design feedback, questions about the ADRs, and bug reports against the design. The guidelines below cover both the current state and the rules that apply once code lands.

## Development setup

There is nothing to build or run yet. To get oriented:

1. Clone the repository:

   ```bash
   git clone git@github.com:k-leumas/sift.git
   cd sift
   ```

2. Use the Node.js version pinned in `.nvmrc` (`v26.10.0`):

   ```bash
   nvm use
   ```

3. Read the [README](README.md) for the target design, then the architecture decision records in [`docs/adr/`](docs/adr/):
   - [ADR 0001: Multiple mailboxes, single owner](docs/adr/0001-multiple-mailboxes-single-owner.md)
   - [ADR 0002: Tiered classification](docs/adr/0002-tiered-classification.md)
   - [ADR 0003: Traces and mail app relabels](docs/adr/0003-traces-and-mail-app-relabels.md)

The planned runtime setup (Docker Compose, Ollama, Proton Bridge) is described under [Running it at home](README.md#running-it-at-home) in the README. Those commands don't work yet.

## Coding standards

- **TypeScript only.** The planned stack is TypeScript end to end, including the classifier. Please don't propose Python components.
- **Strict module syntax.** The root `tsconfig.json` sets `erasableSyntaxOnly` (no enums, namespaces or other non-erasable syntax), `verbatimModuleSyntax` (use `import type` for type-only imports) and `allowImportingTsExtensions` (import local files with their `.ts` extension, e.g. `./x.ts`). Code should run under Node's native type stripping without a separate build step.
- **No linter or formatter is configured yet.** There is no ESLint, Prettier or Biome config and no CI enforcement. Match the style of surrounding code until one is added.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/), as in the existing history: `type(scope): summary`, for example `chore: add tsconfig and .nvmrc` or `docs(adr): clarify relabel handling`.

## PR guidelines

- **Open an issue first** for anything beyond a small fix, so the approach can be agreed before you write code.
- **Architecture changes need an ADR.** Add a new numbered file to `docs/adr/` following the existing format (title, Status, Date, then Context, Decision, Consequences, and Alternatives considered).
- **Never commit real email.** Not in fixtures, tests, issues, screenshots or PR descriptions. Add test cases to the synthetic inbox (`fixtures/synthetic-inbox/`, planned) instead.
- **Changes to prompts, models or classification must include an eval run** (`pnpm eval`, planned) in the PR description.
- **Every new table holding mail-derived data gets a `mailbox_id` and a Postgres row-level security policy**, and the cross-mailbox isolation tests (`evals/isolation/`, planned) must pass. See the [Data model](README.md#data-model) section of the README.
- **Treat email as untrusted input.** Changes that touch how email content reaches the LLM prompt or any tier must keep it fenced off from instructions, and the injection suite (`evals/injection/`, planned) must still pass. See the [Security model](README.md#security-model).

Branch names aren't fixed by any convention. A short descriptive name such as `docs/adr-0004-drafts` or `fix/relabel-echo` is fine. PRs target `main`.

## Issue reporting

Report bugs and request features through [GitHub Issues](https://github.com/k-leumas/sift/issues). There are no issue templates yet, so please include:

- **For bugs:** what you did, what you expected, what happened instead, and your environment (OS, Node.js version, mail provider or IMAP server, Ollama model if relevant).
- **For design feedback:** which section of the README or which ADR it concerns, and the case it doesn't handle.
- **For feature requests:** the problem you're trying to solve, not only the proposed solution. Check the [Roadmap](README.md#roadmap) and the "Not planned" list first. Sending email and a hosted version are out of scope.

**Don't paste real email content into issues.** If a bug depends on a specific message, reduce it to a fictional example with the same structure (headers, encoding, label folder layout) before posting.

Security issues, especially prompt-injection bypasses or cross-mailbox leakage, should not be filed as public issues. <!-- VERIFY: private security reporting channel (e.g. GitHub private vulnerability reporting enabled on k-leumas/sift) --> Use GitHub's private vulnerability reporting on the repository instead.
