# Dependency release review

Reviewed 2026-10-04 against the unchanged lockfile at application commit
`9784c4bd58f50bacc591614e55ea9d1cfa72a191`. This is an advisory review,
not a production security clearance or an authorization to change dependencies.

## Verified evidence

- Full `npm audit --json`: 16 affected packages, 11 high and 5 moderate;
  no critical findings. Counts include vulnerable dependency chains, not 16
  distinct root vulnerabilities.
- `npm audit --omit=dev --json`: 2 moderate affected packages (`gaxios`,
  `uuid`), no high or critical findings. The CI high/critical runtime gate passes
  with these moderate findings still outstanding.
- Current application [CI run](https://github.com/mihastele/teamspace-compact/actions/runs/37223851701)
  succeeded. Its verify job passed npm ci, lint, typecheck, unit tests,
  Firestore/Storage rules and API tests, isolated PostgreSQL tests, Supabase
  setup/Compose checks, runtime audit gate and production build.
- Raw local audit/registry output is under gitignored `.agentic/verification/`;
  no credentials were required for registry or public GitHub API reads.

## Findings and next actions

| Dependency path / scope | Finding and observed exposure | Remediation boundary |
| --- | --- | --- |
| Firebase Admin / gaxios 6.7.1 / uuid 9.0.1; runtime and CLI | [UUID buffer bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) concerns v3/v5/v6 with a supplied buffer. Installed gaxios calls v4 for multipart boundaries. This narrows the observed call path; it does not prove all dependency consumers safe. | Patched uuid starts at 11.1.1. The parent requires the older major; review parent upgrades or a tested major override before changing it. |
| Firebase CLI / superstatic optional re2 1.24.1; development | Four moderate RE2 advisories affect the installed version. The latest required patch across them is [1.26.1](https://github.com/advisories/GHSA-j4r3-hg7j-8chg). Native regex failures remain relevant to local tooling; no application route imports RE2. | Registry versions 1.26.1 and 1.27.0 require Node `^22.22.2 || ^24.15.0 || >=26.0.0`, exceeding our documented 22.13 minimum. Propose the Node support change first, then update the optional dependency and verify native loading/emulators. BSD-3-Clause; releases remain active. |
| Firebase CLI / proxy-agent / pac-proxy-agent / get-uri / basic-ftp 5.3.1; development | [Quadratic FTP listing parser](https://github.com/advisories/GHSA-c475-qrg2-pj4r); patched at 6.2.1. CLI proxy/URI handling introduces the package; application APIs do not use it directly. | get-uri currently requires basic-ftp 5.x. Moving to the fixed 6.x is a major dependency change requiring compatibility review. |
| Next ESLint plugin / fast-glob / micromatch / braces, and Firebase CLI / chokidar / braces 3.0.3; development | [Nested glob pattern stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Build/lint/file-watching paths consume glob patterns; this review has not established hostile-input reachability. | Advisory lists no patched braces version. Track upstream fixes; do not treat npm's proposed Next ESLint 14.x downgrade as a compatible repair for Next 16. |
| Firebase CLI / Google Cloud PubSub / OpenTelemetry core 1.30.1; development | [Unbounded W3C baggage allocation](https://github.com/advisories/GHSA-8988-4f7v-96qf), fixed in 2.8.0. No direct application import of this CLI dependency. | Fixed core is a different major. Review a compatible parent release rather than silently replacing its internals. |

`npm audit` proposes older Firebase CLI 14.23.0 and Next ESLint 14.2.35 in
several chains. These are cross-major downgrades, not reviewed patch fixes.
No forced audit fix, package override, lockfile change or host runtime upgrade
was applied. Development findings still matter to contributor and CI processes.

## Pending decision and validation

The user has been asked whether to raise supported tooling Node versions and
update RE2. Until answered, package.json and README retain the existing runtime
contract. If approved, pin the fixed dependency, update setup/CI/runtime images
as appropriate, verify a clean install on a supported runtime, then run the full
unit, rules/API, PostgreSQL, lint, typecheck and build checks. Refresh both audits
afterward and report remaining findings without claiming they disappeared.

Other remediation remains open pending compatible upstream fixes or explicitly
reviewed major changes. Repository licensing, browser/two-user acceptance and
live deployment are separate release gates.
