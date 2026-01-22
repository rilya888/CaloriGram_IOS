# CaloriGram Legal Documents

This directory contains the legal documents for CaloriGram iOS app.

## Files

- `index.html` - Main landing page with links to legal documents
- `privacy-policy.html` - Privacy Policy (Политика конфиденциальности)
- `terms-of-service.html` - Terms of Service (Условия использования)

## GitHub Pages Setup

To enable GitHub Pages for this repository:

1. Go to repository settings: https://github.com/rilya888/CaloriGram_IOS/settings/pages
2. Under "Source", select "Deploy from a branch"
3. Select branch: `main` (or `master`)
4. Select folder: `/docs`
5. Click "Save"

After setup, your pages will be available at:
- Main page: https://rilya888.github.io/CaloriGram_IOS/
- Privacy Policy: https://rilya888.github.io/CaloriGram_IOS/privacy-policy.html
- Terms of Service: https://rilya888.github.io/CaloriGram_IOS/terms-of-service.html

## Updating URLs in App

After GitHub Pages is set up, update the URLs in `Sources/Calorigram/Utils/Constants.swift`:

```swift
struct Legal {
    static let privacyPolicyURL = "https://rilya888.github.io/CaloriGram_IOS/privacy-policy.html"
    static let termsOfServiceURL = "https://rilya888.github.io/CaloriGram_IOS/terms-of-service.html"
}
```

Also add the Privacy Policy URL in App Store Connect:
- Go to App Store Connect → Your App → App Information
- Add Privacy Policy URL: `https://rilya888.github.io/CaloriGram_IOS/privacy-policy.html`
