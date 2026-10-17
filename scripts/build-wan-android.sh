#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_COMMIT="e31a86ce9110b11a98bd5990c329093244c2d1e3"
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SOURCE_ROOT="${SAIENT_SD_CPP_SOURCE:-/home/tiny/projects/stable-diffusion.cpp}"
readonly NDK_ROOT="${SAIENT_ANDROID_NDK:-/usr/lib/android-sdk/ndk/27.1.12297006}"
readonly BUILD_ROOT="$SOURCE_ROOT/build-android-vulkan"
readonly VULKAN_HPP_ROOT="$BUILD_ROOT/host-vulkan-hpp"
readonly OUTPUT="$PROJECT_ROOT/engine/arm64-v8a/libquartz-wan.so"
readonly FAST_OUTPUT="$PROJECT_ROOT/engine/arm64-v8a/libquartz-wan-fast.so"
readonly PATCH_FILE="$PROJECT_ROOT/engine/wan/saient-progress.patch"
readonly SERVER_PATCH_FILE="$PROJECT_ROOT/engine/wan/saient-server-progress.patch"

test -d "$SOURCE_ROOT/.git" || { echo "Missing stable-diffusion.cpp clone: $SOURCE_ROOT" >&2; exit 1; }
test -f "$NDK_ROOT/build/cmake/android.toolchain.cmake" || { echo "Missing Android NDK: $NDK_ROOT" >&2; exit 1; }

actual_commit="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
test "$actual_commit" = "$EXPECTED_COMMIT" || {
  echo "stable-diffusion.cpp is $actual_commit; expected $EXPECTED_COMMIT" >&2
  exit 1
}

# Keep the existing CLI/shared low-memory patch as the compatibility path.
if ! rg -q 'SAIENT_WAN_PROGRESS' "$SOURCE_ROOT/examples/cli/main.cpp"; then
  git -C "$SOURCE_ROOT" apply "$PATCH_FILE"
fi

# The persistent server needs the same newline-delimited progress signal, but
# its patch touches only examples/server/main.cpp so the shared ggml patch above
# remains applied exactly once.
if ! rg -q 'SAIENT_WAN_PROGRESS' "$SOURCE_ROOT/examples/server/main.cpp"; then
  git -C "$SOURCE_ROOT" apply "$SERVER_PATCH_FILE"
fi

# The NDK ships Vulkan's C headers and loader but not the matching C++ wrapper
# required by ggml-vulkan. Stage only the version-matched *.hpp files; their C
# includes continue to resolve from the NDK sysroot.
mkdir -p "$VULKAN_HPP_ROOT/vulkan"
cp /usr/include/vulkan/*.hpp "$VULKAN_HPP_ROOT/vulkan/"
cp -a /usr/include/spirv "$VULKAN_HPP_ROOT/"

cmake -S "$SOURCE_ROOT" -B "$BUILD_ROOT" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$NDK_ROOT/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-28 \
  -DANDROID_STL=c++_static \
  -DCMAKE_CXX_FLAGS="-I$VULKAN_HPP_ROOT" \
  -DSPIRV-Headers_DIR=/usr/share/cmake/SPIRV-Headers \
  -DGGML_OPENMP=OFF \
  -DSD_VULKAN=ON \
  -DSD_WEBP=ON \
  -DSD_WEBM=ON \
  -DSD_SERVER_BUILD_FRONTEND=OFF

cmake --build "$BUILD_ROOT" --target sd-cli --parallel "${SAIENT_BUILD_JOBS:-4}"
cmake --build "$BUILD_ROOT" --target sd-server --parallel "${SAIENT_BUILD_JOBS:-4}"

mkdir -p "$(dirname "$OUTPUT")"
cp "$BUILD_ROOT/bin/sd-cli" "$OUTPUT"
cp "$BUILD_ROOT/bin/sd-server" "$FAST_OUTPUT"

readonly STRIP="$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"
for artifact in "$OUTPUT" "$FAST_OUTPUT"; do
  "$STRIP" --strip-unneeded "$artifact"
  chmod 0755 "$artifact"
  file "$artifact"
  readelf -h "$artifact" | rg 'Class:|Machine:|Type:'
  readelf -d "$artifact" | rg 'NEEDED|SONAME' || true
  sha256sum "$artifact"
done
