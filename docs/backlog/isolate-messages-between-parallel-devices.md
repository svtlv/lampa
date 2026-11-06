---
worth: yes
where: "Lampa device/session messaging and account synchronization"
added: 2026-11-06
---
# Isolate device-local messages during parallel Lampa use

## Reported problem

The owner reports that, with Lampa used on two devices in parallel, some
messages originating from one device appear on the other. Fix the incorrect
cross-device delivery/display. This is a user-reported bug, not yet independently
reproduced: the exact message type, triggering action, client versions and
account/session arrangement still need to be captured. Do not assume a
cross-user security breach or a particular transport is already proven.

## Investigation and intended fix

- Reproduce with two distinct device/browser profiles. Record whether they use
  the same account, different accounts or guest mode, and distinguish transient
  UI notifications, playback/status events, remote commands and intentionally
  shared account notices. Use non-sensitive, clearly labeled test messages.
- Trace a message from its originating action to the receiving UI. Check actual
  upstream/CUB socket or message routing, any shared device identifier, add-on
  event handling, account sync and storage scope, as applicable. These are
  starting points, not established causes. Inspect `app.min.js`,
  `svtlv/account-sync.js`, `svtlv/account.js` and
  `svtlv/storage-scope.json` where the trace leads.
- Define the intended scope for each affected message. Keep device/session-local
  events and transient UI state out of account-wide synchronization or
  indiscriminate broadcasts. Preserve explicitly intended account-wide notices,
  settings, favorites and other existing shared-data behavior.
- Bind targeted delivery and asynchronous callbacks to the correct device,
  session and authenticated account where relevant. Do not treat an arbitrary
  client-supplied device ID as authorization. Ignore stale events after account
  changes, logout, reconnect or a superseded operation; clean up subscriptions.
- Do not change all notifications to device-local or disable account sync as a
  blanket workaround. Preserve local player/endpoint selection and the separate
  removal of shared TorrServer playback timecodes.

## Acceptance and regression checks

- Demonstrate the reported failure before the fix using the affected message
  type, then prove that an action on device A does not display its device-local
  message on B, and vice versa, during simultaneous activity/playback.
- Cover same-account clients, different accounts and guests; reload/reconnect,
  duplicate connections/subscriptions, logout/account switching, delayed
  responses and overlapping operations. Same-browser multi-tab checks may
  supplement but must not replace two-device verification.
- Keep intentional account sharing/notices working, without another device's
  playback controls, progress or active TorrServer link being overwritten.
- Add targeted automated routing/scope/callback regressions appropriate to the
  discovered path; retain ES5/public-API constraints for add-ons and existing
  account-sync/ownership coverage. Verify manually on the actual browser/TV
  combination before declaring the user-visible bug fixed.

The existing [cross-link torrent ownership item](share-torrents-between-torrserver-links.md)
is separate: this item concerns message isolation, not combining membership
lists. See also [parallel-use resource and configuration investigation](parallel-playback-resource-peaks-and-configuration.md).

Backlog only: no implementation, successful reproduction or deployment is
claimed by adding this item.

## Investigation findings — November 6, 2026

**Status: investigated; the owner's exact event is not yet reproduced.** Message type, triggering action, client versions and same/different account arrangement remain unknown. No cross-user breach is established. No fix, deployment or configuration change was made.

