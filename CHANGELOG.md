# Changelog

All notable changes to this project are documented here.

## [0.2.1] - 2026-09-01

### Compatibility

- Publicly document support for official DSH `0.1.2-alpha.3` at commit
  `dd6322d604e00eec1ba5e0c8541159906a21094a` while retaining verified support
  for DSH `0.1.2-alpha.2` and `0.1.1-rc.2`.
- Move the package's DSH development dependencies to `0.1.2-alpha.3`, so the
  release verification exercises the newly advertised host version.
- Runtime plugin behavior is unchanged from `0.2.0`.

## [0.1.1] - 2026-08-31

### Changed

- Correct the intended release version to `0.1.1`. Runtime behavior is unchanged
  from `0.1.0`, including the recommended Claude/Codex plugin cards and default
  Recommended plugins tab.
- The verified DSH baseline remains `0.1.1-rc.2`; this release does not add
  compatibility with the DSH `0.1.2-alpha.2` client APIs.

## [0.1.0] - 2026-08-31

### Added

- The Settings > Plugins tab now gives each recommended plugin a self-contained
  card headed by its npm package name, carrying its purpose, prerequisite, the
  complete Chat message that installs it, and its post-install check.

### Changed

- The Settings > Plugins help tab is now named "Recommended plugins" and sorts
  ahead of the built-in tabs, so it is the tab Settings > Plugins opens on.
- The tab's copy is condensed and rescoped. Tab-level text claims nothing about
  a specific plugin; anything true of one plugin lives on that plugin's card.
  The former heading, introduction, standalone confirmation notice, and
  search/remove/list example table are gone.
- The discovery example no longer names a specific third-party integration.

### Compatibility

- This release retains the verified DSH `0.1.1-rc.2` baseline. It does not include
  migration to the client APIs introduced in DSH `0.1.2-alpha.2`.

## [0.1.0-rc.4] - 2026-08-28

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
[0.1.0-rc.4]: https://github.com/yangbobo2021/relay-dsh-plugin-manager/compare/v0.1.0-rc.3...v0.1.0-rc.4
[0.1.0]: https://github.com/yangbobo2021/relay-dsh-plugin-manager/compare/v0.1.0-rc.4...v0.1.0
[0.1.1]: https://github.com/yangbobo2021/relay-dsh-plugin-manager/compare/v0.1.0...v0.1.1
