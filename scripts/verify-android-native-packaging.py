#!/usr/bin/env python3
"""Check a release APK or bundletool .apks archive before uploading to Play.

Usage: python3 scripts/verify-android-native-packaging.py release.apks --aapt2 /path/to/aapt2
Generate .apks from the release AAB with bundletool build-apks first. This checks
the actual APKs delivered by Play, not just the Gradle source configuration.
"""

import argparse
import io
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path


def verify_apk(data, name, aapt2):
    with zipfile.ZipFile(io.BytesIO(data)) as apk:
        libraries = [entry for entry in apk.infolist()
                     if entry.filename.startswith("lib/") and entry.filename.endswith(".so")]
        if not libraries:
            return 0
        abis = {entry.filename.split("/")[1] for entry in libraries}
        for abi in abis:
            for library in ("libreactnative.so", "libhermes.so", "libappmodules.so"):
                if f"lib/{abi}/{library}" not in apk.namelist():
                    raise ValueError(f"{name}: missing {library} for {abi}")
        for entry in libraries:
            if entry.compress_type != zipfile.ZIP_DEFLATED:
                raise ValueError(f"{name}: {entry.filename} is not compressed for install-time extraction")

    with tempfile.TemporaryDirectory(prefix="rutawater-packaging-") as directory:
        path = Path(directory) / "check.apk"
        path.write_bytes(data)
        manifest = subprocess.check_output(
            [aapt2, "dump", "xmltree", str(path), "--file", "AndroidManifest.xml"],
            text=True,
        )
    if not re.search(r"extractNativeLibs[^\n]*=true\b", manifest):
        raise ValueError(f"{name}: manifest does not enable native library extraction")
    print(f"PASS {name}: {len(libraries)} native libraries, install-time extraction enabled")
    return len(libraries)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--aapt2", required=True)
    args = parser.parse_args()
    if args.artifact.suffix == ".apk":
        count = verify_apk(args.artifact.read_bytes(), args.artifact.name, args.aapt2)
    elif args.artifact.suffix == ".apks":
        with zipfile.ZipFile(args.artifact) as archive:
            count = sum(verify_apk(archive.read(name), name, args.aapt2)
                        for name in archive.namelist() if name.endswith(".apk"))
    else:
        parser.error("expected .apk or bundletool .apks (generate APKs from the AAB first)")
    if count == 0:
        raise ValueError("No native libraries found in artifact")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        raise SystemExit(f"FAIL: {error}") from error
