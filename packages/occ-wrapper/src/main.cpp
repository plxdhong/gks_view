#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Poly_Triangulation.hxx>
#include <Standard_Version.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace fs = std::filesystem;

namespace {

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct BBox {
  Vec3 min;
  Vec3 max;
};

struct FaceMesh {
  std::string entityId;
  std::vector<double> positions;
  std::vector<std::uint32_t> indices;
  std::string color = "#6aa6d8";
};

struct EdgePolyline {
  std::string entityId;
  std::vector<double> points;
};

struct VertexPoint {
  std::string entityId;
  Vec3 position;
};

struct BodyEntity {
  std::string id;
  int tag = 0;
  BBox bbox;
  std::vector<std::string> regions;
};

struct RegionEntity {
  std::string id;
  std::string body;
  std::vector<std::string> shells;
};

struct ShellEntity {
  std::string id;
  int tag = 0;
  std::string region;
  std::string shellType = "unknown";
  std::vector<std::string> faces;
};

struct FaceEntity {
  std::string id;
  int tag = 0;
  std::string shell;
  std::string surfaceType = "unknown";
  std::string orientation = "unknown";
  std::vector<std::string> loops;
  std::vector<std::string> edges;
  double area = 0.0;
  BBox bbox;
};

struct LoopEntity {
  std::string id;
  int tag = 0;
  std::string face;
  std::string loopType = "unknown";
  std::vector<std::string> coedges;
};

struct CoedgeEntity {
  std::string id;
  int tag = 0;
  std::string loop;
  std::string edge;
  std::string sense = "unknown";
  std::string next;
  std::string previous;
};

struct EdgeEntity {
  std::string id;
  int tag = 0;
  std::string curveType = "unknown";
  std::vector<std::string> vertices;
  std::vector<std::string> adjacentFaces;
  double length = 0.0;
  BBox bbox;
};

struct VertexEntity {
  std::string id;
  int tag = 0;
  Vec3 position;
  std::vector<std::string> edges;
};

struct SceneData {
  std::string caseId = "OCCBox.Case_001";
  std::string snapshotId = "00_occ_box_cut";
  std::string title = "OCC box cut example";
  BBox bbox;
  std::vector<BodyEntity> bodies;
  std::vector<RegionEntity> regions;
  std::vector<ShellEntity> shells;
  std::vector<FaceEntity> faces;
  std::vector<LoopEntity> loops;
  std::vector<CoedgeEntity> coedges;
  std::vector<EdgeEntity> edges;
  std::vector<VertexEntity> vertices;
  std::vector<FaceMesh> faceMeshes;
  std::vector<EdgePolyline> edgePolylines;
  std::vector<VertexPoint> vertexPoints;
};

std::string jsonEscape(const std::string& value) {
  std::ostringstream out;
  for (const char ch : value) {
    const auto byte = static_cast<unsigned char>(ch);
    switch (ch) {
      case '"':
        out << "\\\"";
        break;
      case '\\':
        out << "\\\\";
        break;
      case '\b':
        out << "\\b";
        break;
      case '\f':
        out << "\\f";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        if (byte < 0x20) {
          out << "\\u00";
          const char* hex = "0123456789abcdef";
          out << hex[(byte >> 4) & 0x0f] << hex[byte & 0x0f];
        } else {
          out << ch;
        }
    }
  }
  return out.str();
}

std::string quoted(const std::string& value) {
  return "\"" + jsonEscape(value) + "\"";
}

template <typename T, typename Writer>
void writeArray(std::ostream& out, const std::vector<T>& values, Writer writer) {
  out << "[";
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index != 0) {
      out << ",";
    }
    writer(out, values[index]);
  }
  out << "]";
}

void writeStringArray(std::ostream& out, const std::vector<std::string>& values) {
  writeArray(out, values, [](std::ostream& itemOut, const std::string& value) {
    itemOut << quoted(value);
  });
}

void writeNumberArray(std::ostream& out, const std::vector<double>& values) {
  writeArray(out, values, [](std::ostream& itemOut, double value) {
    itemOut << value;
  });
}

void writeIndexArray(std::ostream& out, const std::vector<std::uint32_t>& values) {
  writeArray(out, values, [](std::ostream& itemOut, std::uint32_t value) {
    itemOut << value;
  });
}

