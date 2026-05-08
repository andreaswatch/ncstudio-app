// src/client/worker.ts
console.log("[Worker] Script loaded");
var wasmModule = null;
function resolveSiblingUrl(fileName, baseUrl) {
  const base = new URL(baseUrl, self.location.href);
  const sibling = new URL(fileName, base);
  sibling.search = base.search;
  return sibling.href;
}
async function loadWasmModule(moduleUrl) {
  const resolvedModuleUrl = new URL(moduleUrl, self.location.href).href;
  const wasmUrl = resolveSiblingUrl("cadserver.wasm", resolvedModuleUrl);
  console.log("[Worker] Loading factory from:", resolvedModuleUrl);
  const module = await import(resolvedModuleUrl);
  const factory = module.default;
  console.log("[Worker] Fetching WASM binary from:", wasmUrl);
  const wasmResponse = await fetch(wasmUrl);
  if (!wasmResponse.ok) {
    throw new Error(`Failed to fetch WASM: ${wasmResponse.status} ${wasmResponse.statusText}`);
  }
  const wasmBinary = await wasmResponse.arrayBuffer();
  console.log("[Worker] WASM binary loaded, size:", wasmBinary.byteLength);
  console.log("[Worker] Initializing Emscripten module...");
  wasmModule = await factory({
    wasmBinary,
    locateFile: (file) => resolveSiblingUrl(file, resolvedModuleUrl)
  });
  self.Module = wasmModule;
  console.log("[Worker] STEP import mode: default");
  if (wasmModule && typeof wasmModule._initCadServer === "function") {
    console.log("[Worker] Calling _initCadServer...");
    wasmModule._initCadServer();
  }
  console.log("[Worker] WASM module ready");
}
function isEmbindVector(value) {
  return value !== null && typeof value === "object" && typeof value.size === "function" && typeof value.get === "function";
}
function vectorToArray(vec) {
  if (!isEmbindVector(vec)) return vec;
  const size = vec.size();
  const result = [];
  for (let i = 0; i < size; i++) {
    result.push(vec.get(i));
  }
  return result;
}
function toVectorIntFromArray(values) {
  if (!wasmModule || typeof wasmModule.VectorInt !== "function") {
    return values;
  }
  const vec = new wasmModule.VectorInt();
  for (const value of values) {
    vec.push_back(Number(value));
  }
  return vec;
}
function createInvalidBRepGraphUid() {
  return { kind: 0, counter: 0, generation: 0 };
}
function toVectorBRepGraphUidFromArray(values) {
  if (!wasmModule || typeof wasmModule.VectorBRepGraphUid !== "function") {
    return values;
  }
  const vec = new wasmModule.VectorBRepGraphUid();
  for (const value of values) {
    vec.push_back(value);
  }
  return vec;
}
function toVectorDocumentBRepGraphUidFromArray(values) {
  if (!wasmModule || typeof wasmModule.VectorDocumentBRepGraphUid !== "function") {
    return values;
  }
  const vec = new wasmModule.VectorDocumentBRepGraphUid();
  for (const value of values) {
    vec.push_back(normalizeDocumentBRepGraphUidForWasm(value));
  }
  return vec;
}
function isDocumentBRepGraphUidLike(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isEmbindVector(value)) {
    return false;
  }
  const candidate = value;
  return typeof candidate.docId === "number" && candidate.uid !== null && typeof candidate.uid === "object";
}
function normalizeDocumentBRepGraphUidForWasm(value) {
  if (!isDocumentBRepGraphUidLike(value)) {
    return value;
  }
  const nextValue = { ...value };
  if (nextValue.kind === void 0 || nextValue.kind === null) {
    nextValue.kind = "SHAPE";
  }
  if (!nextValue.occurrenceUid) {
    nextValue.occurrenceUid = { kind: 0, counter: 0, generation: 0 };
  }
  return nextValue;
}
function normalizeNestedTransportValueForWasm(value) {
  if (value === null || value === void 0 || isEmbindVector(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeNestedTransportValueForWasm(entry));
  }
  const normalizedNode = normalizeDocumentBRepGraphUidForWasm(value);
  if (normalizedNode !== value) {
    return normalizedNode;
  }
  if (typeof value !== "object") {
    return value;
  }
  const nextValue = { ...value };
  for (const [key, entry] of Object.entries(nextValue)) {
    nextValue[key] = normalizeNestedTransportValueForWasm(entry);
  }
  return nextValue;
}
function toVectorVec3FromArray(points) {
  if (!wasmModule || typeof wasmModule.VectorVec3 !== "function") {
    return points;
  }
  const vec = new wasmModule.VectorVec3();
  for (const point of points) {
    vec.push_back(point);
  }
  return vec;
}
function toVectorFilletRadiusPointFromArray(points) {
  if (!wasmModule || typeof wasmModule.VectorFilletRadiusPoint !== "function") {
    return points;
  }
  const vec = new wasmModule.VectorFilletRadiusPoint();
  for (const point of points) {
    vec.push_back(point);
  }
  return vec;
}
var OPERATION_ENUM_SPECS = {
  Fillet: [
    {
      field: "profileMode",
      enumType: "FilletProfileMode",
      values: { 1: "FILLET_PROFILE_LINEAR", 2: "FILLET_PROFILE_POINTS" },
      fallback: "FILLET_PROFILE_CONSTANT"
    },
    {
      field: "filletShape",
      enumType: "FilletShapeMode",
      values: { 1: "FILLET_SHAPE_QUASI_ANGULAR", 2: "FILLET_SHAPE_POLYNOMIAL" },
      fallback: "FILLET_SHAPE_RATIONAL"
    },
    {
      field: "continuity",
      enumType: "SurfaceContinuityMode",
      values: { 0: "SURFACE_CONTINUITY_C0", 2: "SURFACE_CONTINUITY_C2" },
      fallback: "SURFACE_CONTINUITY_C1",
      condition: (req) => req.useSurfaceContinuity === true
    }
  ],
  Chamfer: [
    {
      field: "mode",
      enumType: "ChamferMode",
      values: { 1: "CHAMFER_MODE_TWO_DISTANCES", 2: "CHAMFER_MODE_DISTANCE_ANGLE" },
      fallback: "CHAMFER_MODE_SYMMETRIC"
    }
  ],
  Boolean: [
    {
      field: "operation",
      enumType: "BooleanOperationType",
      values: { 1: "FUSE", 2: "COMMON" },
      fallback: "CUT"
    }
  ]
};
function normalizeRequestForWasm(method, request) {
  var _a, _b;
  if (!request || typeof request !== "object") return request;
  const nextRequest = normalizeNestedTransportValueForWasm({ ...request });
  const enumSpecs = OPERATION_ENUM_SPECS[method];
  if (enumSpecs) {
    for (const spec of enumSpecs) {
      if (spec.condition && !spec.condition(nextRequest)) {
        nextRequest[_a = spec.field] ?? (nextRequest[_a] = 1);
        continue;
      }
      const enumObj = wasmModule?.[spec.enumType];
      if (enumObj) {
        const raw = nextRequest[spec.field] ?? 0;
        nextRequest[spec.field] = spec.values[raw] !== void 0 ? enumObj[spec.values[raw]] : enumObj[spec.fallback];
      } else {
        nextRequest[_b = spec.field] ?? (nextRequest[_b] = 0);
      }
    }
  }
  if (method === "Fillet") {
    nextRequest.propagateConnectedEdges ?? (nextRequest.propagateConnectedEdges = false);
    nextRequest.allowCornerConflicts ?? (nextRequest.allowCornerConflicts = true);
    nextRequest.radius ?? (nextRequest.radius = 0);
    nextRequest.startRadius ?? (nextRequest.startRadius = 0);
    nextRequest.endRadius ?? (nextRequest.endRadius = 0);
    nextRequest.radiusPoints ?? (nextRequest.radiusPoints = toVectorFilletRadiusPointFromArray([]));
    nextRequest.useSurfaceContinuity ?? (nextRequest.useSurfaceContinuity = false);
    nextRequest.angularTolerance ?? (nextRequest.angularTolerance = 0);
  }
  if (method === "Chamfer") {
    nextRequest.propagateConnectedEdges ?? (nextRequest.propagateConnectedEdges = false);
    nextRequest.allowCornerConflicts ?? (nextRequest.allowCornerConflicts = true);
    nextRequest.distance ?? (nextRequest.distance = 0);
    nextRequest.distance1 ?? (nextRequest.distance1 = 0);
    nextRequest.distance2 ?? (nextRequest.distance2 = 0);
    nextRequest.angle ?? (nextRequest.angle = 0);
    nextRequest.referenceFaceUid ?? (nextRequest.referenceFaceUid = createInvalidBRepGraphUid());
  }
  if (method === "Boolean") {
    nextRequest.fuzzyValue ?? (nextRequest.fuzzyValue = 0);
    nextRequest.useGlue ?? (nextRequest.useGlue = false);
    nextRequest.glueMode ?? (nextRequest.glueMode = 0);
    nextRequest.simplifyResult ?? (nextRequest.simplifyResult = false);
    nextRequest.simplifyFaces ?? (nextRequest.simplifyFaces = true);
    nextRequest.simplifyEdges ?? (nextRequest.simplifyEdges = true);
  }
  if (method === "Extrude") {
    nextRequest.faceUid ?? (nextRequest.faceUid = createInvalidBRepGraphUid());
  }
  for (const [key, value] of Object.entries(nextRequest)) {
    if (value === null) {
      delete nextRequest[key];
    }
  }
  if (Array.isArray(nextRequest.points)) {
    nextRequest.points = toVectorVec3FromArray(nextRequest.points);
  }
  if (Array.isArray(nextRequest.radiusPoints)) {
    nextRequest.radiusPoints = toVectorFilletRadiusPointFromArray(nextRequest.radiusPoints);
  }
  const vectorIntFields = ["edgeIndices", "faceIndices", "excludeFaces"];
  for (const fieldName of vectorIntFields) {
    if (Array.isArray(nextRequest[fieldName])) {
      nextRequest[fieldName] = toVectorIntFromArray(nextRequest[fieldName]);
    }
  }
  const vectorBRepGraphUidFields = ["edgeUids", "faceUids", "excludeFaceUids"];
  for (const fieldName of vectorBRepGraphUidFields) {
    if (Array.isArray(nextRequest[fieldName])) {
      nextRequest[fieldName] = toVectorBRepGraphUidFromArray(nextRequest[fieldName]);
    }
  }
  const vectorDocumentBRepGraphUidFields = ["profiles"];
  for (const fieldName of vectorDocumentBRepGraphUidFields) {
    if (Array.isArray(nextRequest[fieldName])) {
      nextRequest[fieldName] = toVectorDocumentBRepGraphUidFromArray(nextRequest[fieldName]);
    }
  }
  const vectorDocumentBRepGraphUidArrayFields = ["nodes", "edges"];
  for (const fieldName of vectorDocumentBRepGraphUidArrayFields) {
    if (Array.isArray(nextRequest[fieldName])) {
      nextRequest[fieldName] = toVectorDocumentBRepGraphUidFromArray(nextRequest[fieldName]);
    }
  }
  void method;
  return nextRequest;
}
function sanitizeResponse(data) {
  if (data === null || data === void 0) return data;
  if (typeof data === "bigint") {
    return Number(data);
  }
  if (isEmbindVector(data)) {
    return vectorToArray(data).map((item) => sanitizeResponse(item));
  }
  if (typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeResponse(item));
  }
  const result = {};
  try {
    const keys = Object.keys(data);
    for (const key of keys) {
      try {
        const value = data[key];
        result[key] = sanitizeResponse(value);
      } catch (e) {
        void e;
      }
    }
  } catch (e) {
    void e;
    return data;
  }
  return result;
}
self.onerror = (message, source, lineno, colno, error) => {
  console.error("[Worker] Global error:", { message, source, lineno, colno, error });
  return false;
};
self.onunhandledrejection = (event) => {
  console.error("[Worker] Unhandled promise rejection:", event.reason);
};
function respond(response) {
  self.postMessage(response);
}
self.onmessage = async (event) => {
  const msg = event.data;
  if (msg == null || typeof msg.id !== "number" && typeof msg.id !== "string") {
    return;
  }
  const { id, type } = msg;
  try {
    switch (type) {
      case "initialize": {
        await loadWasmModule(msg.moduleUrl);
        respond({ id, type: "result" });
        break;
      }
      case "invoke": {
        const method = msg.method;
        if (!wasmModule) {
          throw new Error("WASM module not initialized");
        }
        if (!(method in wasmModule)) {
          throw new Error(`Method ${method} not found in WASM module`);
        }
        const normalizedRequest = normalizeRequestForWasm(method, msg.request);
        const rawResponse = wasmModule[method](normalizedRequest);
        const sanitized = sanitizeResponse(rawResponse);
        respond({ id, type: "result", result: sanitized });
        break;
      }
      case "invokeBinary": {
        const method = msg.method;
        if (!wasmModule) {
          throw new Error("WASM module not initialized");
        }
        if (!(method in wasmModule)) {
          throw new Error(`Method ${method} not found in WASM module`);
        }
        const normalizedRequest = normalizeRequestForWasm(method, msg.request);
        const req = { ...normalizedRequest, data: msg.binaryData };
        const rawResponse = wasmModule[method](req);
        const sanitized = sanitizeResponse(rawResponse);
        respond({ id, type: "result", result: sanitized });
        break;
      }
      default: {
        respond({ id, type: "error", error: `Unknown message type: ${type}` });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Worker] Error handling ${type}:`, errorMessage);
    respond({ id, type: "error", error: errorMessage });
  }
};
//# sourceMappingURL=worker.js.map
