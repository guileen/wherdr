// Node crossws must reject oversized/fragmented messages before constructing a Message.
// This matches the existing 256 KiB application ceiling; Graph requests impose 64 KiB too.
export default defineNitroPlugin((nitroApp) => {
  Object.assign(nitroApp.h3App.websocket, { serverOptions: { maxPayload: 256 * 1024, perMessageDeflate: false } })
})
