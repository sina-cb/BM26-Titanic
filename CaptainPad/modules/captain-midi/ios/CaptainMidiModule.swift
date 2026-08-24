// CaptainMidiModule — the iPadOS CoreMIDI bridge for CaptainPad.
//
// This is layer 1a of docs/34 §Architecture: the native-side implementation
// of the frozen `MidiTransport` five-call surface. It runs against CoreMIDI
// directly (no third-party MIDI dependency, no MIDI-over-network) and is
// vendored in the repo for playa compliance.
//
// SHARED-MODULE, PER-TRANSPORT-OPENED-ID DESIGN
// ─────────────────────────────────────────────
// CaptainPad runs MULTIPLE controllers concurrently — APC + MFT + VSN1 each
// get their own `NativeMidiTransport` above this module, but the module
// itself is one shared native handle. So the design here is:
//
//   * ONE MIDIClient, ONE input port, ONE output port for the whole app.
//   * The input port has MANY source endpoints connected to it (one per
//     controller). Each source is registered with a per-source `refCon`
//     carrying the source's stable id, so the read block can identify who
//     sent an inbound packet — the JS side then filters by that id.
//   * The output side is stateless in CoreMIDI: `MIDISend` takes a
//     destination endpoint each call, so the JS transport passes the
//     destination id it wants to send to on every `send`.
//
// Codex P0 — no fallbacks:
//   * `openSource` / `openDestination` throw with the endpoints ACTUALLY seen
//     when the requested id is gone; nothing here auto-picks a different port.
//   * `send` validates each byte is 0…255 and refuses to fire before a
//     destination id is provided; CoreMIDI status codes propagate verbatim
//     as `OSStatus <n>` — a red chip carries the real reason.
//   * A source that is already connected is idempotent (no double-connect).
//     A source that fails to connect leaves NO refCon retained (balanced
//     `Unmanaged.release`) — never a silent leak.

import CoreMIDI
import ExpoModulesCore
import Foundation

private let LOG_PREFIX = "[CaptainMidi]"

// Thrown to the JS side as a rejected Promise / raised Function error.
private struct MidiError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }

    static func endpointNotFound(_ kind: String, _ id: String, seen: [String]) -> MidiError {
        let seenList = seen.isEmpty ? "(none)" : seen.map { "\"\($0)\"" }.joined(separator: ", ")
        return MidiError(message: "MIDI \(kind) endpoint '\(id)' is not available. \(kind)s seen: \(seenList)")
    }

    static func destinationNotSet() -> MidiError {
        MidiError(message: "MIDI destination is not set — call openDestination(id) first")
    }

    static func invalidBytes(_ reason: String) -> MidiError {
        MidiError(message: "invalid MIDI bytes: \(reason)")
    }

    static func status(_ op: String, _ status: OSStatus) -> MidiError {
        MidiError(message: "\(op) failed (OSStatus \(status))")
    }
}

// Serial queue for driver-thread hand-off and mutation of connected-source
// state. Every ivar mutation happens on this queue (or on the module
// lifecycle callbacks which are themselves serial), so the read block can
// safely read the connected-sources map for the event payload.
private let dispatchQueue = DispatchQueue(label: "com.titanicrig.captainpad.captainmidi", qos: .userInteractive)

/// Endpoint identity. Prefer CoreMIDI's `MIDIUniqueID` when the driver
/// exposes it (persistent across sessions / hotplugs); otherwise fall back
/// to `name:<kind>:<portIndex>:<display name>` — that pin is deterministic
/// and NOT auto-picked (endpoints.ts resolves it against the profile's own
/// portIndex).
private func stableId(for ref: MIDIEndpointRef, kind: String, portIndex: Int) -> String {
    var uid: Int32 = 0
    let status = MIDIObjectGetIntegerProperty(ref, kMIDIPropertyUniqueID, &uid)
    if status == noErr && uid != 0 {
        return "uid:\(kind):\(uid)"
    }
    return "name:\(kind):\(portIndex):\(displayName(for: ref))"
}

private func displayName(for ref: MIDIEndpointRef) -> String {
    var name: Unmanaged<CFString>?
    let status = MIDIObjectGetStringProperty(ref, kMIDIPropertyDisplayName, &name)
    if status == noErr, let cf = name?.takeRetainedValue() {
        return cf as String
    }
    return ""
}

