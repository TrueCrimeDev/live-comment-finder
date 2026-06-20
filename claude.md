# CLAUDE.md — Live Comment Finder Chrome Extension

## Role

Act as a senior Chrome Extension engineer, TypeScript developer, UI designer, and test engineer. Build the complete extension described below. Do not stop at planning or scaffolding; implement, test, and document a working product.

## Product Goal

Create a Chrome extension named **Live Comment Finder** that captures comments from a live chat or dynamically updating comment feed and lets the user search previously captured comments in real time.

Interpret “live comments” as DOM-rendered messages that appear dynamically on the current webpage.

The extension must:

- Capture comments already visible when monitoring starts.
- Capture new comments as they are added.
- Preserve captured comments even after the website removes them from the DOM.
- Let users search by comment text, author, or both.
- Keep all captured data on the user’s device.
- Never send comments, usernames, or browsing data to an external service.

## Default Scope

When the repository does not specify a particular platform:

1. Support **YouTube Live Chat** as the primary site adapter.
2. Provide a **generic feed adapter** that lets the user select a comment-feed container on other websites.
3. Structure the code so adapters for Twitch, Facebook Live, Instagram Live, or other platforms can be added without modifying the search engine or user interface.

Do not use undocumented APIs, private endpoints, authentication-token extraction, or automated interaction with the target website. Read only content rendered in the page.

## Technology Requirements

Use:

- Chrome Extension Manifest V3
- TypeScript with strict mode enabled
- A Chrome side panel as the main interface
- A background service worker
- Content scripts for DOM monitoring
- `MutationObserver` rather than frequent DOM polling
- Local Chrome storage only for settings
- A modern, minimal build system
- Automated unit tests for parsing, deduplication, filtering, and search
- ESLint and formatting configuration

Use React only when it materially improves maintainability. Avoid unnecessary dependencies and large UI frameworks.

Pin dependency versions and ensure the unpacked extension can be loaded from the generated build directory.

## Core User Experience

### Opening the extension

When the user clicks the extension toolbar icon:

1. Open the extension side panel.
2. Determine whether the active page is supported.
3. Display one of these states:
   - Connected and capturing
   - Paused
   - Unsupported page
   - Feed not found
   - Permission required
4. Begin monitoring automatically when a supported feed is detected.

For unsupported pages, offer a **Select Comment Feed** action that lets the user click a feed container on the page.

### Search interface

The side panel must include:

- A prominent search input
- An optional author filter
- A result count
- A captured-comment count
- A connection and capture-status indicator
- Pause or resume control
- Clear-history control
- Search options for:
  - Case-sensitive search
  - Whole-word search
  - Exact-phrase search
  - Regular expressions
- A button to clear all filters
- Export controls for JSON and CSV

Search should update as the user types and must not require an Enter key press.

Invalid regular expressions must produce an inline validation message rather than an exception.

### Search results

Each result must display:

- Author name
- Comment text
- Displayed message timestamp when available
- Local capture time
- Source site
- Match highlighting
- A copy-comment action

Selecting a result must:

1. Ask the content script to locate the original message.
2. Scroll it into view when it still exists.
3. Apply a temporary, accessible highlight.
4. Avoid permanently changing the webpage.

When the site has virtualized or removed the message, retain the captured result and display:

> This comment is no longer present in the page, but its captured text is still available.

### Keyboard behavior

Support:

- `/` or `Ctrl/Cmd + F` while the side panel is focused to focus the search field
- Arrow-key result navigation
- Enter to locate the selected result
- Escape to clear the active search or close transient controls

Do not override browser shortcuts outside the extension interface.

## Comment Data Model

Use a shared typed model similar to:

    interface CapturedComment {
      id: string;
      source: string;
      tabId?: number;
      frameId?: number;
      author: string;
      text: string;
      displayedTimestamp?: string;
      capturedAt: number;
      locator?: CommentLocator;
      metadata?: Record<string, string | number | boolean>;
    }

A locator may contain adapter-specific information but must not contain a raw DOM element.

Maintain a runtime map from comment IDs to currently mounted elements when useful.

Normalize text without destroying the original value. Preserve emoji, non-Latin characters, punctuation, and line breaks.

## Capture and Storage Behavior

### Capture rules

For every supported feed:

- Parse visible comments when the adapter starts.
- Observe only the smallest practical feed container.
- Process added nodes in batches.
- Ignore unrelated DOM mutations.
- Capture a comment before the website’s virtualization removes it.
- Clean up observers when monitoring stops or navigation changes.
- Handle single-page application navigation.
- Avoid registering duplicate observers.

### Deduplication

Prevent duplicate results caused by:

- DOM nodes being moved
- Re-renders
- Reconnection
- Repeated observer notifications
- Multiple matching descendant nodes