### Evidence
- Compared deployed revision `be26ded19991468b312d87b9593d84cb8c88f0ba` with current `43693da786a1333e5550a3e790332c920668717d`: the audited bundle, account-sync, account UI and storage policy are byte-identical. The actual bundle URL/cache and remote plugins loaded by each device remain unverified. Anchors below apply to both revisions.
- **Receiver-side trust boundary (not a proven misrouting cause):** `app.min.js:24933-25038` dispatches incoming socket methods without a general recipient/account/connection-generation check. `open` directly opens an activity (24945-24947); `other/play` shows a confirmation prompt (25008-25033). The explicit Broadcast sender chooses a target using `device.uid` (25156-25194). An offline VM running the actual dispatcher accepts a deliberately misdelivered synthetic frame on B despite an A target marker. **This proves receiver behavior, not that CUB actually misroutes frames; the real incoming recipient-envelope contract must be captured before choosing an exact guard.** Server target UID and local `device_id` must not be assumed interchangeable.
- **Shared CUB login, distinct runtime device identity:** `svtlv/storage-scope.json:4-6,272,346` intentionally synchronizes the complete CUB login/profile object. Actual `applyDoc` (`svtlv/account-sync.js:492-524`) copies that synthetic object unchanged, but leaves local identity and endpoint selection untouched. Socket `_uid` is generated per runtime (`app.min.js:24879`); sends attach that ID and the current CUB account (`25064-25077`). CUB account notices use token/profile authentication and `notice/all` (`18070-18084,18143-18157,18913-18966`), so matching account/profile legitimately shares feed identity. Whether copied tokens affect upstream device routing is unverified.
- **Additional confirmed asynchronous defects, not proven incident causes:** queued socket payloads are resent with the then-current account (`25040-25047,25070-25077`); the offline harness reproduces an old queued action acquiring the replacement account. Generic `Event` reuses a callback ID for each method (`54696-54730`); an old reply can invoke the newer operation's callback.
- **Noty is local:** `app.min.js:3252-3282` updates local DOM/timers; there is no generic notification broadcast in that implementation. Notice/cache fields and generated identities are excluded from Svtlv synchronization. Remote plugin overrides remain outside this investigation.

### Related shared-server mechanism
The parallel-use investigation also traced a different way one device can affect another: file-dialog close and discovery timeout issue a hash-wide TorrServer drop (`app.min.js:41233-41253,41690-41705`; server `apihelper.go:233-235`). For the same torrent, this can invalidate the other client's shared server object and plausibly produce its own local error rather than forward a message. The code path is verified, but the owner's reported message and a real two-viewer interruption remain untested. Treat this as an additional hypothesis; see the companion performance item.

### Offline check actually run
A small deterministic Node VM harness executed verbatim source slices with mocked sockets/storage/UI and synthetic data, against current and deployed bundles; no network or user data was used. Characterization exited **0**, confirming distinct runtime IDs, acceptance of a misdelivered open/play frame, old queued action acquiring the new account, stale reply invoking the newer callback, and account-object import preserving B's local identity/selector. A conditional receiver-isolation assertion exited **1** (`wrong-target frame must not open on B`, actual 1, expected 0). This is a red-capable boundary test, **not a reproduction of the owner's unknown message or a verified production protocol regression**.

### Proposed design and next tests — not implemented
1. First classify the actual message with two consented devices and a clearly labeled synthetic trigger. Record producer, method, app revision, same/different Svtlv and CUB account/profile flags and opaque correlation metadata only; do not capture tokens/private content.
2. Separate local UI/operation errors, explicitly targeted remote commands, intended account/profile notices and global announcements. Preserve authorized Broadcast and account sharing; do not blanket-disable sockets, notifications or synchronization.
3. At the verified routing seam, authorize target delivery server-side and validate available recipient/session metadata before client UI dispatch. If upstream strips recipient metadata, address the protocol rather than inventing a client UID comparison. A client-supplied device ID is not authorization.
4. Fence queued actions and callbacks by account/profile/connection generation, discard stale work after identity changes, and issue a fresh correlation ID per invocation. Test old-socket events, reconnect/duplicate subscriptions, offline queues, logout/account switches and delayed/duplicate replies.
5. Verify same-account clients, different accounts and guests in both directions; retain account/global notices and explicit remote sharing. Preserve local players/device identities/active endpoint selectors, intended shared settings/favorites and the separate removal of shared TorrServer timecodes. Finish with the owner's real browser/TV combination before claiming the reported bug fixed.