void writeVec3(std::ostream& out, const Vec3& value) {
  out << "[" << value.x << "," << value.y << "," << value.z << "]";
}

void writeBBox(std::ostream& out, const BBox& value) {
  out << "{\"min\":";
  writeVec3(out, value.min);
  out << ",\"max\":";
  writeVec3(out, value.max);
  out << "}";
}

std::string shapeId(const std::string& kind, int zeroBasedIndex) {
  return kind + ":occ:" + std::to_string(zeroBasedIndex);
}

Vec3 toVec3(const gp_Pnt& point) {
  return {point.X(), point.Y(), point.Z()};
}

BBox bboxOfShape(const TopoDS_Shape& shape) {
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  double xmin = 0.0;
  double ymin = 0.0;
  double zmin = 0.0;
  double xmax = 0.0;
  double ymax = 0.0;
  double zmax = 0.0;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  return {{xmin, ymin, zmin}, {xmax, ymax, zmax}};
}

std::string orientationName(TopAbs_Orientation orientation) {
  if (orientation == TopAbs_FORWARD) {
    return "forward";
  }
  if (orientation == TopAbs_REVERSED) {
    return "reversed";
  }
  return "unknown";
}

std::string surfaceTypeName(GeomAbs_SurfaceType type) {
  switch (type) {
    case GeomAbs_Plane:
      return "plane";
    case GeomAbs_Cylinder:
      return "cylinder";
    case GeomAbs_Cone:
      return "cone";
    case GeomAbs_Sphere:
      return "sphere";
    case GeomAbs_Torus:
      return "torus";
    case GeomAbs_BezierSurface:
    case GeomAbs_BSplineSurface:
      return "bspline";
    case GeomAbs_SurfaceOfRevolution:
      return "spun";
    case GeomAbs_SurfaceOfExtrusion:
      return "swept";
    case GeomAbs_OffsetSurface:
      return "offset";
    default:
      return "unknown";
  }
}

std::string curveTypeName(GeomAbs_CurveType type) {
  switch (type) {
    case GeomAbs_Line:
      return "line";
    case GeomAbs_Circle:
      return "circle";
    case GeomAbs_Ellipse:
      return "ellipse";
    case GeomAbs_BezierCurve:
    case GeomAbs_BSplineCurve:
      return "bspline";
    default:
      return "unknown";
  }
}

double faceArea(const TopoDS_Face& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  return props.Mass();
}

double edgeLength(const TopoDS_Edge& edge) {
  GProp_GProps props;
  BRepGProp::LinearProperties(edge, props);
  return props.Mass();
}

std::vector<double> sampleEdgePoints(const TopoDS_Edge& edge) {
  std::vector<double> points;
  BRepAdaptor_Curve curve(edge);
  const double first = curve.FirstParameter();
  const double last = curve.LastParameter();
  constexpr int sampleCount = 24;
  if (!std::isfinite(first) || !std::isfinite(last) || std::abs(last - first) < 1e-12) {
    TopoDS_Vertex firstVertex;
    TopoDS_Vertex lastVertex;
    TopExp::Vertices(edge, firstVertex, lastVertex);
    if (!firstVertex.IsNull()) {
      const Vec3 point = toVec3(BRep_Tool::Pnt(firstVertex));
      points.insert(points.end(), {point.x, point.y, point.z});
    }
    if (!lastVertex.IsNull()) {
      const Vec3 point = toVec3(BRep_Tool::Pnt(lastVertex));
      points.insert(points.end(), {point.x, point.y, point.z});
    }
    return points;
  }

  for (int index = 0; index < sampleCount; ++index) {
    const double t = static_cast<double>(index) / static_cast<double>(sampleCount - 1);
    const double parameter = first + (last - first) * t;
    const Vec3 point = toVec3(curve.Value(parameter));
    points.insert(points.end(), {point.x, point.y, point.z});
  }
  return points;
}

