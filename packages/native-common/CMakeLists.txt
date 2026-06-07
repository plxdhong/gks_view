cmake_minimum_required(VERSION 3.20)

project(gk_workbench_native_common VERSION 0.1.0 LANGUAGES CXX)

add_library(gk_workbench_native_common STATIC
  src/version.cpp
)

target_include_directories(gk_workbench_native_common
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(gk_workbench_native_common PUBLIC cxx_std_17)

add_library(gk_workbench::native_common ALIAS gk_workbench_native_common)

