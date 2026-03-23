# Privacy and Metadata Consistency Worksheet

Use this worksheet before every App Store submission. Every row must be verified
against the signed App Store build, not `tauri dev`.

| User-facing claim | Source surface | Actual runtime behavior | App Store Connect field | Verified by | Status |
| --- | --- | --- | --- | --- | --- |
| Local generation runs on-device | About panel / loading copy |  | Description / screenshots / review notes |  | TODO |
| Local helper uses authenticated loopback only | About panel / review notes |  | Review notes / privacy answers |  | TODO |
| No account required | UI / review notes |  | Description / review notes |  | TODO |
| Voice cloning requires user rights confirmation | Clone flow |  | Description / review notes |  | TODO |
| Export formats available: WAV / MP3 / AAC | UI / settings / export flow |  | Description / screenshots |  | TODO |
| App stores local data in app support/container paths | About/help copy |  | Privacy policy |  | TODO |
| Network entitlement is used only for local loopback helper traffic | Entitlements / runtime architecture |  | Privacy policy / review notes |  | TODO |
| Privacy policy URL is public and current | In-app link / metadata |  | Privacy Policy URL |  | TODO |
| Support URL/contact is public and current | In-app help / metadata |  | Support URL |  | TODO |
| Screenshots match the shipping App Store build | App Store assets |  | Screenshots / previews |  | TODO |
| Subtitle and description avoid roadmap/beta language | App Store metadata |  | Description / subtitle |  | TODO |
| Age rating and category match actual app capabilities | App Store metadata |  | Age rating / category |  | TODO |

## Foundry Vox reviewer-risk reminders

- Do not use broader privacy language in metadata than the binary can support.
- If `com.apple.security.network.client` remains present, ensure the copy
  explains that it exists for app-internal local loopback.
- Verify all “offline”, “private”, “local”, and “on-device” claims against the
  signed App Store build.
- Verify the live public pages match:
  - [`docs/privacy-policy.md`](/Users/rob/Claude/vox/docs/privacy-policy.md)
  - [`docs/support.md`](/Users/rob/Claude/vox/docs/support.md)
