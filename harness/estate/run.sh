# Run inside playwright:v1.48.2-jammy with the repo at /src and /out writable:
#   bash /src/harness/estate/run.sh
# Scenario A: root resolves. Scenario B (NOROOT=1): the root alias 404s.
set -e
cd /src
mkdir -p /out
npm ci --no-audit --no-fund --ignore-scripts >/out/npmci.log 2>&1
npm run build > /out/build.log 2>&1; echo BUILD_RC=$? >> /out/build.log
printf '{"defaultHomeserver":0,"homeserverList":["127.0.0.1:8080"],"allowCustomHomeservers":true,"featuredCommunities":{"spaces":["#gamecult:test"],"rooms":[],"servers":["test"]},"hashRouter":{"enabled":true,"basename":"/"}}' > dist/config.json
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.48.2 >/out/pw.log 2>&1
cp /src/harness/estate/drive.cjs /tmp/pw/
runone () { # tag noroot
  HSLOG=/out/hslog-$1.txt NOROOT=$2 node /src/harness/estate/fakehs.cjs /src/dist > /out/hs-$1.out 2>&1 &
  HS=$!
  sleep 2
  TAG=$1 NOROOT=$2 node /tmp/pw/drive.cjs; echo "DRIVE $1 RC=$?"
  kill $HS
}
runone root 0
runone noroot 1
for t in root noroot; do
  echo "=== $t"
  grep -E '^(SMALL|layout|has Create|CLICK|POLL|timeout|after arrival|revealed|--- )' /out/$t-timeline.txt | cut -c1-1800 || true
done
echo "=== m.direct and joins (root)"
grep -E 'direct|JOIN' /out/hslog-root.txt | cut -c1-220 || true
tail -1 /out/build.log