private func endpointDescriptor(for ref: MIDIEndpointRef, kind: String, portIndex: Int) -> [String: Any] {
    [
        "id": stableId(for: ref, kind: kind, portIndex: portIndex),
        "name": displayName(for: ref),
        "portIndex": portIndex,
        "kind": kind,
    ]
}

/// One connected source's bookkeeping. `refCon` is a retained NSString
/// pointer holding the source's stable id, passed to
/// `MIDIPortConnectSource` so the read block can identify inbound packets.
private struct ConnectedSource {
    let ref: MIDIEndpointRef
    let refCon: UnsafeMutableRawPointer
}

public class CaptainMidiModule: Module {
    // CoreMIDI handles. `0` means "not created" throughout CoreMIDI.
    private var client: MIDIClientRef = 0
    private var inputPort: MIDIPortRef = 0
    private var outputPort: MIDIPortRef = 0

    // Every source the JS side has asked to open, keyed by its stable id.
    // Multiple JS `NativeMidiTransport` instances share this map — the read
    // block emits an event tagged with the source's id and each JS transport
    // filters by its own opened id (mirrors the WebMidiTransport per-input
    // `onmidimessage` scoping, adapted to CoreMIDI's port-of-many-sources
    // model).
    private var connectedSources: [String: ConnectedSource] = [:]
    // Bounded field diagnostic: log only the FIRST inbound packet per opened
    // source, proving bytes crossed CoreMIDI without spamming Release logs on
    // every encoder tick. Keyed by stable id internally; the id is never logged.
    private var loggedInboundSources: Set<String> = []
    // Bounded VSN1 encoder diagnostic for physical tuning: first 32 absolute
    // values after each source open, then silent for the rest of the session.
    private var encoderLogCount: [String: Int] = [:]
    // End timestamp of the last scheduled batch per destination. Successive
    // layout snapshots serialize instead of interleaving their characters.
    private var nextBatchTimestamp: [String: MIDITimeStamp] = [:]

    public func definition() -> ModuleDefinition {
        Name("CaptainMidi")

        // Two events, matching `MidiTransport`:
        //   `midiMessage`      one inbound MIDI packet (raw bytes + source id)
        //   `endpointsChanged` CoreMIDI hotplug / setup-changed nudge
        Events("midiMessage", "endpointsChanged")

        OnCreate {
            self.createClientAndPorts()
        }

        OnDestroy {
            self.teardown()
        }

        AsyncFunction("listEndpoints") { () -> [[String: Any]] in
            var out: [[String: Any]] = []
            let numSources = MIDIGetNumberOfSources()
            for i in 0..<numSources {
                let ref = MIDIGetSource(i)
                if ref != 0 {
                    out.append(endpointDescriptor(for: ref, kind: "source", portIndex: Int(i)))
                }
            }
            let numDests = MIDIGetNumberOfDestinations()
            for i in 0..<numDests {
                let ref = MIDIGetDestination(i)
                if ref != 0 {
                    out.append(endpointDescriptor(for: ref, kind: "destination", portIndex: Int(i)))
                }
            }
            return out
        }

        AsyncFunction("openSource") { (id: String) in
            let ref = try self.findEndpoint(kind: "source", id: id)
            try dispatchQueue.sync {
                // Idempotent: an existing exact match is a no-op. Any prior
                // record for THIS id that isn't the current ref (which can
                // only happen after a rare replug re-numbering) is released
                // before we reconnect so refCons never leak.
                if let existing = self.connectedSources[id] {
                    if existing.ref == ref {
                        return
                    }
                    MIDIPortDisconnectSource(self.inputPort, existing.ref)
                    Unmanaged<NSString>.fromOpaque(existing.refCon).release()
                    self.connectedSources.removeValue(forKey: id)
                }
                if self.inputPort == 0 {
                    throw MidiError.status("MIDIInputPortCreate", -1)
                }
                let idNS = id as NSString
                let refCon = Unmanaged.passRetained(idNS).toOpaque()
                let status = MIDIPortConnectSource(self.inputPort, ref, refCon)
                if status != noErr {
                    // Balance the passRetained so an aborted connect never leaks.
                    Unmanaged<NSString>.fromOpaque(refCon).release()
                    throw MidiError.status("MIDIPortConnectSource", status)
                }
                self.connectedSources[id] = ConnectedSource(ref: ref, refCon: refCon)
                self.loggedInboundSources.remove(id)
                self.encoderLogCount[id] = 0
                NSLog("\(LOG_PREFIX) opened MIDI source name=\"\(displayName(for: ref))\"")
            }
        }

        AsyncFunction("disconnectSource") { (id: String) in
            dispatchQueue.sync {
                guard let entry = self.connectedSources.removeValue(forKey: id) else {
                    return
                }
                MIDIPortDisconnectSource(self.inputPort, entry.ref)
                Unmanaged<NSString>.fromOpaque(entry.refCon).release()
                self.loggedInboundSources.remove(id)
                self.encoderLogCount.removeValue(forKey: id)
            }
        }

        // Destinations are stateless in CoreMIDI (MIDISend takes the endpoint
        // per call), but we still validate the endpoint EXISTS at
        // openDestination time so a missing endpoint fails loud immediately
        // rather than at first send. Matches the WebMidiTransport shape.
        AsyncFunction("openDestination") { (id: String) in
            let ref = try self.findEndpoint(kind: "destination", id: id)
            NSLog("\(LOG_PREFIX) opened MIDI destination name=\"\(displayName(for: ref))\"")
        }

        // `send` is synchronous: the LED projector fires per-tick and a
        // Promise round-trip would show up as a visible latency budget hit.
        Function("send") { (destinationId: String, bytes: [Int]) in
            try self.performSend(destinationId: destinationId, bytes: bytes)
        }

        // Schedule a high-volume transaction as one CoreMIDI packet list.
        // Future timestamps pace packets at the driver boundary without
        // blocking React Native's JS thread. Used by the VSN1 layout stream.
        Function("sendBatch") { (destinationId: String, messages: [[Int]], spacingMs: Double) in
            try self.performSendBatch(
                destinationId: destinationId,
                messages: messages,
                spacingMs: spacingMs
            )
        }

        // Convenience: disconnect every source THIS module currently holds.
        // Not routinely called by the JS transport (each transport uses
        // `disconnectSource(id)` for its own opened source) — intended for
        // hard resets / test teardown. Idempotent.
        Function("closeAll") {
            self.disconnectAllSources()
        }
    }

