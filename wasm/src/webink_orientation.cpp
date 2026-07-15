// WebInk: map browser/device screen orientation onto CrossInk SETTINGS.orientation.
// Applied from the Wasm main loop (not directly from JS) so FreeRTOS locks stay safe.

#include "activities/Activity.h"
#include "activities/ActivityManager.h"
#include "CrossPointSettings.h"
#include "GfxRenderer.h"
#include "Logging.h"
#include "activities/reader/ReaderUtils.h"

#include <atomic>
#include <cstdint>
#include <string>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

extern GfxRenderer renderer;
extern ActivityManager activityManager;

namespace {

// -1 = none pending. Values match CrossPointSettings::ORIENTATION.
std::atomic<int> g_pendingOrientation{-1};
int g_lastApplied = -1;

void applyOrientationNow(const uint8_t orientation) {
  if (orientation >= CrossPointSettings::ORIENTATION_COUNT) {
    return;
  }

  const auto target = ReaderUtils::toRendererOrientation(orientation);
  const bool settingsChanged = SETTINGS.orientation != orientation;
  const bool rendererChanged = renderer.getOrientation() != target;
  if (!settingsChanged && !rendererChanged) {
    g_lastApplied = static_cast<int>(orientation);
    return;
  }

  SETTINGS.orientation = orientation;
  ReaderUtils::applyOrientation(renderer, orientation);

  // Persist so the choice survives reloads (throttled by only writing on change).
  if (settingsChanged) {
    SETTINGS.saveToFile();
  }

  // Reader layouts are orientation-specific — reopen the book so paging reflows.
  if (activityManager.isReaderActivity()) {
    const std::string path = activityManager.getCurrentBookPath();
    if (!path.empty()) {
      LOG_INF("WEBINK", "Orientation %u — reopening reader %s", static_cast<unsigned>(orientation),
              path.c_str());
      activityManager.goToReader(path, /*suppressBackRelease=*/true);
      g_lastApplied = static_cast<int>(orientation);
      return;
    }
  }

  activityManager.requestUpdate(/*immediate=*/true);
  g_lastApplied = static_cast<int>(orientation);
  LOG_INF("WEBINK", "Applied device orientation %u", static_cast<unsigned>(orientation));
}

} // namespace

#ifdef __EMSCRIPTEN__
extern "C" {

// Called from JS when the phone/browser orientation changes.
// 0=Portrait, 1=Landscape CW, 2=Inverted, 3=Landscape CCW
EMSCRIPTEN_KEEPALIVE
void webink_set_device_orientation(int orientation) {
  if (orientation < 0 || orientation >= CrossPointSettings::ORIENTATION_COUNT) {
    return;
  }
  if (orientation == g_lastApplied && g_pendingOrientation.load() < 0) {
    return;
  }
  g_pendingOrientation.store(orientation);
}

EMSCRIPTEN_KEEPALIVE
int webink_get_device_orientation(void) {
  return static_cast<int>(SETTINGS.orientation);
}

} // extern "C"
#endif

// Poll from the browser main loop (webink_main frame).
void webink_poll_device_orientation() {
  const int pending = g_pendingOrientation.exchange(-1);
  if (pending < 0) {
    return;
  }
  applyOrientationNow(static_cast<uint8_t>(pending));
}
