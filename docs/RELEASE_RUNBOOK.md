# Release runbook — v0.1.0

CI workflow and README badge are already committed (`3ce7f5e`). Run these in order
from the repo root, then **delete this file** after the release is cut.

```bash
# 1. Commit the release docs (notes + this runbook)
git add docs/RELEASE_NOTES_v0.1.0.md docs/RELEASE_RUNBOOK.md
git commit -m "docs: add v0.1.0 release notes"

# 2. Push main (CI badge goes green when the workflow passes)
git push origin main

# 3. Create the annotated release tag
git tag -a v0.1.0 -m "Context Transfer v0.1.0 — first public release"
git push origin v0.1.0

# 4. Create the GitHub Release with the notes
gh release create v0.1.0 \
  --title "v0.1.0 — First public release" \
  --notes-file docs/RELEASE_NOTES_v0.1.0.md
```

## Later: attaching a signed .dmg

Requires a **Developer ID Application** cert (paid Apple Developer Program) and notarization
credentials. Then, from a machine with both:

```bash
SIGN_IDENTITY="Developer ID Application: <your name>" ./Scripts/build-app.sh
ditto -c -k --keepParent ".build/app/Context Transfer.app" "Context Transfer.dmg"
xcrun notarytool submit "Context Transfer.dmg" --keychain-profile "notary" --wait
xcrun stapler staple ".build/app/Context Transfer.app"
gh release upload v0.1.0 "Context Transfer.dmg"
```