    // MARK: - Lifecycle

    private func createClientAndPorts() {
        // MIDI client with a hotplug notification block. The block fires on
        // ANY CoreMIDI object add/remove/setup-change; we forward every one
        // to JS as `endpointsChanged`. The JS runtime debounces (~50 ms) so a
        // multi-port controller hotplug still runs one reconnect pass.
        let clientName = "CaptainPad" as CFString
        let clientStatus = MIDIClientCreateWithBlock(clientName, &self.client) { [weak self] notificationPtr in
            guard let self = self else { return }
            let msgId = notificationPtr.pointee.messageID
            switch msgId {
            case .msgObjectAdded, .msgObjectRemoved, .msgSetupChanged:
                dispatchQueue.async {
                    self.sendEvent("endpointsChanged", [:])
                }
            default:
                break
            }
        }
        if clientStatus != noErr {
            NSLog("\(LOG_PREFIX) MIDIClientCreateWithBlock failed: \(clientStatus)")
            return
        }

        // Input port with a block-based read callback. The block runs on
        // CoreMIDI's own driver thread — we hop to `dispatchQueue` before
        // touching state or firing an event so the JS side always sees a
        // serial stream.
        let inputName = "CaptainPadIn" as CFString
        let inputStatus = MIDIInputPortCreateWithBlock(self.client, inputName, &self.inputPort) { [weak self] pktListPtr, srcConnRefCon in
            guard let self = self else { return }
            self.handlePacketList(pktListPtr, refCon: srcConnRefCon)
        }
        if inputStatus != noErr {
            NSLog("\(LOG_PREFIX) MIDIInputPortCreateWithBlock failed: \(inputStatus)")
        }

        // Output port for LED / SysEx feedback.
        let outputName = "CaptainPadOut" as CFString
        let outputStatus = MIDIOutputPortCreate(self.client, outputName, &self.outputPort)
        if outputStatus != noErr {
            NSLog("\(LOG_PREFIX) MIDIOutputPortCreate failed: \(outputStatus)")
        }

        // One compact startup inventory is intentionally retained in Release
        // builds for field diagnostics. CoreMIDI endpoint display names are the
        // exact strings the checked-in profiles match; iPadOS and desktop MIDI
        // drivers can expose the same controller under different names. Logging
        // only kind + display name (no payload bytes, app state, or identifiers)
        // lets the operator diagnose a deterministic-match refusal without
        // weakening it into an unsafe auto-pick.
        let sourceNames = (0..<MIDIGetNumberOfSources()).compactMap { index -> String? in
            let ref = MIDIGetSource(index)
            return ref == 0 ? nil : displayName(for: ref)
        }
        let destinationNames = (0..<MIDIGetNumberOfDestinations()).compactMap { index -> String? in
            let ref = MIDIGetDestination(index)
            return ref == 0 ? nil : displayName(for: ref)
        }
        NSLog(
            "\(LOG_PREFIX) CoreMIDI ready; sources=\(sourceNames); destinations=\(destinationNames)"
        )
    }

