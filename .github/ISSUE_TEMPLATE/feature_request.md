---
name: Feature request
about: Propose a change to the BFrost core (contract, SDK, dashboard shell, scheduler, item bus)
title: "[Feature] "
labels: enhancement
---

> If you want to propose a new capability that could ship as a worker (a new publisher, channel, provider, tool, scheduled job), open a **Worker proposal** instead — BFrost's design goal is that features land as workers, not as core changes.

## Problem

What you're trying to do and what currently blocks you. One or two paragraphs.

## Proposed change

What you'd like the core / SDK / contract to do. Be specific about API shape if relevant.

## Alternatives considered

Workers, manifest changes, or workarounds you tried first and why they didn't fit.

## Worker-first check

- [ ] I confirm this needs a **core** change and can't be expressed as a worker (or I've explained why a worker is the wrong shape).
- [ ] If accepted, this change is backwards-compatible with the current `bfrostApiVersion`, or I'm proposing a version bump.

## Additional context

Mockups, links, related issues, or prior art.
