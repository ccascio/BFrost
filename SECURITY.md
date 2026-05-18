# Security Policy

## Reporting a Vulnerability

BFrost is a local-first application that runs on the user's own machine, but
the project ships workers that can execute scheduled jobs, call external APIs,
and (in upcoming releases) perform file and shell actions. Vulnerabilities in
this code path are taken seriously.

If you believe you have found a security vulnerability in BFrost or one of its
built-in workers, please **do not open a public GitHub issue**. Instead, report
it privately:

- GitHub Security Advisories: use the "Report a vulnerability" button on the
  repository's Security tab.
- Email: contact the maintainer through the address listed on the GitHub
  profile of the repository owner.

Please include:

- A clear description of the issue and where it lives in the code.
- The BFrost version (or commit) and operating system.
- Reproduction steps, proof-of-concept, or a minimal local worker that
  triggers the issue.
- The impact you believe it has.

We aim to acknowledge reports within 7 days and to issue a fix or mitigation
plan within 30 days for confirmed vulnerabilities.

## Supported Versions

Until the project reaches `v1.0.0`, only the `main` branch is supported.
After `v1.0.0`, the latest minor release will receive security fixes for the
duration documented in the release notes.

## Threat Model Notes

- BFrost is **not** a sandbox for untrusted worker code. Local workers run with
  the privileges of the host user. Do not install workers from sources you do
  not trust.
- Credentials live in `.env` and in the local SQLite database. Operators are
  responsible for filesystem permissions on those files.
- The dashboard is bound to `127.0.0.1` by default. Exposing it to a network
  is an operator decision and falls outside the default threat model.

## Disclosure

Once a fix is available, we will:

- Publish a release with the fix.
- Credit the reporter (unless anonymity is requested) in the release notes.
- Publish a GitHub Security Advisory describing the issue, affected versions,
  and mitigation.
