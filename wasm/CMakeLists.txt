cmake_minimum_required(VERSION 3.20)
project(webink LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
set(WEBINK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(CROSSINK_ROOT "${WEBINK_ROOT}/vendor/CrossInk")
set(SIM_ROOT "${WEBINK_ROOT}/vendor/crosspoint-simulator")
set(WWW_DIR "${WEBINK_ROOT}/www")

if(NOT EXISTS "${CROSSINK_ROOT}/src/main.cpp")
  message(FATAL_ERROR "CrossInk missing at ${CROSSINK_ROOT}. Run: git submodule update --init --recursive")
endif()
if(NOT EXISTS "${SIM_ROOT}/src/simulator_main.cpp")
  message(FATAL_ERROR "crosspoint-simulator missing at ${SIM_ROOT}. Run: git submodule update --init --recursive")
endif()

# ---------------------------------------------------------------------------
# ArduinoJson (header-only-ish, same major as firmware)
# ---------------------------------------------------------------------------
include(FetchContent)
FetchContent_Declare(
  ArduinoJson
  GIT_REPOSITORY https://github.com/bblanchon/ArduinoJson.git
  GIT_TAG        v7.4.2
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(ArduinoJson)

# ---------------------------------------------------------------------------
# CrossInk application sources (mirror platformio [env:simulator] filter)
# ---------------------------------------------------------------------------
file(GLOB_RECURSE CROSSINK_SRC CONFIGURE_DEPENDS
  "${CROSSINK_ROOT}/src/*.cpp"
  "${CROSSINK_ROOT}/lib/*/*.cpp"
  "${CROSSINK_ROOT}/lib/*/*/*.cpp"
  "${CROSSINK_ROOT}/lib/*/*/*/*.cpp"
)

# Same exclusions as CrossInk platformio [env:simulator], plus device-only transfer.
# Keep network *activities* so menus still compile; host Wi‑Fi/HTTP is stubbed.
set(CROSSINK_EXCLUDE_REGEXES
  ".*/lib/hal/.*"                          # simulator supplies Hal*
  ".*/lib/HalClockSim/.*"
  ".*/network/CrossPointWebServer\\.cpp$"
  ".*/network/FirmwareFlasher\\.cpp$"
  ".*/network/OtaBootSwitch\\.cpp$"
  ".*/network/OtaUpdater\\.cpp$"
  ".*/network/WebDAVHandler\\.cpp$"
  ".*/network/UsbSerialFileTransfer\\.cpp$"
  ".*/platform/skip_efuse_blk_check\\.c$"
  ".*/simulator/SimulatorSmokeTest\\.cpp$"
)

set(CROSSINK_SRC_FILTERED "")
foreach(f ${CROSSINK_SRC})
  set(skip FALSE)
  foreach(re ${CROSSINK_EXCLUDE_REGEXES})
    if(f MATCHES "${re}")
      set(skip TRUE)
    endif()
  endforeach()
  if(NOT skip)
    list(APPEND CROSSINK_SRC_FILTERED "${f}")
  endif()
endforeach()

# C libraries bundled in firmware tree
file(GLOB EXPAT_SRC CONFIGURE_DEPENDS
  "${CROSSINK_ROOT}/lib/expat/xmlparse.c"
  "${CROSSINK_ROOT}/lib/expat/xmlrole.c"
  "${CROSSINK_ROOT}/lib/expat/xmltok.c"
  "${CROSSINK_ROOT}/lib/expat/xmltok_impl.c"
  "${CROSSINK_ROOT}/lib/expat/xmltok_ns.c"
)
file(GLOB UZLIB_SRC CONFIGURE_DEPENDS
  "${CROSSINK_ROOT}/lib/uzlib/src/*.c"
)
set(MINIBIDI_SRC "${CROSSINK_ROOT}/lib/MiniBidi/minibidi.c")

# ---------------------------------------------------------------------------
# Simulator HAL sources
# ---------------------------------------------------------------------------
file(GLOB_RECURSE SIM_SRC CONFIGURE_DEPENDS
  "${SIM_ROOT}/src/*.cpp"
)

# Host-only network servers / curl-backed HTTP — not used in the browser shell.
# Headers (WiFi.h, HTTPClient.h, …) remain for compile; link stubs fill gaps.
set(SIM_EXCLUDE_REGEXES
  ".*/WebServer\\.cpp$"
  ".*/WebSocketsServer\\.cpp$"
  ".*/CrossPointWebServer\\.cpp$"
  ".*/NetworkClient\\.cpp$"
  # We replace main loop for Emscripten
  ".*/simulator_main\\.cpp$"
  # Real Logging + uzlib are linked; stubs would duplicate symbols
  ".*/firmware_link_stubs\\.cpp$"
)

set(SIM_SRC_FILTERED "")
foreach(f ${SIM_SRC})
  set(skip FALSE)
  foreach(re ${SIM_EXCLUDE_REGEXES})
    if(f MATCHES "${re}")
      set(skip TRUE)
    endif()
  endforeach()
  if(NOT skip)
    list(APPEND SIM_SRC_FILTERED "${f}")
  endif()
endforeach()

# Web-only entry + stubs
set(WASM_SRC
  "${CMAKE_CURRENT_SOURCE_DIR}/src/webink_main.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/src/webink_network_stubs.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/src/webink_activity_stubs.cpp"
)

add_executable(crossink
  ${CROSSINK_SRC_FILTERED}
  ${EXPAT_SRC}
  ${UZLIB_SRC}
  ${MINIBIDI_SRC}
  ${SIM_SRC_FILTERED}
  ${WASM_SRC}
)

# ---------------------------------------------------------------------------
# Include paths (PlatformIO adds each lib/ folder automatically)
# ---------------------------------------------------------------------------
set(CROSSINK_LIB_INCLUDES "")
file(GLOB CROSSINK_LIB_DIRS LIST_DIRECTORIES true "${CROSSINK_ROOT}/lib/*")
foreach(d ${CROSSINK_LIB_DIRS})
  if(IS_DIRECTORY "${d}")
    get_filename_component(libname "${d}" NAME)
    # Device HAL is replaced entirely by crosspoint-simulator (pio: lib_ignore=hal)
    if(libname STREQUAL "hal" OR libname STREQUAL "HalClockSim")
      continue()
    endif()
    list(APPEND CROSSINK_LIB_INCLUDES "${d}")
    if(EXISTS "${d}/src" AND IS_DIRECTORY "${d}/src")
      list(APPEND CROSSINK_LIB_INCLUDES "${d}/src")
    endif()
  endif()
endforeach()

target_include_directories(crossink PRIVATE
  # Web overrides (MD5, HTTP) + simulator HAL must beat firmware paths
  "${CMAKE_CURRENT_SOURCE_DIR}/include_overrides"
  "${SIM_ROOT}/src"
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${CROSSINK_ROOT}/src"
  "${CROSSINK_ROOT}/include"
  "${CROSSINK_ROOT}/lib"
  ${CROSSINK_LIB_INCLUDES}
  "${arduinojson_SOURCE_DIR}/src"
)

# ---------------------------------------------------------------------------
# Compile definitions (from platformio [env:simulator] + web)
# ---------------------------------------------------------------------------
target_compile_definitions(crossink PRIVATE
  SIMULATOR=1
  WEBINK=1
  EINK_DISPLAY_SINGLE_BUFFER_MODE=1
  ENABLE_SERIAL_LOG=1
  LOG_LEVEL=1
  MINIZ_NO_ZLIB_COMPATIBLE_NAMES=1
  XML_GE=0
  XML_CONTEXT_BYTES=1024
  USE_UTF8_LONG_NAMES=1
  PNG_MAX_BUFFERED_PIXELS=16416
  DISABLE_FS_H_WARNING=1
  DESTRUCTOR_CLOSES_FILE=1
  CROSSPOINT_FIRMWARE_VARIANT=\"web\"
  CROSSINK_BUILD_ENV=\"web\"
  CROSSINK_FIRMWARE_VARIANT=\"web\"
)

# Version string: -DWEBINK_VERSION=v0.1.0 from CI tags, else default
if(NOT DEFINED WEBINK_VERSION OR WEBINK_VERSION STREQUAL "")
  set(WEBINK_VERSION "web-0.1.0")
endif()
target_compile_definitions(crossink PRIVATE
  CROSSINK_VERSION=\"${WEBINK_VERSION}\"
  # Omit heaviest font tiers to keep wasm smaller (tiny-like)
  OMIT_TEENSY_FONT=1
  OMIT_ITTY_BITTY_FONT=1
  OMIT_XLARGE_FONT=1
  OMIT_HUGE_FONT=1
  # memcpy_P for PROGMEM-style APIs on host
  memcpy_P=memcpy
)

target_compile_options(crossink PRIVATE
  -Wno-c++11-narrowing
  -Wno-unused-parameter
  -Wno-missing-field-initializers
  -fno-exceptions
)

# ---------------------------------------------------------------------------
# Emscripten link
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
  # FreeRTOS shim uses std::thread → need pthreads + SharedArrayBuffer
  target_compile_options(crossink PRIVATE
    "SHELL:-sUSE_SDL=2"
    -pthread
    -O2
  )

  target_link_options(crossink PRIVATE
    "SHELL:-sUSE_SDL=2"
    -pthread
    "SHELL:-sPTHREAD_POOL_SIZE=8"
    "SHELL:-sALLOW_MEMORY_GROWTH=1"
    "SHELL:-sINITIAL_MEMORY=134217728"
    "SHELL:-sSTACK_SIZE=2097152"
    "SHELL:-sFORCE_FILESYSTEM=1"
    "SHELL:-sASSERTIONS=1"
    "SHELL:-sEXIT_RUNTIME=0"
    "SHELL:-sMODULARIZE=1"
    "SHELL:-sEXPORT_ES6=1"
    "SHELL:-sEXPORT_NAME=createCrossInkModule"
    "SHELL:-sINVOKE_RUN=0"
    "SHELL:-sENVIRONMENT=web,worker"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=['FS','PATH','ERRNO_CODES','ENV','callMain','ccall','cwrap','UTF8ToString','lengthBytesUTF8','stringToUTF8']"
    "SHELL:-sEXPORTED_FUNCTIONS=['_main']"
    "SHELL:-sNO_DISABLE_EXCEPTION_CATCHING=0"
    # ASYNCIFY for SDL_Delay / blocking waits that must yield to browser
    "SHELL:-sASYNCIFY"
    "SHELL:-sASYNCIFY_STACK_SIZE=131072"
    -O2
  )

  set_target_properties(crossink PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${WWW_DIR}"
    OUTPUT_NAME "crossink"
    SUFFIX ".js"
  )
else()
  # Optional: native desktop build using system SDL2 (debug without emscripten)
  find_package(SDL2 REQUIRED)
  target_link_libraries(crossink PRIVATE SDL2::SDL2)
  target_compile_definitions(crossink PRIVATE CROSSPOINT_SIM_SD=\"./fs_\")
endif()

message(STATUS "CrossInk sources: ${CROSSINK_SRC_FILTERED}")
list(LENGTH CROSSINK_SRC_FILTERED _n_app)
list(LENGTH SIM_SRC_FILTERED _n_sim)
message(STATUS "WebInk: ${_n_app} app sources, ${_n_sim} simulator sources")
