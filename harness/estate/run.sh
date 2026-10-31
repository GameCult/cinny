#!/usr/bin/env bash
# Runs inside mcr.microsoft.com/playwright:v1.48.2-jammy with the repo at /src:
# builds the client, then drives the direct-message and join-failure scenarios against fakehs.cjs.
set -e
cd /src
npm ci --no-audit --no-fund --ignore-scripts >/tmp/npmci.log 2>&1 || { tail -20 /tmp/npmci.log; exit 1; }
npm run build > /tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }
echo BUILD_OK $(git rev-parse HEAD)
printf '{"defaultHomeserver":0,"homeserverList":["127.0.0.1:8080"],"allowCustomHomeservers":true,"featuredCommunities":{"spaces":["#gamecult:test"],"rooms":[],"servers":["test"]},"hashRouter":{"enabled":true,"basename":"/"}}' > dist/config.json
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.48.2 >/tmp/pw.log 2>&1
cp /src/harness/estate/drive.cjs /src/harness/estate/drive-failures.cjs /tmp/pw/
set +e
for m in twodm reload convert; do
  HSLOG=/tmp/hslog-$m.txt NOROOT=0 node /src/harness/estate/fakehs.cjs /src/dist > /tmp/hs-$m.out 2>&1 &
  HS=$!; sleep 2
  MODE=$m node /tmp/pw/drive.cjs; echo "DRIVE $m RC=$?"
  kill $HS; sleep 1
  echo "=== hs $m"; grep -E "MDIRECT_PUT|DELIVER|STATE_" /tmp/hs-$m.out; grep -E " JOIN " /tmp/hslog-$m.txt
done
failure() { m=$1; shift
  env "$@" HSLOG=/tmp/hslog-$m.txt NOROOT=0 node /src/harness/estate/fakehs.cjs /src/dist > /tmp/hs-$m.out 2>&1 &
  HS=$!; sleep 2
  MODE=$m node /tmp/pw/drive-failures.cjs; echo "DRIVE $m RC=$?"
  kill $HS; sleep 1
  echo "=== hs $m"; grep -E "MDIRECT|DELIVER|JOIN_|STATE_" /tmp/hs-$m.out; grep -E " JOIN " /tmp/hslog-$m.txt; }
failure pjfail FAIL_MDIRECT=1
failure pjreload DELAY_MDIRECT=1
failure jdrop JOIN_DROP=1
failure admin INVITER_ADMIN=1
failure inboxadmin INVITER_ADMIN=1
failure inboxreload JOIN_DELAY=1
echo DONE