    private func disconnectAllSources() {
        dispatchQueue.sync {
            for (_, entry) in self.connectedSources {
                MIDIPortDisconnectSource(self.inputPort, entry.ref)
                Unmanaged<NSString>.fromOpaque(entry.refCon).release()
            }
            self.connectedSources.removeAll()
            self.loggedInboundSources.removeAll()
            self.encoderLogCount.removeAll()
        }
    }

    private func teardown() {
        disconnectAllSources()
        if self.inputPort != 0 {
            MIDIPortDispose(self.inputPort)
            self.inputPort = 0
        }
        if self.outputPort != 0 {
            MIDIPortDispose(self.outputPort)
            self.outputPort = 0
        }
        if self.client != 0 {
            MIDIClientDispose(self.client)
            self.client = 0
        }
    }

    // MARK: - Endpoint lookup

    private func findEndpoint(kind: String, id: String) throws -> MIDIEndpointRef {
        let count: Int
        let getter: (Int) -> MIDIEndpointRef
        if kind == "source" {
            count = MIDIGetNumberOfSources()
            getter = { MIDIGetSource($0) }
        } else {
            count = MIDIGetNumberOfDestinations()
            getter = { MIDIGetDestination($0) }
        }
        var seen: [String] = []
        for i in 0..<count {
            let ref = getter(i)
            guard ref != 0 else { continue }
            let candidate = stableId(for: ref, kind: kind, portIndex: i)
            seen.append(displayName(for: ref))
            if candidate == id {
                return ref
            }
        }
        throw MidiError.endpointNotFound(kind, id, seen: seen)
    }

    // MARK: - Send path

    private func performSend(destinationId: String, bytes: [Int]) throws {
        if destinationId.isEmpty {
            throw MidiError.destinationNotSet()
        }
        if bytes.isEmpty {
            throw MidiError.invalidBytes("empty payload")
        }
        // Byte-range validation before we go anywhere near CoreMIDI. A JS
        // caller writing a negative or >255 value is a bug the fail-loud
        // path names, never a truncation.
        for (offset, value) in bytes.enumerated() {
            if value < 0 || value > 255 {
                throw MidiError.invalidBytes("byte[\(offset)] = \(value) out of range 0…255")
            }
        }
        let destRef = try self.findEndpoint(kind: "destination", id: destinationId)
        var port: MIDIPortRef = 0
        dispatchQueue.sync {
            port = self.outputPort
        }
        if port == 0 {
            throw MidiError.status("MIDIOutputPortCreate", -1)
        }

        // Allocate a packet list big enough for the (single) packet with
        // room for the raw bytes and CoreMIDI's own overhead. We use one
        // packet per send() call — the JS transport interface guarantees
        // one MIDI message per call, so no batching is needed here.
        let byteCount = bytes.count
        // Base MIDIPacketList size plus the raw payload — MIDIPacketList's
        // trailing packet has an inline 256-byte tuple, so add anything past
        // that to the base size.
        let extraBytes = max(0, byteCount - 256)
        let listSize = MemoryLayout<MIDIPacketList>.size + extraBytes
        let listPtrRaw = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { listPtrRaw.deallocate() }
        let listPtr = listPtrRaw.bindMemory(to: MIDIPacketList.self, capacity: 1)

        var packetPtr = MIDIPacketListInit(listPtr)
        let payload: [UInt8] = bytes.map { UInt8($0) }
        packetPtr = payload.withUnsafeBufferPointer { buf -> UnsafeMutablePointer<MIDIPacket> in
            MIDIPacketListAdd(listPtr, listSize, packetPtr, 0, byteCount, buf.baseAddress!)
        }
        if packetPtr == UnsafeMutablePointer<MIDIPacket>(bitPattern: 0) {
            throw MidiError.status("MIDIPacketListAdd", -1)
        }

        let status = MIDISend(port, destRef, listPtr)
        if status != noErr {
            throw MidiError.status("MIDISend", status)
        }
        if bytes.count >= 3,
           (bytes[0] & 0xf0) == 0xb0,
           bytes[1] == 127,
           displayName(for: destRef).contains("Grid") {
            NSLog(
                "\(LOG_PREFIX) sent VSN1 layout commit revision=\(bytes[2])"
            )
        }
    }

