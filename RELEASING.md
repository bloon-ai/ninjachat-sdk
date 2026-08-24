# Releasing the NinjaChat SDK

The TypeScript and Python packages ship together under one semantic version. Releases are published from GitHub Actions with short-lived OIDC credentials; do not create or add npm or PyPI write tokens.

## Prepare a release

Start from an up-to-date `main` branch with a green CI run. Choose a version that has never been published to either registry.

Update the version in all of these files:

- `package.json`
- `packages/typescript/package.json`
- `packages/typescript/package-lock.json`
- `packages/python/pyproject.toml`
- `packages/python/ninjachat/__init__.py`

The npm package and lockfile can be updated together:

```bash
npm version 0.1.1 --prefix packages/typescript --no-git-tag-version
```

Then update the remaining files to the same version and run the release checks:

```bash
npm ci --prefix packages/typescript
npm run verify

python3 -m venv .venv
. .venv/bin/activate
python -m pip install --disable-pip-version-check build twine
python -m pip install -e packages/python
python -m unittest discover -s packages/python/tests -t packages/python
python -m build packages/python
python -m twine check packages/python/dist/*

git diff --check
```

`npm run verify` rejects mismatched package versions or generated clients that do not match the committed OpenAPI contract.

## Publish

Commit the version change and merge it to `main`. After the `main` CI run is green, create an annotated tag on that exact commit:

```bash
git switch main
git pull --ff-only
git tag -a v0.1.1 -m "NinjaChat SDK v0.1.1"
git push origin v0.1.1
```

Pushing `vX.Y.Z` starts `.github/workflows/release.yml`. The workflow verifies that the tag matches both package versions, rebuilds and tests both SDKs, uploads short-lived immutable build artifacts, and then publishes those exact artifacts from isolated OIDC jobs that do not install dependencies or execute package build hooks:

- `@ninjachat/sdk` to npm through the `npm` GitHub environment
- `ninjachat` to PyPI through the `pypi` GitHub environment

All third-party actions are pinned to immutable commit SHAs. Dependabot proposes reviewed SHA updates; do not replace pins with mutable version tags.

Watch the Release workflow until all three jobs are green. Afterward, verify the public packages from clean environments:

```bash
npm install @ninjachat/sdk@0.1.1
python -m pip install ninjachat==0.1.1
```

Create the matching GitHub Release from the tag once both registries are healthy.

## Failure recovery

- Registry versions are immutable. Never move a published tag or try to overwrite an npm or PyPI version.
- For a transient registry or network failure, rerun the failed GitHub Actions jobs.
- If either registry accepted the version, any code change requires a new version and tag.
- If publishing authentication fails, check the repository, workflow filename, and GitHub environment against the trusted-publisher settings. Do not work around OIDC by adding a long-lived write token.

Current registry pages:

- npm: <https://www.npmjs.com/package/@ninjachat/sdk>
- PyPI: <https://pypi.org/project/ninjachat/>
