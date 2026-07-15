#pragma once
// WebInk: single-threaded FreeRTOS shim for Emscripten (no SharedArrayBuffer).
// Tasks cooperate via ASYNCIFY emscripten_sleep — required for iOS Safari.

#include <atomic>
#include <cstdint>
#include <mutex>

#define pdTRUE 1
#define pdFALSE 0
#define portMAX_DELAY 0xFFFFFFFF
#define eIncrement 1
#define portTICK_PERIOD_MS 1

struct SimPortMux {
  std::recursive_mutex mtx;
};
typedef SimPortMux portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED \
  {}

inline void taskENTER_CRITICAL(portMUX_TYPE *mux) { mux->mtx.lock(); }
inline void taskEXIT_CRITICAL(portMUX_TYPE *mux) { mux->mtx.unlock(); }
#define portENTER_CRITICAL(mux) taskENTER_CRITICAL(mux)
#define portEXIT_CRITICAL(mux) taskEXIT_CRITICAL(mux)

struct SimTaskHandle {
  void (*fn)(void *) = nullptr;
  void *param = nullptr;
  std::atomic<uint32_t> notifyCount{0};
  const char *name = "sim-task";
  bool started = false;
};
typedef SimTaskHandle *TaskHandle_t;
