#!/usr/bin/env bash
# Throwaway Synapse probe for the Persona file zone (album) shape. Never touches the live server.
set -u
D=/tmp/imag-zone-probe; NAME=imag-zone-probe; IMG=matrixdotorg/synapse:v1.164.1; PORT=18999
docker rm -f $NAME >/dev/null 2>&1; rm -rf $D; mkdir -p $D/data
docker run --rm -v $D/data:/data -e SYNAPSE_SERVER_NAME=probe.test -e SYNAPSE_REPORT_STATS=no $IMG generate >/dev/null 2>&1 || { echo "generate failed"; exit 1; }
printf 'enable_registration: false\nregistration_shared_secret: "probe-only-secret"\n' >> $D/data/homeserver.yaml
docker run -d --name $NAME -p 127.0.0.1:$PORT:8008 -v $D/data:/data $IMG >/dev/null
for i in $(seq 60); do curl -fs http://127.0.0.1:$PORT/health >/dev/null && break; sleep 1; done
docker exec $NAME register_new_matrix_user -u aqua -p probe-pass -a -k probe-only-secret http://localhost:8008 >/dev/null 2>&1
HS=http://127.0.0.1:$PORT
TOK=$(curl -s -XPOST $HS/_matrix/client/v3/login -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"aqua"},"password":"probe-pass"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
A="Authorization: Bearer $TOK"
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1', d))"; }
echo "versions has v1.11: $(curl -s $HS/_matrix/client/versions | grep -c v1.11)"
grep -n "max_upload_size\|enable_authenticated_media" $D/data/homeserver.yaml || echo "max_upload_size: default (not in generated config)"
ROOM=$(curl -s -XPOST -H "$A" $HS/_matrix/client/v3/createRoom -d '{"name":"aqua files","room_alias_name":"files-aqua"}' | j room_id); echo "room $ROOM"
head -c 300000 /dev/urandom > $D/a.wav
MXC=$(curl -s -XPOST -H "$A" -H 'Content-Type: audio/wav' --data-binary @$D/a.wav "$HS/_matrix/media/v3/upload?filename=a.wav" | j content_uri); echo "upload v3: $MXC"
echo "upload v1 path: $(curl -s -o /dev/null -w '%{http_code}' -XPOST -H "$A" -H 'Content-Type: audio/wav' --data-binary @$D/a.wav "$HS/_matrix/client/v1/media/upload?filename=a.wav")"
R=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$ROOM")
ROOT=$(curl -s -XPUT -H "$A" "$HS/_matrix/client/v3/rooms/$R/send/m.room.message/req1-root" -d '{"msgtype":"m.text","body":"Album thruster-v3: 1 audio","org.gamecult.album":{"name":"thruster-v3","digest":"x","files":1,"follows":null}}' | j event_id); echo "root $ROOT"
ROOT2=$(curl -s -XPUT -H "$A" "$HS/_matrix/client/v3/rooms/$R/send/m.room.message/req1-root" -d '{"msgtype":"m.text","body":"Album thruster-v3: 1 audio"}' | j event_id); echo "same txn again -> $ROOT2 (same id means idempotent)"
REP=$(curl -s -XPUT -H "$A" "$HS/_matrix/client/v3/rooms/$R/send/m.room.message/req1-0" -d "{\"msgtype\":\"m.audio\",\"body\":\"a.wav\",\"filename\":\"a.wav\",\"url\":\"$MXC\",\"info\":{\"mimetype\":\"audio/wav\",\"size\":300000},\"m.relates_to\":{\"rel_type\":\"m.thread\",\"event_id\":\"$ROOT\",\"is_falling_back\":true,\"m.in_reply_to\":{\"event_id\":\"$ROOT\"}}}"); echo "thread reply: $REP"
REF=$(curl -s -XPUT -H "$A" "$HS/_matrix/client/v3/rooms/$R/send/m.room.message/req2-root" -d "{\"msgtype\":\"m.text\",\"body\":\"Album v4\",\"m.relates_to\":{\"rel_type\":\"m.reference\",\"event_id\":\"$ROOT\"}}" | j event_id); echo "root with m.reference: $REF"
echo "thread off a root that has a relation: $(curl -s -XPUT -H "$A" "$HS/_matrix/client/v3/rooms/$R/send/m.room.message/req2-0" -d "{\"msgtype\":\"m.text\",\"body\":\"f\",\"m.relates_to\":{\"rel_type\":\"m.thread\",\"event_id\":\"$REF\"}}")"
MID=${MXC#mxc://}
echo "auth download v1 with token: $(curl -s -o /dev/null -w '%{http_code}' -H "$A" $HS/_matrix/client/v1/media/download/$MID)"
echo "auth download v1 no token: $(curl -s -o /dev/null -w '%{http_code}' $HS/_matrix/client/v1/media/download/$MID)"
echo "range request v1: $(curl -s -o /dev/null -w '%{http_code} %{size_download}' -H "$A" -H 'Range: bytes=0-99' $HS/_matrix/client/v1/media/download/$MID)"
echo "threads list: $(curl -s -H "$A" "$HS/_matrix/client/v1/rooms/$R/threads" | python3 -c 'import sys,json;d=json.load(sys.stdin);print([(e["event_id"]==sys.argv[1], e["unsigned"].get("m.relations",{}).get("m.thread",{}).get("count")) for e in d["chunk"]])' "$ROOT")"
head -c 60000000 /dev/zero > $D/big.bin
echo "60MB upload: $(curl -s -w ' %{http_code}' -XPOST -H "$A" -H 'Content-Type: application/octet-stream' --data-binary @$D/big.bin "$HS/_matrix/media/v3/upload?filename=big.bin" | tail -c 160)"
docker rm -f $NAME >/dev/null; sudo -n rm -rf $D 2>/dev/null || rm -rf $D; echo "cleaned"