    private func performSendBatch(
        destinationId: String,
        messages: [[Int]],
        spacingMs: Double
    ) throws {
        if messages.isEmpty || messages.count > 512 {
            throw MidiError.invalidBytes("batch must contain 1…512 messages")
        }
        if !spacingMs.isFinite || spacingMs < 0.5 || spacingMs > 10 {
            throw MidiError.invalidBytes("batch spacing must be 0.5…10 ms")
        }
        for (messageIndex, bytes) in messages.enumerated() {
            if bytes.isEmpty || bytes.count > 256 {
                throw MidiError.invalidBytes(
                    "message[\(messageIndex)] must contain 1…256 bytes"
                )
            }
            for (byteIndex, value) in bytes.enumerated() where value < 0 || value > 255 {
                throw MidiError.invalidBytes(
                    "message[\(messageIndex)][\(byteIndex)] = \(value) out of range 0…255"
                )
            }
        }

        let destRef = try self.findEndpoint(kind: "destination", id: destinationId)
        var port: MIDIPortRef = 0
        dispatchQueue.sync {
            port = self.outputPort
        }
        if port == 0 {
            throw MidiError.status("MIDIOutputPortCreate", -1)
        }

        // Deliberately over-allocate one full MIDIPacket per message. CoreMIDI
        // packs them more tightly, but this keeps the capacity calculation
        // simple and safely bounded (<140 KiB at the 512-message limit).
        let listSize = MemoryLayout<MIDIPacketList>.size
            + messages.count * (MemoryLayout<MIDIPacket>.size + 16)
        let listPtrRaw = UnsafeMutableRawPointer.allocate(
            byteCount: listSize,
            alignment: MemoryLayout<MIDIPacketList>.alignment
        )
        defer { listPtrRaw.deallocate() }
        let listPtr = listPtrRaw.bindMemory(to: MIDIPacketList.self, capacity: 1)
        var packetPtr = MIDIPacketListInit(listPtr)

        let info = machTimebaseInfo
        let ticksPerMs = 1_000_000.0 * Double(info.denom) / Double(info.numer)
        // Give CoreMIDI a short lead so the first timestamp is not already stale
        // by the time the complete packet list reaches the driver.
        let earliestStart = mach_absolute_time() + UInt64(2.0 * ticksPerMs)
        var start = earliestStart
        dispatchQueue.sync {
            start = max(
                earliestStart,
                self.nextBatchTimestamp[destinationId] ?? earliestStart
            )
            self.nextBatchTimestamp[destinationId] = start
                + UInt64(Double(messages.count) * spacingMs * ticksPerMs)
        }
        for (index, bytes) in messages.enumerated() {
            let payload = bytes.map { UInt8($0) }
            let timestamp = start + UInt64(Double(index) * spacingMs * ticksPerMs)
            packetPtr = payload.withUnsafeBufferPointer { buffer in
                MIDIPacketListAdd(
                    listPtr,
                    listSize,
                    packetPtr,
                    timestamp,
                    payload.count,
                    buffer.baseAddress!
                )
            }
            if packetPtr == UnsafeMutablePointer<MIDIPacket>(bitPattern: 0) {
                throw MidiError.status("MIDIPacketListAdd(batch)", -1)
            }
        }

        let status = MIDISend(port, destRef, listPtr)
        if status != noErr {
            throw MidiError.status("MIDISend(batch)", status)
        }
        if let commit = messages.first(where: {
            $0.count >= 3 && ($0[0] & 0xf0) == 0xb0 && $0[1] == 127
        }),
           commit.count >= 3,
           displayName(for: destRef).contains("Grid") {
            NSLog(
                "\(LOG_PREFIX) scheduled VSN1 layout batch messages=\(messages.count) revision=\(commit[2]) spacingMs=\(spacingMs)"
            )
        }
    }

    // MARK: - Receive path