FaceMesh tessellateFace(const TopoDS_Face& face, const std::string& entityId) {
  FaceMesh mesh;
  mesh.entityId = entityId;

  TopLoc_Location location;
  Handle(Poly_Triangulation) triangulation = BRep_Tool::Triangulation(face, location);
  if (triangulation.IsNull()) {
    return mesh;
  }

  const gp_Trsf transform = location.Transformation();
  mesh.positions.reserve(static_cast<std::size_t>(triangulation->NbNodes()) * 3);
  for (int index = 1; index <= triangulation->NbNodes(); ++index) {
    const Vec3 point = toVec3(triangulation->Node(index).Transformed(transform));
    mesh.positions.insert(mesh.positions.end(), {point.x, point.y, point.z});
  }

  mesh.indices.reserve(static_cast<std::size_t>(triangulation->NbTriangles()) * 3);
  for (int index = 1; index <= triangulation->NbTriangles(); ++index) {
    int a = 0;
    int b = 0;
    int c = 0;
    triangulation->Triangle(index).Get(a, b, c);
    if (face.Orientation() == TopAbs_REVERSED) {
      std::swap(b, c);
    }
    mesh.indices.push_back(static_cast<std::uint32_t>(a - 1));
    mesh.indices.push_back(static_cast<std::uint32_t>(b - 1));
    mesh.indices.push_back(static_cast<std::uint32_t>(c - 1));
  }
  return mesh;
}

TopoDS_Shape buildExampleShape() {
  TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-1.0, -0.7, -0.5), 2.0, 1.4, 1.0).Shape();
  TopoDS_Shape cutter = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0.0, 0.0, -0.75), gp_Dir(0.0, 0.0, 1.0)), 0.28, 1.5).Shape();
  BRepAlgoAPI_Cut cut(box, cutter);
  cut.Build();
  if (!cut.IsDone()) {
    throw std::runtime_error("OCC boolean cut failed");
  }
  TopoDS_Shape result = cut.Shape();
  BRepMesh_IncrementalMesh(result, 0.025, Standard_False, 0.35, Standard_True);
  return result;
}

std::vector<std::string> adjacentFaceIds(
    const TopoDS_Edge& edge,
    const TopTools_IndexedMapOfShape& faceMap,
    const TopTools_IndexedDataMapOfShapeListOfShape& edgeToFaces) {
  std::vector<std::string> ids;
  if (!edgeToFaces.Contains(edge)) {
    return ids;
  }
  const TopTools_ListOfShape& faces = edgeToFaces.FindFromKey(edge);
  for (TopTools_ListIteratorOfListOfShape iterator(faces); iterator.More(); iterator.Next()) {
    const int faceIndex = faceMap.FindIndex(iterator.Value());
    if (faceIndex > 0) {
      ids.push_back(shapeId("face", faceIndex - 1));
    }
  }
  std::sort(ids.begin(), ids.end());
  ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
  return ids;
}

std::vector<std::string> edgeVertexIds(const TopoDS_Edge& edge, const TopTools_IndexedMapOfShape& vertexMap) {
  std::vector<std::string> ids;
  TopoDS_Vertex firstVertex;
  TopoDS_Vertex lastVertex;
  TopExp::Vertices(edge, firstVertex, lastVertex);
  if (!firstVertex.IsNull()) {
    const int index = vertexMap.FindIndex(firstVertex);
    if (index > 0) {
      ids.push_back(shapeId("vertex", index - 1));
    }
  }
  if (!lastVertex.IsNull()) {
    const int index = vertexMap.FindIndex(lastVertex);
    const std::string id = index > 0 ? shapeId("vertex", index - 1) : "";
    if (!id.empty() && std::find(ids.begin(), ids.end(), id) == ids.end()) {
      ids.push_back(id);
    }
  }
  return ids;
}

std::vector<std::string> vertexEdgeIds(
    const TopoDS_Vertex& vertex,
    const TopTools_IndexedMapOfShape& edgeMap,
    const TopTools_IndexedDataMapOfShapeListOfShape& vertexToEdges) {
  std::vector<std::string> ids;
  if (!vertexToEdges.Contains(vertex)) {
    return ids;
  }
  const TopTools_ListOfShape& edges = vertexToEdges.FindFromKey(vertex);
  for (TopTools_ListIteratorOfListOfShape iterator(edges); iterator.More(); iterator.Next()) {
    const int edgeIndex = edgeMap.FindIndex(iterator.Value());
    if (edgeIndex > 0) {
      ids.push_back(shapeId("edge", edgeIndex - 1));
    }
  }
  std::sort(ids.begin(), ids.end());
  ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
  return ids;
}

