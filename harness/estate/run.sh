# Run inside playwright:v1.48.2-jammy with the repo at /src and /out writable:
#   bash /src/harness/estate/run.sh
set -e
cd /src
mkdir -p /out
npm ci --no-audit --no-fund --ignore-scripts >/out/npmci.log 2>&1
npm run build > /out/build.log 2>&1; echo BUILD_RC=$? >> /out/build.log
printf '{"defaultHomeserver":0,"homeserverList":["127.0.0.1:8080"],"allowCustomHomeservers":true,"featuredCommunities":{"spaces":["#gamecult:test"],"rooms":[],"servers":["test"]},"hashRouter":{"enabled":true,"basename":"/"}}' > dist/config.json
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.48.2 >/out/pw.log 2>&1
cp /src/harness/estate/drive.cjs /tmp/pw/
HSLOG=/out/hslog.txt node /src/harness/estate/fakehs.cjs /src/dist > /out/hs.out 2>&1 &
HS=$!
sleep 2
node /tmp/pw/drive.cjs; echo DRIVE_RC=$?
kill $HS
