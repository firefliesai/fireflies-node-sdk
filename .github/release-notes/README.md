# Release notes

Merging a version bump to `main` publishes it: `release.yml` publishes the
package to npm (trusted publishing, with provenance), then creates the `vX.Y.Z`
tag and GitHub release. The same tarball also goes to GitHub Packages in a
separate job that does not gate the release.

Every version bump needs a notes file here, named after the version
(`1.3.0.md`). CI fails the pull request without one.

- **Line 1:** `# vX.Y.Z — Short title`. It becomes the release title and is removed from the body.
- **Body:** Markdown. Use `1.2.1.md` as the template: a short Highlights section, then Fixes.
  The workflow appends the Full Changelog link and the pull request links.