SceneData collectScene(const TopoDS_Shape& shape) {
  SceneData scene;
  scene.bbox = bboxOfShape(shape);

  TopTools_IndexedMapOfShape shellMap;
  TopTools_IndexedMapOfShape faceMap;
  TopTools_IndexedMapOfShape edgeMap;
  TopTools_IndexedMapOfShape vertexMap;
  TopExp::MapShapes(shape, TopAbs_SHELL, shellMap);
  TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
  TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
  TopExp::MapShapes(shape, TopAbs_VERTEX, vertexMap);

  TopTools_IndexedDataMapOfShapeListOfShape edgeToFaces;
  TopTools_IndexedDataMapOfShapeListOfShape vertexToEdges;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeToFaces);
  TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_EDGE, vertexToEdges);

  const std::string bodyId = "body:occ:0";
  const std::string regionId = "region:occ:0";
  BodyEntity body;
  body.id = bodyId;
  body.tag = 1;
  body.bbox = scene.bbox;
  body.regions = {regionId};
  scene.bodies.push_back(body);

  RegionEntity region;
  region.id = regionId;
  region.body = bodyId;
  const int shellCount = std::max(1, shellMap.Extent());
  for (int index = 0; index < shellCount; ++index) {
    region.shells.push_back(shapeId("shell", index));
  }
  scene.regions.push_back(region);

  std::map<int, std::vector<std::string>> shellFaces;
  std::vector<std::string> faceShellIds(static_cast<std::size_t>(faceMap.Extent() + 1), shapeId("shell", 0));
  if (shellMap.Extent() > 0) {
    for (int shellIndex = 1; shellIndex <= shellMap.Extent(); ++shellIndex) {
      const TopoDS_Shape& shell = shellMap(shellIndex);
      for (TopExp_Explorer explorer(shell, TopAbs_FACE); explorer.More(); explorer.Next()) {
        const int faceIndex = faceMap.FindIndex(explorer.Current());
        if (faceIndex > 0) {
          faceShellIds[static_cast<std::size_t>(faceIndex)] = shapeId("shell", shellIndex - 1);
          shellFaces[shellIndex - 1].push_back(shapeId("face", faceIndex - 1));
        }
      }
    }
  } else {
    for (int faceIndex = 1; faceIndex <= faceMap.Extent(); ++faceIndex) {
      shellFaces[0].push_back(shapeId("face", faceIndex - 1));
    }
  }

  for (int shellIndex = 0; shellIndex < shellCount; ++shellIndex) {
    ShellEntity shellEntity;
    shellEntity.id = shapeId("shell", shellIndex);
    shellEntity.tag = shellIndex + 1;
    shellEntity.region = regionId;
    shellEntity.faces = shellFaces[shellIndex];
    if (shellIndex + 1 <= shellMap.Extent()) {
      shellEntity.shellType = shellMap(shellIndex + 1).Closed() ? "closed" : "open";
    }
    scene.shells.push_back(shellEntity);
  }

  for (int faceIndex = 1; faceIndex <= faceMap.Extent(); ++faceIndex) {
    const TopoDS_Face face = TopoDS::Face(faceMap(faceIndex));
    const std::string faceId = shapeId("face", faceIndex - 1);
    FaceEntity faceEntity;
    faceEntity.id = faceId;
    faceEntity.tag = faceIndex;
    faceEntity.shell = faceShellIds[static_cast<std::size_t>(faceIndex)];
    faceEntity.orientation = orientationName(face.Orientation());
    faceEntity.surfaceType = surfaceTypeName(BRepAdaptor_Surface(face).GetType());
    faceEntity.area = faceArea(face);
    faceEntity.bbox = bboxOfShape(face);

    int wireIndex = 0;
    const TopoDS_Wire outerWire = BRepTools::OuterWire(face);
    for (TopExp_Explorer wireExplorer(face, TopAbs_WIRE); wireExplorer.More(); wireExplorer.Next()) {
      const TopoDS_Wire wire = TopoDS::Wire(wireExplorer.Current());
      LoopEntity loop;
      loop.id = "loop:occ:" + std::to_string(faceIndex - 1) + ":" + std::to_string(wireIndex);
      loop.tag = static_cast<int>(scene.loops.size()) + 1;
      loop.face = faceId;
      loop.loopType = !outerWire.IsNull() && wire.IsSame(outerWire) ? "outer" : "inner";

      std::vector<std::string> coedgeIds;
      int coedgeIndex = 0;
      for (TopExp_Explorer edgeExplorer(wire, TopAbs_EDGE); edgeExplorer.More(); edgeExplorer.Next()) {
        const TopoDS_Edge edge = TopoDS::Edge(edgeExplorer.Current());
        const int edgeIndex = edgeMap.FindIndex(edge);
        if (edgeIndex <= 0) {
          continue;
        }
        const std::string edgeId = shapeId("edge", edgeIndex - 1);
        if (std::find(faceEntity.edges.begin(), faceEntity.edges.end(), edgeId) == faceEntity.edges.end()) {
          faceEntity.edges.push_back(edgeId);
        }

        CoedgeEntity coedge;
        coedge.id = "coedge:occ:" + std::to_string(faceIndex - 1) + ":" + std::to_string(wireIndex) + ":" + std::to_string(coedgeIndex);
        coedge.tag = static_cast<int>(scene.coedges.size()) + 1;
        coedge.loop = loop.id;
        coedge.edge = edgeId;
        coedge.sense = orientationName(edge.Orientation());
        coedgeIds.push_back(coedge.id);
        scene.coedges.push_back(coedge);
        ++coedgeIndex;
      }

      for (std::size_t index = 0; index < coedgeIds.size(); ++index) {
        CoedgeEntity& coedge = scene.coedges[scene.coedges.size() - coedgeIds.size() + index];
        coedge.next = coedgeIds[(index + 1) % coedgeIds.size()];
        coedge.previous = coedgeIds[(index + coedgeIds.size() - 1) % coedgeIds.size()];
      }
      loop.coedges = coedgeIds;
      faceEntity.loops.push_back(loop.id);
      scene.loops.push_back(loop);
      ++wireIndex;
    }

    scene.faceMeshes.push_back(tessellateFace(face, faceId));
    scene.faces.push_back(faceEntity);
  }

  for (int edgeIndex = 1; edgeIndex <= edgeMap.Extent(); ++edgeIndex) {
    const TopoDS_Edge edge = TopoDS::Edge(edgeMap(edgeIndex));
    EdgeEntity entity;
    entity.id = shapeId("edge", edgeIndex - 1);
    entity.tag = edgeIndex;
    entity.curveType = curveTypeName(BRepAdaptor_Curve(edge).GetType());
    entity.vertices = edgeVertexIds(edge, vertexMap);
    entity.adjacentFaces = adjacentFaceIds(edge, faceMap, edgeToFaces);
    entity.length = edgeLength(edge);
    entity.bbox = bboxOfShape(edge);
    scene.edges.push_back(entity);

    EdgePolyline polyline;
    polyline.entityId = entity.id;
    polyline.points = sampleEdgePoints(edge);
    scene.edgePolylines.push_back(polyline);
  }

  for (int vertexIndex = 1; vertexIndex <= vertexMap.Extent(); ++vertexIndex) {
    const TopoDS_Vertex vertex = TopoDS::Vertex(vertexMap(vertexIndex));
    VertexEntity entity;
    entity.id = shapeId("vertex", vertexIndex - 1);
    entity.tag = vertexIndex;
    entity.position = toVec3(BRep_Tool::Pnt(vertex));
    entity.edges = vertexEdgeIds(vertex, edgeMap, vertexToEdges);
    scene.vertices.push_back(entity);

    VertexPoint point;
    point.entityId = entity.id;
    point.position = entity.position;
    scene.vertexPoints.push_back(point);
  }

  return scene;
}

