# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [1.0.2] - 2026-03-15

### Added

- Added a live npm version badge under the README title so the displayed package version tracks npm automatically.

## [1.0.1] - 2026-03-15

### Added

- Added repository, homepage, and issue tracker metadata so npm links back to GitHub correctly.
- Added React to the documented list of supported platforms.
- Added the project logo to the README.

### Changed

- Moved `fileName` into `SourceProvider`.
- Clarified `MediaSources` type documentation.
- Refined repository housekeeping with `.gitignore` updates.
- Simplified README copyright attribution.

## [1.0.0] - 2026-03-15

### Added

- Initial public release of `grabit-engine`.
- Plugin-based media scraping engine for streams and subtitles.
- Provider loading from GitHub repositories, local files, and in-memory registries.
- Built-in caching, health tracking, retries, auto-disable logic, auto-updates, concurrency controls, and targeted provider execution.
- Support for Node.js, browsers, React, and React Native.
- CLI utilities for creating, bundling, and testing providers.
- Jest coverage for manager behavior, provider sources, services, and utility helpers.
