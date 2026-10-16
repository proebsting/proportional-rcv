#!/bin/sh
# Copies the published site into OUTDIR, tagging each script's URL with VERSION (for example
# a commit id) so that, right after a deploy, a browser can't combine the new page with old
# cached scripts. Used by .github/workflows/pages.yml and by tests/site.test.js.
#
#   sh scripts/build-site.sh OUTDIR VERSION
set -eu
out=$1
version=$2
case "$out" in
  '' | . | ./ | .. | ../ | / | /*/.. ) echo "build-site: refusing to replace '$out'" >&2; exit 1 ;;
esac
case "$version" in
  '' | *[!A-Za-z0-9._-]*) echo "build-site: bad version '$version'" >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."
rm -rf "$out"
mkdir -p "$out"
cp -r engine.js examples.js vendor "$out"/
sed -E "s#(<script src=\"(engine|examples|vendor/d3\.min)\.js)\"#\1?v=$version\"#" index.html > "$out/index.html"
tagged=$(grep -c "?v=$version\"" "$out/index.html" || true)
if [ "$tagged" -ne 3 ]; then
  echo "build-site: expected 3 tagged scripts in index.html, found $tagged" >&2
  exit 1
fi