void writeIdentity(std::ostream& out, const std::string& id, const std::string& kind, int tag, const std::string& stableId) {
  out << "\"entityId\":" << quoted(id)
      << ",\"kind\":" << quoted(kind)
      << ",\"kernelTag\":" << tag
      << ",\"stableId\":" << quoted(stableId)
      << ",\"sourceKernel\":\"occ\"";
}

void writeScene(std::ostream& out, const SceneData& scene) {
  const Vec3 center{
      (scene.bbox.min.x + scene.bbox.max.x) / 2.0,
      (scene.bbox.min.y + scene.bbox.max.y) / 2.0,
      (scene.bbox.min.z + scene.bbox.max.z) / 2.0};
  const Vec3 size{
      scene.bbox.max.x - scene.bbox.min.x,
      scene.bbox.max.y - scene.bbox.min.y,
      scene.bbox.max.z - scene.bbox.min.z};
  const double span = std::max({size.x, size.y, size.z, 1.0});
  const Vec3 camera{center.x + span * 2.0, center.y - span * 2.0, center.z + span * 1.4};

  out << "{";
  out << "\"gksVersion\":\"0.1\",";
  out << "\"sceneId\":" << quoted(scene.caseId + "." + scene.snapshotId) << ",";
  out << "\"caseId\":" << quoted(scene.caseId) << ",";
  out << "\"snapshotId\":" << quoted(scene.snapshotId) << ",";
  out << "\"title\":" << quoted(scene.title) << ",";
  out << "\"unit\":\"m\",";
  out << "\"source\":{\"kernel\":\"occ\",\"adapterId\":\"gk-occ-wrapper.example\",\"modelId\":\"occ-box-cut\"},";
  out << "\"bbox\":";
  writeBBox(out, scene.bbox);
  out << ",\"cameraHint\":{\"target\":";
  writeVec3(out, center);
  out << ",\"position\":";
  writeVec3(out, camera);
  out << ",\"up\":[0,0,1]},";

  out << "\"topology\":{";
  out << "\"bodies\":";
  writeArray(out, scene.bodies, [](std::ostream& itemOut, const BodyEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "body", item.tag, "occ/body0");
    itemOut << ",\"debugName\":\"OCC box cut body\",\"bodyType\":\"solid\",\"regions\":";
    writeStringArray(itemOut, item.regions);
    itemOut << ",\"bbox\":";
    writeBBox(itemOut, item.bbox);
    itemOut << "}";
  });
  out << ",\"regions\":";
  writeArray(out, scene.regions, [](std::ostream& itemOut, const RegionEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "region", 1, "occ/body0/region0");
    itemOut << ",\"synthetic\":true,\"body\":" << quoted(item.body) << ",\"shells\":";
    writeStringArray(itemOut, item.shells);
    itemOut << "}";
  });
  out << ",\"shells\":";
  writeArray(out, scene.shells, [](std::ostream& itemOut, const ShellEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "shell", item.tag, "occ/body0/region0/shell" + std::to_string(item.tag - 1));
    itemOut << ",\"region\":" << quoted(item.region) << ",\"shellType\":" << quoted(item.shellType) << ",\"faces\":";
    writeStringArray(itemOut, item.faces);
    itemOut << "}";
  });
  out << ",\"faces\":";
  writeArray(out, scene.faces, [](std::ostream& itemOut, const FaceEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "face", item.tag, "occ/body0/region0/" + item.shell + "/face" + std::to_string(item.tag - 1));
    itemOut << ",\"debugName\":" << quoted("OCC Face " + std::to_string(item.tag))
            << ",\"shell\":" << quoted(item.shell)
            << ",\"surfaceType\":" << quoted(item.surfaceType)
            << ",\"orientation\":" << quoted(item.orientation)
            << ",\"loops\":";
    writeStringArray(itemOut, item.loops);
    itemOut << ",\"edges\":";
    writeStringArray(itemOut, item.edges);
    itemOut << ",\"area\":" << item.area << ",\"bbox\":";
    writeBBox(itemOut, item.bbox);
    itemOut << ",\"surfaceInfo\":{\"occSurfaceType\":" << quoted(item.surfaceType) << "}";
    itemOut << ",\"geometricSignature\":{\"surfaceType\":" << quoted(item.surfaceType) << ",\"area\":" << item.area << "}";
    itemOut << "}";
  });
  out << ",\"loops\":";
  writeArray(out, scene.loops, [](std::ostream& itemOut, const LoopEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "loop", item.tag, "occ/" + item.face + "/" + item.id);
    itemOut << ",\"face\":" << quoted(item.face) << ",\"loopType\":" << quoted(item.loopType) << ",\"coedges\":";
    writeStringArray(itemOut, item.coedges);
    itemOut << "}";
  });
  out << ",\"coedges\":";
  writeArray(out, scene.coedges, [](std::ostream& itemOut, const CoedgeEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "coedge", item.tag, "occ/" + item.loop + "/" + item.id);
    itemOut << ",\"loop\":" << quoted(item.loop)
            << ",\"edge\":" << quoted(item.edge)
            << ",\"sense\":" << quoted(item.sense)
            << ",\"next\":" << quoted(item.next)
            << ",\"previous\":" << quoted(item.previous)
            << "}";
  });
  out << ",\"edges\":";
  writeArray(out, scene.edges, [](std::ostream& itemOut, const EdgeEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "edge", item.tag, "occ/body0/edge" + std::to_string(item.tag - 1));
    itemOut << ",\"debugName\":" << quoted("OCC Edge " + std::to_string(item.tag))
            << ",\"curveType\":" << quoted(item.curveType)
            << ",\"vertices\":";
    writeStringArray(itemOut, item.vertices);
    itemOut << ",\"adjacentFaces\":";
    writeStringArray(itemOut, item.adjacentFaces);
    itemOut << ",\"length\":" << item.length << ",\"bbox\":";
    writeBBox(itemOut, item.bbox);
    itemOut << ",\"curveInfo\":{\"occCurveType\":" << quoted(item.curveType) << "}";
    itemOut << ",\"geometricSignature\":{\"curveType\":" << quoted(item.curveType) << ",\"length\":" << item.length << "}";
    itemOut << "}";
  });
  out << ",\"vertices\":";
  writeArray(out, scene.vertices, [](std::ostream& itemOut, const VertexEntity& item) {
    itemOut << "{";
    writeIdentity(itemOut, item.id, "vertex", item.tag, "occ/body0/vertex" + std::to_string(item.tag - 1));
    itemOut << ",\"position\":";
    writeVec3(itemOut, item.position);
    itemOut << ",\"edges\":";
    writeStringArray(itemOut, item.edges);
    itemOut << "}";
  });
  out << "},";

  out << "\"geometry\":{";
  out << "\"faceMeshes\":";
  writeArray(out, scene.faceMeshes, [](std::ostream& itemOut, const FaceMesh& item) {
    itemOut << "{\"entityId\":" << quoted(item.entityId) << ",\"meshId\":" << quoted("mesh:" + item.entityId) << ",\"positions\":";
    writeNumberArray(itemOut, item.positions);
    itemOut << ",\"normals\":[],\"indices\":";
    writeIndexArray(itemOut, item.indices);
    itemOut << ",\"display\":{\"visible\":true,\"opacity\":1,\"color\":" << quoted(item.color) << "}}";
  });
  out << ",\"edgePolylines\":";
  writeArray(out, scene.edgePolylines, [](std::ostream& itemOut, const EdgePolyline& item) {
    itemOut << "{\"entityId\":" << quoted(item.entityId) << ",\"polylineId\":" << quoted("polyline:" + item.entityId) << ",\"points\":";
    writeNumberArray(itemOut, item.points);
    itemOut << ",\"display\":{\"visible\":true,\"lineWidth\":1,\"color\":\"#1f2937\"}}";
  });
  out << ",\"vertexPoints\":";
  writeArray(out, scene.vertexPoints, [](std::ostream& itemOut, const VertexPoint& item) {
    itemOut << "{\"entityId\":" << quoted(item.entityId) << ",\"position\":";
    writeVec3(itemOut, item.position);
    itemOut << ",\"display\":{\"visible\":true,\"size\":1,\"color\":\"#f7f7f4\"}}";
  });
  out << ",\"transientObjects\":[]},";

  out << "\"properties\":{";
  bool firstProperty = true;
  auto writeBasic = [&](const std::string& id, const std::string& kind, int tag) {
    if (!firstProperty) {
      out << ",";
    }
    firstProperty = false;
    out << quoted(id) << ":{\"basic\":{\"entityId\":" << quoted(id)
        << ",\"kind\":" << quoted(kind)
        << ",\"tag\":" << tag
        << ",\"sourceKernel\":\"occ\"}}";
  };
  for (const auto& item : scene.bodies) {
    writeBasic(item.id, "body", item.tag);
  }
  for (const auto& item : scene.regions) {
    writeBasic(item.id, "region", 1);
  }
  for (const auto& item : scene.shells) {
    writeBasic(item.id, "shell", item.tag);
  }
  for (const auto& item : scene.faces) {
    if (!firstProperty) {
      out << ",";
    }
    firstProperty = false;
    out << quoted(item.id) << ":{\"basic\":{\"entityId\":" << quoted(item.id)
        << ",\"kind\":\"face\",\"tag\":" << item.tag
        << ",\"sourceKernel\":\"occ\"},\"surface\":{\"surfaceType\":" << quoted(item.surfaceType)
        << ",\"orientation\":" << quoted(item.orientation)
        << ",\"area\":" << item.area << "}}";
  }
  for (const auto& item : scene.edges) {
    if (!firstProperty) {
      out << ",";
    }
    firstProperty = false;
    out << quoted(item.id) << ":{\"basic\":{\"entityId\":" << quoted(item.id)
        << ",\"kind\":\"edge\",\"tag\":" << item.tag
        << ",\"sourceKernel\":\"occ\"},\"curve\":{\"curveType\":" << quoted(item.curveType)
        << ",\"length\":" << item.length << "}}";
  }
  for (const auto& item : scene.vertices) {
    writeBasic(item.id, "vertex", item.tag);
  }
  out << "},";

  out << "\"debug\":{\"algorithm\":\"OccExample\",\"step\":\"00_occ_box_cut\",\"message\":\"OCC example built a box and cut a cylindrical through-hole.\",\"algorithmData\":{\"occVersion\":"
      << quoted(OCC_VERSION_COMPLETE)
      << ",\"faceCount\":" << scene.faces.size()
      << ",\"edgeCount\":" << scene.edges.size()
      << ",\"vertexCount\":" << scene.vertices.size()
      << "}},";
  out << "\"capabilities\":{\"nativeWrapper\":\"occ\",\"example\":\"box_cut_cylinder\",\"readonly\":true}";
  out << "}\n";
}

