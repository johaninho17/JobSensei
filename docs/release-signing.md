# Signing and notarizing the macOS app

A downloaded Mac app opens without warnings only when it is signed with a **Developer ID Application** certificate and **notarized** by Apple. An "Apple Development" certificate is not enough; it only works on your own devices.

The build is already configured (`package.json` → `build.mac`: hardened runtime, `build-config/entitlements.mac.plist`, `notarize: true`). It only needs credentials. Without them, builds are ad-hoc signed (`scripts/adhoc-sign-mac.cjs`) and users click **Open Anyway** once.

## One-time setup (account owner)
1. Join the Apple Developer Program (paid, yearly) with the account that will publish the app.
2. In Xcode → Settings → Accounts → Manage Certificates, add a **Developer ID Application** certificate. Export it from Keychain Access as a `.p12` with a password.
3. Create an app-specific password at appleid.apple.com (Sign-In and Security → App-Specific Passwords).
4. Note your 10-character Team ID (developer.apple.com → Membership).

## Local release build
`npm run dist:mac` turns off certificate auto-discovery, so a personal "Apple Development" certificate is never used by accident. Name the Developer ID certificate explicitly and set the notarization variables in your shell (never in a tracked file):

```bash
export CSC_NAME="Developer ID Application: <Your Name> (<TEAMID>)"
export APPLE_ID="you@example.com" APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" APPLE_TEAM_ID="ABCDE12345"
npx electron-builder --mac
```

Check the result: `spctl --assess --type execute -vv release/mac-arm64/JobSensei.app` should say `accepted` and `source=Notarized Developer ID`.

## GitHub release workflow
Add these repository secrets (Settings → Secrets and variables → Actions): `MAC_CERT_P12_BASE64` (the `.p12`, base64-encoded: `base64 -i cert.p12 | pbcopy`), `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Pushing a `v*` tag then builds, signs, notarizes, and publishes.
