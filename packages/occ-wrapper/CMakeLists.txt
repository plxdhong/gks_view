cmake_minimum_required(VERSION 3.20)

project(gk_workbench_occ_wrapper VERSION 0.4.1 LANGUAGES CXX)

find_package(OpenCASCADE QUIET CONFIG)
if(NOT OpenCASCADE_FOUND)
  find_package(OCCT QUIET CONFIG)
endif()

if(NOT OpenCASCADE_FOUND AND NOT OCCT_FOUND)
  message(STATUS "OpenCASCADE/OCCT was not found. Skipping gk_occ_example.")
  message(STATUS "Set OpenCASCADE_DIR or CMAKE_PREFIX_PATH to the compiled OCC install before building this package.")
  add_custom_target(gk_occ_wrapper_status
    COMMAND ${CMAKE_COMMAND} -E echo "OpenCASCADE/OCCT not found - gk_occ_example was not built."
  )
  return()
endif()

add_executable(gk_occ_example
  src/main.cpp
)

target_compile_features(gk_occ_example PRIVATE cxx_std_17)

target_include_directories(gk_occ_example
  PRIVATE
    ${OpenCASCADE_INCLUDE_DIR}
    ${OpenCASCADE_INCLUDE_DIRS}
    ${OCCT_INCLUDE_DIR}
    ${OCCT_INCLUDE_DIRS}
)

target_link_directories(gk_occ_example
  PRIVATE
    ${OpenCASCADE_LIBRARY_DIR}
    ${OpenCASCADE_LIBRARY_DIRS}
    ${OCCT_LIBRARY_DIR}
    ${OCCT_LIBRARY_DIRS}
)

set(GK_OCC_LIBS
  ${OpenCASCADE_LIBRARIES}
  ${OCCT_LIBRARIES}
)

if(NOT GK_OCC_LIBS)
  set(GK_OCC_LIBS
    TKernel
    TKMath
    TKG2d
    TKG3d
    TKGeomBase
    TKGeomAlgo
    TKBRep
    TKTopAlgo
    TKPrim
    TKBool
    TKMesh
  )
endif()

target_link_libraries(gk_occ_example PRIVATE ${GK_OCC_LIBS})