void writeCaseFile(const fs::path& outputDirectory, const std::string& caseId) {
  std::ofstream out(outputDirectory / "index.gkcase.json");
  if (!out) {
    throw std::runtime_error("Could not open case file for writing");
  }
  out << "{\n"
      << "  \"gksVersion\": \"0.1\",\n"
      << "  \"caseId\": " << quoted(caseId) << ",\n"
      << "  \"title\": \"OCC Box Cut Case 001\",\n"
      << "  \"producer\": {\n"
      << "    \"name\": \"gk-occ-wrapper\",\n"
      << "    \"version\": \"0.4.1\",\n"
      << "    \"kernel\": \"occ\",\n"
      << "    \"buildType\": \"example\"\n"
      << "  },\n"
      << "  \"snapshots\": [\n"
      << "    {\n"
      << "      \"snapshotId\": \"00_occ_box_cut\",\n"
      << "      \"title\": \"OCC box cut through-hole\",\n"
      << "      \"file\": \"00_occ_box_cut.gkscene.json\"\n"
      << "    }\n"
      << "  ]\n"
      << "}\n";
}

fs::path parseOutputDirectory(int argc, char** argv) {
  fs::path outputDirectory = "examples/occ/OCCBox.Case_001";
  for (int index = 1; index < argc; ++index) {
    const std::string arg = argv[index];
    if ((arg == "--out" || arg == "-o") && index + 1 < argc) {
      outputDirectory = argv[++index];
    } else if (arg == "--help" || arg == "-h") {
      std::cout << "Usage: gk_occ_example [--out examples/occ/OCCBox.Case_001]\n";
      std::exit(0);
    } else {
      throw std::runtime_error("Unknown argument: " + arg);
    }
  }
  return outputDirectory;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const fs::path outputDirectory = parseOutputDirectory(argc, argv);
    fs::create_directories(outputDirectory);

    TopoDS_Shape shape = buildExampleShape();
    SceneData scene = collectScene(shape);

    writeCaseFile(outputDirectory, scene.caseId);
    std::ofstream sceneFile(outputDirectory / "00_occ_box_cut.gkscene.json");
    if (!sceneFile) {
      throw std::runtime_error("Could not open scene file for writing");
    }
    writeScene(sceneFile, scene);

    std::cout << "Wrote " << (outputDirectory / "index.gkcase.json") << "\n";
    std::cout << "Wrote " << (outputDirectory / "00_occ_box_cut.gkscene.json") << "\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "gk_occ_example failed: " << error.what() << "\n";
    return 1;
  }
}
