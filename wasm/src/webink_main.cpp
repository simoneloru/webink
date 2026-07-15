// WebInk entry: CrossInk setup()/loop() driven for the browser.
// Replaces crosspoint-simulator's simulator_main.cpp under Emscripten.

#include <SDL.h>

#include "Arduino.h"
#include "HalDisplay.h"
#include "HalGPIO.h"
#include "SimulatorLifecycle.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/html5.h>
#endif

#include <unistd.h>

extern void setup();
extern void loop();
extern HalDisplay display;

namespace {

void frame() {
  if (display.shouldQuit()) {
#ifdef __EMSCRIPTEN__
    emscripten_cancel_main_loop();
#endif
    SDL_Quit();
    return;
  }
  gpio.beginFrame();
  loop();
  display.presentIfNeeded();
}

} // namespace

int main(int argc, char **argv) {
  SimulatorLifecycle::initProcessArgs(argv);

  // Virtual SD root used by HalStorage (see HalStorage configuredStorageRoot).
  // Set before any storage open; also set from JS ENV in app.js as backup.
#ifdef __EMSCRIPTEN__
  setenv("CROSSPOINT_SIM_SD", "/fs_", 1);
#endif

  setup();

#ifdef __EMSCRIPTEN__
  // 0 fps = browser refresh rate; simulate_infinite_loop keeps stack for setup.
  emscripten_set_main_loop(frame, 0, /*simulate_infinite_loop=*/1);
  return 0;
#else
  while (!display.shouldQuit()) {
    frame();
    SDL_Delay(1);
  }
  SDL_Quit();
  _exit(0);
#endif
}
