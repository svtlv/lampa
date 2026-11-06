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
