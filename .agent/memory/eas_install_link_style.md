---
name: eas-install-link-style
description: Give iPad operators the EAS build-details page, never the raw IPA artifact URL.
type: preference
created: 2026-08-23
updated: 2026-08-23
---

For CaptainPad internal-distribution builds, the operator-facing install link
must use this shape:

```text
https://expo.dev/accounts/<account>/projects/CaptainPad/builds/<build-id>
```

Do not present the `expo.dev/artifacts/eas/*.ipa` URL as the primary install
link.

**Why:** The build-details page provides EAS's **Install on a test device**
flow and QR code. Opening the raw IPA only downloads a file that iPadOS offers
to other apps; it does not invoke installation.

**How to apply:** After a successful EAS build, return the build-details page
URL printed by EAS. Tell the operator to open it in Safari or scan its Install
QR code with the iPad Camera, then tap **Install**. Keep concrete account names,
build IDs, artifact tokens, device identifiers, and signing details out of
tracked memory.
