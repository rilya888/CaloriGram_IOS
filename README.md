# CaloriGram Legal Documents

This directory contains the legal documents for CaloriGram iOS app.

## Files

- `index.html` - Main landing page with links to legal documents
- `privacy-policy.html` - Privacy Policy (English) - **Main version for App Store**
- `privacy-policy-ru.html` - Privacy Policy (Russian)
- `terms-of-service.html` - Terms of Service (English) - **Main version for App Store**
- `terms-of-service-ru.html` - Terms of Service (Russian)

## Language Support

All documents are available in English and Russian. Each page includes a language switcher to change between languages.

**For App Store Connect**, use the English versions:
- Privacy Policy: `privacy-policy.html`
- Terms of Service: `terms-of-service.html`

## GitHub Pages Setup

To enable GitHub Pages for this repository:

1. Go to repository settings: https://github.com/rilya888/CaloriGram_IOS/settings/pages
2. Under "Source", select "Deploy from a branch"
3. Select branch: `main` (or `master`)
4. Select folder: `/ (root)` (since files are in root) or `/docs` (if you move files to docs folder)
5. Click "Save"

After setup, your pages will be available at:

- Main page: https://rilya888.github.io/CaloriGram_IOS/
- Privacy Policy (English): https://rilya888.github.io/CaloriGram_IOS/privacy-policy.html
- Privacy Policy (Russian): https://rilya888.github.io/CaloriGram_IOS/privacy-policy-ru.html
- Terms of Service (English): https://rilya888.github.io/CaloriGram_IOS/terms-of-service.html
- Terms of Service (Russian): https://rilya888.github.io/CaloriGram_IOS/terms-of-service-ru.html

## Updating URLs in App

After GitHub Pages is set up, the URLs in `Sources/Calorigram/Utils/Constants.swift` are already configured:

```swift
struct Legal {
    static let privacyPolicyURL = "https://rilya888.github.io/CaloriGram_IOS/privacy-policy.html"
    static let termsOfServiceURL = "https://rilya888.github.io/CaloriGram_IOS/terms-of-service.html"
}
```

## App Store Connect

Add the Privacy Policy URL in App Store Connect:

- Go to App Store Connect → Your App → App Information
- Add Privacy Policy URL: `https://rilya888.github.io/CaloriGram_IOS/privacy-policy.html`

**Note:** Use the English version (`privacy-policy.html`) for App Store Connect, as English is the standard language for international apps.
