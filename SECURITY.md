# Security

## Reporting a problem

Write to **rizal72** through a [private security advisory](https://github.com/rizal72/opencode-plugins/security/advisories/new)
on this repository. Do not open a public issue for something that is not yet fixed: a plugin runs inside
the OpenCode server, with the permissions of the person running it, and a public report is a working
recipe until the fix ships.

Every report gets an answer, and a fix, when one is warranted, ships as a new version on npm with the
advisory naming the versions to upgrade from and to.

## What is in scope

- Every package this repository publishes — the `plugins/` directory whose `package.json` names it
  `@rizal72/…` — and the sources behind it: the halves, and the scripts that build and publish them. The
  other three directories are tools for this machine alone: not published, so not reachable by anyone else.

## What is not

- OpenCode itself, and any third-party plugin listed or not listed here: report those to their own
  repository.
- A plugin that misbehaves because it was installed with a version OpenCode no longer supports.

## How the work is done here

Every package is published by the workflow in `.github/workflows/publish.yml`, through OIDC, with a
provenance statement — no long-lived npm token exists to be leaked. The actions the workflow runs are
pinned to immutable commits, and the dependencies are updated by Dependabot.