Prefer a platform-provided message ID. When none exists, generate a stable fingerprint from source, author, text, timestamp, and nearby identifying data.

Do not incorrectly collapse two legitimate users posting the same message. Include sufficient context or a bounded time component in fallback fingerprints.

### Retention

Use a per-tab in-memory ring buffer:

- Default maximum: 10,000 comments
- User-configurable maximum: 1,000 to 50,000
- Remove oldest comments first
- Persist user settings, but do not persist comment content across browser restarts unless an explicit opt-in setting is later added

The content script should retain its captured history so the side panel can request a snapshot after being opened or reconnected.

Design communication so temporary suspension of the Manifest V3 service worker does not erase the content script’s active capture history.

## Adapter Architecture

Define a stable adapter interface, for example:

    interface LiveCommentAdapter {
      id: string;
      canHandle(context: AdapterContext): boolean | Promise<boolean>;
      locateFeed(context: AdapterContext): Element | null | Promise<Element | null>;
      parseComment(node: Node, context: AdapterContext): ParsedComment[];
      locateComment?(locator: CommentLocator, context: AdapterContext): Element | null;
      start?(): void | Promise<void>;
      stop?(): void | Promise<void>;
    }

Keep these responsibilities separate:

- Site detection
- Feed-container discovery
- DOM parsing
- Data normalization
- Deduplication
- Search
- UI
- Chrome message passing

Centralize platform selectors in their adapter. Document selectors and parsing assumptions so site changes can be repaired locally.

### YouTube Live Chat adapter

Account for the fact that YouTube live chat may be rendered in an iframe.

The implementation must:

- Run the relevant content script in matching frames.
- Capture author names and message text.
- Handle text spans, links, emoji images, and mixed-content messages.
- Use accessible text or emoji alt text when appropriate.
- Avoid interpreting moderation controls or system UI as comments.
- Support locating and highlighting a message while its DOM node remains mounted.

Do not depend on private YouTube APIs.

### Generic adapter

Provide an element-selection mode:

1. Activate a temporary page overlay.
2. Highlight the element under the pointer.
3. Let the user select the live-feed container.
4. Let the user cancel with Escape.
5. Remove all selection overlays and listeners after selection or cancellation.

After selection:

- Observe the selected container.
- Detect repeated message-like child structures.
- Prefer semantic attributes such as roles, labels, timestamps, and repeated DOM patterns.
- Allow the user to specify or adjust selectors for:
  - Comment item
  - Author
  - Comment text
  - Timestamp
- Store generic adapter settings per hostname.

Never use `innerHTML` to render captured page content in the extension.

## Extension Architecture

Use clear, typed modules for:

- Manifest and extension configuration
- Background service worker
- Side-panel interface
- Content-script bootstrap
- Adapter registry
- Site adapters
- Generic element picker
- Comment extraction
- Deduplication
- Search and filtering
- Shared message contracts
- Settings
- Export utilities
- Tests

Create discriminated-union message types for communication between the side panel, service worker, and content scripts.

Messages should cover at least:

- Start capture
- Pause capture
- Resume capture
- Stop capture
- Request snapshot
- New comment batch
- Capture status
- Locate comment
- Clear captured history
- Begin generic element selection
- Selection completed
- Error state

Validate incoming message shapes before using them.

The side panel must correctly switch context when the active tab changes.

## Search Requirements

Search over normalized author and comment fields.

Implement:

- Case-insensitive substring search by default
- Case-sensitive mode
- Whole-word mode using Unicode-aware boundaries where practical
- Exact-phrase mode
- Regular-expression mode with error handling
- Author filtering
- Combined author-and-text filtering
- Newest-first and oldest-first sorting

Precompute normalized searchable values during capture rather than repeatedly normalizing every comment on each keystroke.

Debounce input lightly while keeping the interface responsive.

For large result sets, use windowing, incremental rendering, or another strategy that avoids rendering thousands of result nodes simultaneously.

Search 10,000 captured comments without visibly freezing the side panel.

## Privacy and Security

Follow least-privilege principles.

- Request only permissions required by implemented features.
- Prefer `activeTab` and narrowly scoped host permissions.
- Explain any requested host permissions in the README.
- Do not use `<all_urls>` unless the generic adapter cannot work without it and permission is requested explicitly at runtime.
- Do not include analytics, telemetry, advertising, tracking, or remote logging.
- Do not transmit captured data.
- Do not execute remote code.
- Do not use `eval`, `new Function`, or unsafe HTML injection.
- Render all captured values as text.
- Apply a restrictive extension Content Security Policy.
- Avoid exposing page data to unrelated extension contexts.
- Remove page listeners, observers, overlays, and temporary styles during cleanup.

Log only development diagnostics, never full comment content by default.

## Accessibility and Visual Design

The side panel should be compact, readable, and usable at narrow widths.

Include:

