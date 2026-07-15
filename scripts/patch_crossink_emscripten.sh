#!/usr/bin/env bash
# Apply CrossInk source tweaks needed for Emscripten libc++.
# - CssParser: Emscripten libc++ lacks std::from_chars for floating point.
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
import re

path = Path(sys.argv[1])
text = path.read_text()

# Always rewrite tryParseNumber to a known-good Emscripten-safe form.
# (Previous patch left from_chars outside if-constexpr, still instantiated for float.)

pattern = re.compile(
    r"// Parse the entirety of s as a number into `out`\..*?"
    r"template <typename T>\n"
    r"bool tryParseNumber\(std::string_view s, T& out\) \{\n"
    r".*?\n"
    r"\}\n",
    re.DOTALL,
)

replacement = r'''// Parse the entirety of s as a number into `out`. Accepts an optional leading
// '+' (which std::from_chars rejects by spec) so callers can pass CSS-style
// signed numbers without manual trimming. Returns false on empty input, a
// non-numeric suffix, or any from_chars error.
// WEBINK_FROM_CHARS_FLOAT_FALLBACK: Emscripten libc++ has no float from_chars;
// use strtof/strtod. Keep from_chars only on the non-float branch so it is not
// instantiated for float (if-constexpr alone is not enough if code follows it).
template <typename T>
bool tryParseNumber(std::string_view s, T& out) {
  const char* begin = s.data();
  const char* end = s.data() + s.size();
  if (begin < end && *begin == '+') ++begin;
  if (begin == end) return false;
#if defined(__EMSCRIPTEN__)
  if constexpr (std::is_floating_point_v<T>) {
    char buf[64];
    const size_t n = static_cast<size_t>(end - begin);
    if (n == 0 || n >= sizeof(buf)) return false;
    memcpy(buf, begin, n);
    buf[n] = '\0';
    char* stop = nullptr;
    errno = 0;
    if constexpr (std::is_same_v<T, float>) {
      out = std::strtof(buf, &stop);
    } else {
      out = static_cast<T>(std::strtod(buf, &stop));
    }
    return errno == 0 && stop == buf + n;
  } else {
    const auto r = std::from_chars(begin, end, out);
    return r.ec == std::errc{} && r.ptr == end;
  }
#else
  const auto r = std::from_chars(begin, end, out);
  return r.ec == std::errc{} && r.ptr == end;
#endif
}
'''

m = pattern.search(text)
if not m:
    print("ERROR: tryParseNumber block not found", file=sys.stderr)
    raise SystemExit(1)

text = text[: m.start()] + replacement + text[m.end() :]

# Ensure required headers once
needed = [
    ("#include <charconv>", True),
    ("#include <cerrno>", False),
    ("#include <cstdlib>", False),
    ("#include <cstring>", False),
    ("#include <type_traits>", False),
]
for inc, _ in needed:
    if inc not in text:
        text = text.replace("#include <charconv>", "#include <charconv>\n" + inc, 1)
        if "#include <charconv>" not in text:
            # insert after first include block
            text = text.replace('#include "CssParser.h"\n', '#include "CssParser.h"\n' + inc + "\n", 1)

# Deduplicate includes
lines = text.splitlines(True)
seen = set()
out = []
for line in lines:
    if line.startswith("#include"):
        if line in seen:
            continue
        seen.add(line)
    out.append(line)
path.write_text("".join(out))
print("patched CssParser.cpp (Emscripten-safe tryParseNumber)")
PY

# ---------------------------------------------------------------------------
# ActivityManager: under Emscripten, render on the main "thread" instead of a
# FreeRTOS fiber. ASYNCIFY + emscripten_async_call rarely runs the render task
# while the SDL main loop owns the stack — Home stays stuck on BootActivity.
# ---------------------------------------------------------------------------
AM="$ROOT/vendor/CrossInk/src/activities/ActivityManager.cpp"
python3 - <<'PY' "$AM"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
marker = "WEBINK_SYNC_RENDER"
if marker in text:
    print("ActivityManager already has sync render patch")
    raise SystemExit(0)

old_begin = """void ActivityManager::begin() {
  xTaskCreatePinnedToCore(&renderTaskTrampoline, "ActivityManagerRender",
                          16384,  // Stack size - createSectionFile() puts ChapterHtmlSlimParser on stack during
                                  // silentIndexNextChapterIfNeeded
                          this,   // Parameters
                          1,      // Priority
                          &renderTaskHandle,  // Task handle
                          0                   // Pin to core 0 (PRO_CPU)
  );
  assert(renderTaskHandle != nullptr && "Failed to create render task");
}"""

