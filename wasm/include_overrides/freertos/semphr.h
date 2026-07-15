#pragma once
// Single-threaded-safe semaphore shim (recursive mutex is re-entrant).

#include "FreeRTOS.h"
#include "task.h"

#include <mutex>

struct SimMutex {
  std::recursive_mutex mtx;
  TaskHandle_t holder = nullptr;
  uint16_t holdCount = 0;
};
typedef SimMutex *SemaphoreHandle_t;

inline SemaphoreHandle_t xSemaphoreCreateMutex() { return new SimMutex(); }

inline bool xSemaphoreTake(SemaphoreHandle_t sem, uint32_t /*ticksToWait*/) {
  if (!sem)
    return true;
  sem->mtx.lock();
  sem->holder = xTaskGetCurrentTaskHandle();
  sem->holdCount++;
  return true;
}

inline bool xSemaphoreGive(SemaphoreHandle_t sem) {
  if (!sem)
    return true;
  if (sem->holdCount > 0)
    sem->holdCount--;
  if (sem->holdCount == 0)
    sem->holder = nullptr;
  sem->mtx.unlock();
  return true;
}

inline TaskHandle_t xSemaphoreGetMutexHolder(SemaphoreHandle_t sem) {
  return sem ? sem->holder : nullptr;
}

inline int xQueuePeek(SemaphoreHandle_t sem, void *, uint32_t) {
  if (!sem)
    return pdTRUE;
  bool locked = sem->mtx.try_lock();
  if (locked) {
    sem->mtx.unlock();
    return pdTRUE;
  }
  return pdFALSE;
}

inline void vSemaphoreDelete(SemaphoreHandle_t sem) {
  if (sem)
    delete sem;
}
