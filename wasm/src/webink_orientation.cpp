// WebInk: map browser screen orientation onto CrossInk SETTINGS.orientation.
// JS only queues a value; apply happens on the Wasm main loop.

#include "activities/Activity.h"
#include "activities/ActivityManager.h"
#include "CrossPointSettings.h"
#include "GfxRenderer.h"
#include "Logging.h"
#include "activities/reader/ReaderUtils.h"

#include <atomic>
#include <cstdint>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

extern GfxRenderer renderer;
extern ActivityManager activityManager;

namespace {

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
  g_lastApplied = static_cast<int>(orientation);

  // Do not saveToFile() here (can hitch IDBFS) and do not goToReader()
  // (too heavy / can blank the UI). Deferred repaint is enough for menus;
  // open books pick up orientation on next natural re-layout / reopen.
  activityManager.requestUpdate(/*immediate=*/false);
  LOG_INF("WEBINK", "Device orientation -> %u", static_cast<unsigned>(orientation));
}

} // namespace

#ifdef __EMSCRIPTEN__
extern "C" {

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

void webink_poll_device_orientation() {
  const int pending = g_pendingOrientation.exchange(-1);
  if (pending < 0) {
    return;
  }
  applyOrientationNow(static_cast<uint8_t>(pending));
}