new_begin = """void ActivityManager::begin() {
#if defined(__EMSCRIPTEN__) || defined(WEBINK)
  // WEBINK_SYNC_RENDER: no background FreeRTOS render task in the browser.
  renderTaskHandle = nullptr;
#else
  xTaskCreatePinnedToCore(&renderTaskTrampoline, "ActivityManagerRender",
                          16384,  // Stack size - createSectionFile() puts ChapterHtmlSlimParser on stack during
                                  // silentIndexNextChapterIfNeeded
                          this,   // Parameters
                          1,      // Priority
                          &renderTaskHandle,  // Task handle
                          0                   // Pin to core 0 (PRO_CPU)
  );
  assert(renderTaskHandle != nullptr && "Failed to create render task");
#endif
}"""

if old_begin not in text:
    print("ERROR: ActivityManager::begin pattern not found", file=sys.stderr)
    raise SystemExit(1)
text = text.replace(old_begin, new_begin, 1)

old_req = """void ActivityManager::requestUpdate(bool immediate) {
  if (immediate) {
    if (renderTaskHandle) {
      xTaskNotify(renderTaskHandle, 1, eIncrement);
    }
  } else {
    // Deferring the update until current loop is finished
    // This is to avoid multiple updates being requested in the same loop
    requestedUpdate = true;
  }
}"""

new_req = """void ActivityManager::requestUpdate(bool immediate) {
#if defined(__EMSCRIPTEN__) || defined(WEBINK)
  // WEBINK_SYNC_RENDER: paint on the caller (browser main loop) so Home replaces Boot.
  if (immediate) {
    if (currentActivity) {
      RenderLock lock;
      HalPowerManager::Lock powerLock;
      currentActivity->render(std::move(lock));
    }
  } else {
    requestedUpdate = true;
  }
#else
  if (immediate) {
    if (renderTaskHandle) {
      xTaskNotify(renderTaskHandle, 1, eIncrement);
    }
  } else {
    // Deferring the update until current loop is finished
    // This is to avoid multiple updates being requested in the same loop
    requestedUpdate = true;
  }
#endif
}"""

if old_req not in text:
    print("ERROR: ActivityManager::requestUpdate pattern not found", file=sys.stderr)
    raise SystemExit(1)
text = text.replace(old_req, new_req, 1)

old_flush = """  if (requestedUpdate.exchange(false)) {
    // Using direct notification to signal the render task to update
    // Increment counter so multiple rapid calls won't be lost
    if (renderTaskHandle) {
      xTaskNotify(renderTaskHandle, 1, eIncrement);
    }
  }
}"""

new_flush = """  if (requestedUpdate.exchange(false)) {
#if defined(__EMSCRIPTEN__) || defined(WEBINK)
    // WEBINK_SYNC_RENDER
    if (currentActivity) {
      RenderLock lock;
      HalPowerManager::Lock powerLock;
      currentActivity->render(std::move(lock));
    }
#else
    // Using direct notification to signal the render task to update
    // Increment counter so multiple rapid calls won't be lost
    if (renderTaskHandle) {
      xTaskNotify(renderTaskHandle, 1, eIncrement);
    }
#endif
  }
}"""

if old_flush not in text:
    print("ERROR: ActivityManager requestedUpdate flush pattern not found", file=sys.stderr)
    raise SystemExit(1)
text = text.replace(old_flush, new_flush, 1)

old_wait = """RequestUpdateResult ActivityManager::requestUpdateAndWait() {
  if (!renderTaskHandle) {
    return RequestUpdateResult::Rejected;
  }"""

new_wait = """RequestUpdateResult ActivityManager::requestUpdateAndWait() {
#if defined(__EMSCRIPTEN__) || defined(WEBINK)
  // WEBINK_SYNC_RENDER
  if (currentActivity) {
    RenderLock lock;
    HalPowerManager::Lock powerLock;
    currentActivity->render(std::move(lock));
  }
  return RequestUpdateResult::Rendered;
#else
  if (!renderTaskHandle) {
    return RequestUpdateResult::Rejected;
  }"""

if old_wait not in text:
    print("ERROR: requestUpdateAndWait start pattern not found", file=sys.stderr)
    raise SystemExit(1)
text = text.replace(old_wait, new_wait, 1)

# Close the #else branch before the next function
# Find end of requestUpdateAndWait - return RequestUpdateResult::Rendered; then }
old_end = """  xTaskNotify(renderTaskHandle, 1, eIncrement);
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
  return RequestUpdateResult::Rendered;
}

// RenderLock"""

new_end = """  xTaskNotify(renderTaskHandle, 1, eIncrement);
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
  return RequestUpdateResult::Rendered;
#endif
}

// RenderLock"""

if old_end not in text:
    print("ERROR: requestUpdateAndWait end pattern not found", file=sys.stderr)
    raise SystemExit(1)
text = text.replace(old_end, new_end, 1)

path.write_text(text)
print("patched ActivityManager.cpp (WEBINK_SYNC_RENDER)")
PY
