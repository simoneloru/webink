#pragma once
// Cooperative FreeRTOS tasks for Emscripten without pthreads.
// Requires -sASYNCIFY so emscripten_sleep can yield to the browser.

#include "FreeRTOS.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#include <chrono>
#include <mutex>
#include <thread>

inline thread_local SimTaskHandle *tl_currentTaskHandle = nullptr;

inline SimTaskHandle *simMainTaskHandle() {
  static SimTaskHandle mainTask;
  static std::once_flag initFlag;
  std::call_once(initFlag, [] {
    mainTask.name = "main";
  });
  return &mainTask;
}

inline TaskHandle_t xTaskGetCurrentTaskHandle() {
  return tl_currentTaskHandle ? tl_currentTaskHandle : simMainTaskHandle();
}

#ifdef __EMSCRIPTEN__
// Single-threaded: schedule task body on the browser event loop; it blocks via
// emscripten_sleep when waiting for notifications (ASYNCIFY).
inline int xTaskCreate(void (*fn)(void *), const char *name,
                       uint32_t /*stackDepth*/, void *param, int /*priority*/,
                       TaskHandle_t *handle) {
  auto *h = new SimTaskHandle();
  h->fn = fn;
  h->param = param;
  h->name = name ? name : "sim-task";
  emscripten_async_call(
      [](void *arg) {
        auto *task = static_cast<SimTaskHandle *>(arg);
        tl_currentTaskHandle = task;
        task->started = true;
        task->fn(task->param);
      },
      h, /*millis=*/0);
  if (handle)
    *handle = h;
  return 1;
}
#else
inline int xTaskCreate(void (*fn)(void *), const char *name,
                       uint32_t /*stackDepth*/, void *param, int /*priority*/,
                       TaskHandle_t *handle) {
  auto *h = new SimTaskHandle();
  h->name = name ? name : "sim-task";
  // Host desktop fallback (not used in pure Wasm builds)
  std::thread([fn, param, h]() {
    tl_currentTaskHandle = h;
    h->started = true;
    fn(param);
  }).detach();
  if (handle)
    *handle = h;
  return 1;
}
#endif

inline int xTaskCreatePinnedToCore(void (*fn)(void *), const char *name,
                                   uint32_t stackDepth, void *param,
                                   int priority, TaskHandle_t *handle,
                                   int /*coreId*/) {
  return xTaskCreate(fn, name, stackDepth, param, priority, handle);
}

inline uint32_t ulTaskNotifyTake(int /*clearOnExit*/, uint32_t /*ticksToWait*/) {
  auto *h = xTaskGetCurrentTaskHandle();
  while (true) {
    uint32_t expected = h->notifyCount.load();
    while (expected > 0) {
      if (h->notifyCount.compare_exchange_weak(expected, expected - 1))
        return 1;
      expected = h->notifyCount.load();
    }
#ifdef __EMSCRIPTEN__
    emscripten_sleep(1);
#else
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
#endif
  }
}

inline void xTaskNotify(TaskHandle_t handle, uint32_t /*value*/, int /*action*/) {
  if (!handle)
    return;
  handle->notifyCount.fetch_add(1);
}

inline const char *pcTaskGetName(TaskHandle_t h) {
  if (!h)
    h = xTaskGetCurrentTaskHandle();
  return h ? h->name : "main";
}

inline void vTaskDelete(TaskHandle_t h) {
  // Cooperative tasks are long-lived; leak handle rather than free mid-loop.
  (void)h;
}

inline unsigned int uxTaskGetStackHighWaterMark(TaskHandle_t) { return 2048; }
inline void vTaskList(char *) {}
inline void vTaskDelay(int ticks) {
#ifdef __EMSCRIPTEN__
  emscripten_sleep(ticks > 0 ? ticks : 1);
#else
  std::this_thread::sleep_for(std::chrono::milliseconds(ticks > 0 ? ticks : 1));
#endif
}
