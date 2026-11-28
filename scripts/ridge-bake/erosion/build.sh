#!/bin/sh
# Build the erosion helper into erosion/out. CULTLIB_DIR must be a CultLib checkout at the commit in CULTMATH_PIN.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${CULTLIB_DIR:?CULTLIB_DIR must name a CultLib checkout at the commit in CULTMATH_PIN}"
pin=$(cat "$here/CULTMATH_PIN"); head=$(git -c safe.directory='*' -C "$CULTLIB_DIR" rev-parse HEAD)
[ "$head" = "$pin" ] || { echo "CultLib at $head, the pin is $pin: refusing" >&2; exit 1; }
sha=$(cd "$here" && cat RidgeErosion.csproj ErosionFilter.cs Program.cs | sha256sum | cut -d' ' -f1)
export CULTLIB_DIR
dotnet publish "$here/RidgeErosion.csproj" -c Release -o "$here/out" -p:CultMathCommit="$pin" -p:SourceSha256="$sha" -nologo
