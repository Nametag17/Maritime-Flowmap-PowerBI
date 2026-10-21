// The bundled map data (TopoJSON) is imported as untyped JSON; typing multi-MB files would slow tsc down.
declare module "*.json" {
    const value: unknown;
    export default value;
}
