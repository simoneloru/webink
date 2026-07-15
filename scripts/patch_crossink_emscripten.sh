#!/usr/bin/env bash
# Apply CrossInk source tweaks needed for Emscripten libc++.
# - CssParser: Emscripten libc++ often lacks std::from_chars for floating point.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSS="$ROOT/vendor/CrossInk/lib/Epub/Epub/css/CssParser.cpp"

if [[ ! -f "$CSS" ]]; then
  echo "error: missing $CSS (submodules?)" >&2
  exit 1
fi

python3 - <<'PY' "$CSS"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
if "WEBINK_FROM_CHARS_FLOAT_FALLBACK" in text:
    print("CssParser.cpp already patched")
    raise SystemExit(0)

old = '''// Parse the entirety of s as a number into `out`. Accepts an optional leading
// '+' (which std::from_chars rejects by spec) so callers can pass CSS-style
// signed numbers without manual trimming. Returns false on empty input, a
// non-numeric suffix, or any from_chars error.
template <typename T>
bool tryParseNumber(std::string_view s, T& out) {
  const char* begin = s.data();
  const char* end = s.data() + s.size();
  if (begin < end && *begin == '+') ++begin;
  const auto r = std::from_chars(begin, end, out);
  return r.ec == std::errc{} && r.ptr == end;
}'''

new = '''// Parse the entirety of s as a number into `out`. Accepts an optional leading
// '+' (which std::from_chars rejects by spec) so callers can pass CSS-style
// signed numbers without manual trimming. Returns false on empty input, a
// non-numeric suffix, or any from_chars error.
// WEBINK_FROM_CHARS_FLOAT_FALLBACK: Emscripten libc++ may not provide
// std::from_chars for float/double; use strtof/strtod there.
template <typename T>
bool tryParseNumber(std::string_view s, T& out) {
  const char* begin = s.data();
  const char* end = s.data() + s.size();
  if (begin < end && *begin == '+') ++begin;
  if (begin == end) return false;
#if defined(__EMSCRIPTEN__)
  if constexpr (std::is_floating_point_v<T>) {
    // Copy to NUL-terminated buffer for strto* (string_view is not always
    // terminated; CSS tokens here are substrings of larger strings).
    char buf[64];
    const size_t n = static_cast<size_t>(end - begin);
    if (n == 0 || n >= sizeof(buf)) return false;
    memcpy(buf, begin, n);
    buf[n] = '\\0';
    char* stop = nullptr;
    errno = 0;
    if constexpr (std::is_same_v<T, float>) {
      out = std::strtof(buf, &stop);
    } else {
      out = static_cast<T>(std::strtod(buf, &stop));
    }
    return errno == 0 && stop == buf + n;
  }
#endif
  const auto r = std::from_chars(begin, end, out);
  return r.ec == std::errc{} && r.ptr == end;
}'''

if old not in text:
    print("ERROR: CssParser tryParseNumber pattern not found", file=sys.stderr)
    raise SystemExit(1)

# Ensure includes for fallback
if "#include <cerrno>" not in text:
    text = text.replace("#include <charconv>", "#include <charconv>\n#include <cerrno>\n#include <cstdlib>\n#include <cstring>\n#include <type_traits>", 1)
elif "#include <type_traits>" not in text:
    text = text.replace("#include <charconv>", "#include <charconv>\n#include <type_traits>", 1)

path.write_text(text.replace(old, new, 1))
print("patched CssParser.cpp for Emscripten from_chars float")
PY