- Proper form labels
- Visible focus states
- Sufficient color contrast
- ARIA status announcements for connection changes and result counts
- Keyboard-accessible controls
- Non-color-only status indicators
- Reduced-motion support
- Light and dark theme support based on browser or system preferences

Use a clean visual hierarchy. Do not imitate the branding of supported sites.

Temporary page highlighting must remain visible in both light and dark page themes.

## Error Handling

Handle these cases without crashing:

- No active tab
- Restricted Chrome pages
- Missing permissions
- Unsupported websites
- Feed not yet loaded
- Feed replaced during navigation
- Detached iframe
- Closed tab
- Side-panel reconnection
- Invalid selectors
- Invalid regular expressions
- Malformed messages
- Storage quota errors
- Export failure

Show actionable, user-readable errors. Keep detailed diagnostic information in development logs without exposing sensitive page content.

## Demo and Testing

Create a local demo page that:

- Simulates a live-comment feed
- Adds comments at configurable intervals
- Repeats some authors and phrases
- Includes emoji and international text
- Simulates DOM virtualization by removing older nodes
- Includes duplicate mutation scenarios
- Provides start, pause, burst, and reset controls

Write automated tests for:

- Parsing standard comments
- Parsing nested text and emoji
- Stable deduplication
- Legitimate repeated comments
- Text normalization
- Case-sensitive and insensitive matching
- Exact phrases
- Whole words
- Unicode text
- Regular expressions and invalid patterns
- Author filters
- Combined filters
- Ring-buffer eviction
- CSV escaping
- JSON export
- Typed message validation

Where practical, add an integration test that loads the built extension against the demo page and verifies capture, search, and locate behavior.

Do not make automated tests depend on the current production DOM of third-party websites. Use fixtures representing expected adapter structures.

## Documentation

Create a user-facing `README.md` containing:

- Product overview
- Feature list
- Supported sites
- Privacy statement
- Installation from a release
- Loading the unpacked development build
- Build, lint, and test commands
- How to use search
- How to select a generic comment feed
- Permission explanations
- Known limitations
- Troubleshooting
- Adapter-development guide

Document that third-party websites may change their DOM and adapters may require updates.

Include a concise adapter guide explaining how to:

1. Add detection logic.
2. Locate a feed.
3. Parse messages.
4. generate stable locators.
5. Add fixtures.
6. Add tests.
7. Register the adapter.

## Repository and Code Quality Rules

Before editing:

1. Inspect the existing repository and follow its package manager and conventions.
2. Preserve useful existing code.
3. Identify any conflicting requirements.
4. State a concise implementation plan.

During implementation:

- Prefer small, focused modules.
- Use descriptive names.
- Keep strict TypeScript types.
- Avoid `any`; justify unavoidable uses.
- Add comments only where behavior is not self-evident.
- Do not leave placeholder implementations or unexplained TODOs.
- Do not silently swallow errors.
- Keep site-specific logic out of shared modules.
- Update documentation whenever behavior changes.

Do not stop after producing a plan. Complete the implementation.

## Required Deliverables

Produce:

- A valid Manifest V3 extension
- Build configuration
- Side-panel UI
- Background service worker
- Content scripts
- YouTube Live Chat adapter
- Generic feed adapter and element picker
- Search engine and filters
- Comment locating and temporary highlighting
- Local settings
- JSON and CSV export
- Demo live-feed page
- Unit tests
- Linting and formatting configuration
- Complete README
- Any necessary icons created specifically for this project

## Acceptance Criteria

The implementation is complete only when all of the following are true:

1. The project installs dependencies without unresolved errors.
2. Linting succeeds.
3. Type checking succeeds.
4. Automated tests succeed.
5. A production build succeeds.
6. The build directory can be loaded as an unpacked Chrome extension.
7. Opening the extension on the demo page starts capturing comments.
8. Existing and newly added comments are searchable.
9. Comments remain searchable after the demo removes their DOM nodes.
10. Author, phrase, case, whole-word, and regex filters work.
11. Duplicate DOM notifications do not produce duplicate results.
12. Selecting a mounted result scrolls to and highlights it.
13. Selecting an unmounted result produces a clear fallback message.
14. Pause, resume, clear, JSON export, and CSV export work.
15. Generic feed selection can be completed and cancelled cleanly.
16. The interface is keyboard accessible.
17. No comment content is sent over the network.
18. The extension requests no unexplained permissions.
19. There are no placeholder screens, empty handlers, or unimplemented core requirements.
20. Test and build results are reported honestly.

## Final Response Format

After implementation, report:

1. What was built
2. Important architecture decisions
3. Files added or changed
4. Commands executed
5. Test, lint, type-check, and build results
6. How to load and use the extension
7. Known limitations or adapter assumptions

Never claim a command passed unless it was actually run successfully.
