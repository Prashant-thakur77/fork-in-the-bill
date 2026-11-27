# Security

## Reporting a problem

Please report a vulnerability privately. On the repository page, open the Security tab and choose "Report a vulnerability". That opens a draft advisory only the maintainers can see.

If the button is not there, open an issue that says you have a security report and nothing else. Do not put the details, a key, or a proof of concept in a public issue. A maintainer will reply with a private channel.

Say what you found, where (file and line, or URL), and how to reproduce it. If you found a credential, say where it is but do not paste it.

In scope: anything in this repository, the live board and site at the address in the README, and the release assets. A leaked credential is the most useful thing you can report. Flagsmith, the model provider and the hosting platforms have their own reporting channels for problems in their services.

Only the latest release and `main` are maintained.

## Keys this project uses

No key is committed, and none is needed to verify the ledgers or re-derive the numbers. Everything below lives in a gitignored `.env`, in GitHub Actions secrets, or in the board worker's secret store. [`.env.example`](.env.example) lists the names with empty values.

| Name | What it is | Where it is used |
|---|---|---|
| `ANTHROPIC_API_KEY` | Model provider key | The runner, and the manual kit demo workflow |
| `FLAGSMITH_ENVIRONMENT_KEY` | Server-side environment key (starts with `ser.`) | The SDK in the runner; `FLAGSMITH_SANDBOX_ENV_KEY` is the sandbox one in the kit demo workflow |
| `FLAGSMITH_API_KEY`, `FLAGSMITH_USER_TOKEN` | Admin API credentials | The Flagsmith CLI and the results pull, on a maintainer's machine |
| `FLAGSMITH_ENVIRONMENT_API_KEY` | The environment's client-side key | Admin API paths. Public, see below |
| `BOARD_INGEST_SECRET` | HMAC secret for results sent to the live board | The runner and the board worker |
| `FLAGSMITH_WEBHOOK_SECRET` | Signing secret of the Flagsmith webhook | The board worker |
| `DOCKERHUB_TOKEN` | Optional, for higher image pull limits | The runner |

The CI and release workflows use none of these. They run on the committed files with the default read-only token, and the release job adds only the permissions it needs to attest and publish.

## The one key that is published on purpose

Each file under `runs/<exp>/env/` is a Flagsmith environment document, saved during a run, and it contains the environment's client-side key in `api_key`. That is deliberate (decision [D28](DECISIONS.md#d28-environment-snapshots-keep-the-client-side-environment-key)).

Flagsmith treats the client-side key as public: it is the key a browser uses to evaluate flags. It is also an input to the bucketing hash, so `integrity/verify_assignment.py` cannot recompute an arm without it. Removing it would make the published assignments unverifiable.

What someone can do with it is what they can do with any public web app's key: ask which flag values an identity gets, which the snapshots already show, and send identities and events to that environment. They cannot change flags, variants or experiment settings; that needs the admin credentials above. If someone did send events during a run, Flagsmith's exposure counts and means would stop matching the ledger, and the agreement check in `analysis/results.md` (our mean cost against Flagsmith's, per arm) would show the gap.

## How leaks are kept out

`.gitleaks.toml` runs the default gitleaks rules over the full history in CI and as a pre-commit hook. Its allowlist has three narrow entries: scrubbed headers in recorded test cassettes, `numbers.json` key paths that look random to the generic rule, and the client-side key in exactly the `api_key` field of exactly the snapshot files. Server-side keys never match that last pattern.

The spend cap in `harness/budget.py` limits what a run started from this code can spend: each call's worst-case cost is reserved before the call, and a reservation that would pass `BUDGET_USD_TOTAL` is refused. It does nothing for a key that has leaked, so the provider account should have its own spend limit.
