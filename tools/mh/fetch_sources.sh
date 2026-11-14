#!/bin/sh
# Re-download the CC0 MakeHuman source assets listed in sources/SOURCES.md and verify their SHA-256 hashes.
# Offline build only (the game never fetches these). Usage: sh tools/mh/fetch_sources.sh
set -e
cd "$(dirname "$0")/sources"
BASE=https://raw.githubusercontent.com/makehumancommunity/makehuman/master
M=$BASE/makehuman/data
get() { curl -fsSL -o "$1" "$2"; }
mkdir -p targets
get base.obj $M/3dobjs/base.obj
get default.mhskel $M/rigs/default.mhskel
get default_weights.mhw $M/rigs/default_weights.mhw
for t in caucasian-male-young universal-male-young-maxmuscle-averageweight universal-male-young-averagemuscle-minweight universal-male-young-maxmuscle-minweight; do
  get targets/$t.target $M/targets/macrodetails/$t.target
done
for t in averagemuscle-averageweight averagemuscle-minweight maxmuscle-averageweight maxmuscle-minweight; do
  get targets/male-young-$t-idealproportions.target $M/targets/macrodetails/proportions/male-young-$t-idealproportions.target
done
mkdir -p poseunits
get poseunits/face-poseunits.bvh $M/poseunits/face-poseunits.bvh
get poseunits/face-poseunits.json $M/poseunits/face-poseunits.json
get LICENSE.ASSETS.md $BASE/LICENSE.ASSETS.md
get LICENSE.makehuman.md $BASE/LICENSE.md
grep -E '^\| `' SOURCES.md | awk -F'|' '{gsub(/[` ]/,"",$2); gsub(/ /,"",$4); print $4"  "$2}' | sha256sum -c -
