# Changelog

All notable changes to this project are documented here.

## Unreleased

### Added

- GitHub owner discovery with exact-owner ranking, actionable owner-only inspect
  errors, and round-trippable repository identities.
- Plugin-owned DSH choice confirmation that validates the exact plan answer and
  executes without requiring a duplicate typed confirmation.
- One-plan, one-confirmation multi-plugin installation with serial child
  outcomes and required peer-dependency preflight.
- Explicit restart-required and manual-restart operation terminal states.

### Changed

- Confirmed plugin operations now queue in FIFO order instead of failing while
  another mutation is active.

## [0.1.0-rc.3] - 2026-08-26

### Added

- Read-only Plugin Marketplace help under Settings > Plugins.
- Localized Chat examples for discovery, installation, removal, and inventory.
- Packed client-bundle and browser UI acceptance coverage.
- English and Chinese quick-start documentation for standalone DSH, KeySync,
  and the wider Relay DSH plugin catalog.

## [0.1.0-rc.2] - 2026-08-26

### Changed

- Add npm discovery keywords, including the canonical `dsh-plugin` keyword.
- Put the verified install command and first conversation examples above the
  fold in the README.
- Add npm, CI, and DSH ecosystem badges to make release and compatibility
  status visible from the repository and npm package pages.

## [0.1.0-rc.1] - 2026-08-26

### Added

- Conversation-first DSH plugin discovery and lifecycle management.
- One `/plugins` command and two model tools.
- npm and GitHub discovery with immutable install-source resolution.
- Confirmed install, remove, update, enable, disable, and restart operations.
- Loader HMR verification, restart fallbacks, rollback, and operation tracking.
- Versioned search-provider extension registry.
- Unit, integration, package E2E, and opt-in live Codex acceptance coverage.

[0.1.0-rc.1]: https://github.com/yangbobo2021/relay-dsh-plugin-manager/releases/tag/v0.1.0-rc.1
[0.1.0-rc.2]: https://github.com/yangbobo2021/relay-dsh-plugin-manager/releases/tag/v0.1.0-rc.2
[0.1.0-rc.3]: https://github.com/yangbobo2021/relay-dsh-plugin-manager/compare/v0.1.0-rc.2...v0.1.0-rc.3