    private func handlePacketList(_ pktListPtr: UnsafePointer<MIDIPacketList>, refCon: UnsafeMutableRawPointer?) {
        let numPackets = Int(pktListPtr.pointee.numPackets)
        guard numPackets > 0 else { return }

        // The source id was stashed in refCon at MIDIPortConnectSource time
        // as a retained NSString. `takeUnretainedValue()` reads it WITHOUT
        // releasing the retain — the release happens at disconnect.
        let sourceId: String
        if let ptr = refCon {
            sourceId = Unmanaged<NSString>.fromOpaque(ptr).takeUnretainedValue() as String
        } else {
            sourceId = ""
        }

        // Walk the packet list via raw-pointer arithmetic so `MIDIPacketNext`
        // (which needs a REAL packet pointer in the buffer, not a stack copy)
        // stays correct across packets of arbitrary length.
        let packetOffset = MemoryLayout.offset(of: \MIDIPacketList.packet) ?? MemoryLayout<UInt32>.size
        let dataOffset = MemoryLayout.offset(of: \MIDIPacket.data) ?? (MemoryLayout<MIDITimeStamp>.size + MemoryLayout<UInt16>.size)
        var raw = UnsafeRawPointer(pktListPtr).advanced(by: packetOffset)

        for _ in 0..<numPackets {
            let packetPtr = raw.assumingMemoryBound(to: MIDIPacket.self)
            let length = Int(packetPtr.pointee.length)
            let timeStamp = packetPtr.pointee.timeStamp

            var bytes: [Int] = []
            bytes.reserveCapacity(length)
            let dataPtr = raw.advanced(by: dataOffset)
            for i in 0..<length {
                bytes.append(Int(dataPtr.load(fromByteOffset: i, as: UInt8.self)))
            }

            // MIDIPacket.timeStamp is a mach-abs-time value. Convert to a
            // monotonic millisecond figure JS can compare with
            // performance.now (both share the host mach clock).
            let timestampMs = machAbsToMillis(timeStamp)

            let capturedSourceId = sourceId
            let capturedBytes = bytes
            dispatchQueue.async {
                if !self.loggedInboundSources.contains(capturedSourceId) {
                    self.loggedInboundSources.insert(capturedSourceId)
                    NSLog(
                        "\(LOG_PREFIX) received first MIDI packet; bytes=\(capturedBytes)"
                    )
                }
                // Runtime-layout proof: the VSN1 emits CC 44 with the commit
                // revision only after it has applied names/colors/behavior/modes.
                // Log the revision (not layout content) so a field test can
                // distinguish "CoreMIDI accepted writes" from device-confirmed.
                if capturedBytes.count >= 3,
                   (capturedBytes[0] & 0xf0) == 0xb0,
                   capturedBytes[1] == 44,
                   let source = self.connectedSources[capturedSourceId],
                   displayName(for: source.ref).contains("Grid") {
                    NSLog(
                        "\(LOG_PREFIX) received VSN1 layout ACK revision=\(capturedBytes[2])"
                    )
                }
                if capturedBytes.count >= 3,
                   (capturedBytes[0] & 0xf0) == 0xb0,
                   capturedBytes[1] >= 32,
                   capturedBytes[1] <= 39,
                   let source = self.connectedSources[capturedSourceId],
                   displayName(for: source.ref).contains("Grid") {
                    let count = self.encoderLogCount[capturedSourceId] ?? 0
                    if count < 32 {
                        NSLog(
                            "\(LOG_PREFIX) VSN1 encoder cc=\(capturedBytes[1]) value=\(capturedBytes[2])"
                        )
                        self.encoderLogCount[capturedSourceId] = count + 1
                    }
                }
                self.sendEvent("midiMessage", [
                    "sourceId": capturedSourceId,
                    "data": capturedBytes,
                    "timestampMs": timestampMs,
                ])
            }

            // Advance to the next packet. MIDIPacketNext returns a pointer
            // to the byte immediately after this packet's data. It expects
            // an UnsafeMutablePointer.
            let mutable = UnsafeMutablePointer(mutating: packetPtr)
            raw = UnsafeRawPointer(MIDIPacketNext(mutable))
        }
    }
}

// Cached mach_timebase for the mach-abs-time -> milliseconds conversion.
private var machTimebaseInfo: mach_timebase_info_data_t = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return info
}()

private func machAbsToMillis(_ absTime: MIDITimeStamp) -> Double {
    let info = machTimebaseInfo
    // absTime is UInt64 in mach-abs ticks. Convert to nanoseconds via
    // numer/denom, then divide to milliseconds. Ordering keeps precision.
    let nanos = Double(absTime) * Double(info.numer) / Double(info.denom)
    return nanos / 1_000_000.0
}
