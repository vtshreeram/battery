# Release integrity follow-up

`update.sh` and `setup.sh` still download Battery King from the `main` branch. That branch can move, so a production update should not trust it as the only source of a release.

Recommended next step, without changing the current update command:

1. Publish the CLI script, `dist/smc`, and the Electron app from a git tag or GitHub release.
2. Ship a checksum file next to those assets.
3. Make `update.sh` download the tagged asset into a temp directory, verify the checksum, then install over the current files.
4. Keep the existing staged install: validate the download before replacing `/usr/local/co.palokaj.battery/battery`.

The current updater already refuses an empty download and a file that is not the battery script. It does not yet pin a tag or verify a signature.
