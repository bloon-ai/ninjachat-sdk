# Contributing

Thanks for improving the NinjaChat SDK.

1. Open an issue for substantial API changes before implementation.
2. Keep the TypeScript and Python clients aligned with `openapi/openapi.json`.
3. Add or update a package-level test for behavior changes.
4. Run the verification commands documented below before opening a pull request.

```bash
npm install --prefix packages/typescript
npm run verify --prefix packages/typescript

python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e packages/python
python -m unittest discover -s packages/python/tests -t packages/python
```

Do not commit API keys, credentials, generated build directories, or real customer payloads.
