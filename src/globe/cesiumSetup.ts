// Cesium loads its web workers and assets from this folder (copied from node_modules by `npm run copy-cesium`).
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = import.meta.env.BASE_URL + 'cesium/';
export {};
